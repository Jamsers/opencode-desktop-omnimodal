import { spawn } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  AUDIO_BITRATE,
  IMAGE_QUALITY,
  IMAGE_SHORT_SIDE,
  MAX_INLINE_BYTES,
  MEDIA_SPEC_VERSION,
  VIDEO_CRF,
  VIDEO_PRESET,
  audioCompliant,
  frameRate,
  imageCompliant,
  kindOf,
  outputExtension,
  outputMime,
  renameForKind,
  videoCompliant,
  videoFilter,
  type MediaKind,
} from "@opencode/util/media-spec"

export type MediaConversionInput = {
  path?: string
  bytes?: Uint8Array
  name: string
  mime: string
}

export type MediaConversionResult = {
  converted: boolean
  path: string
  name: string
  mime: string
  size: number
  bytes?: Uint8Array
}

// The desktop shares this directory with the CLI service, so the agent-read conversion (core)
// finds the same preference and the same cache.
const xdgData = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share")
const data = path.join(xdgData, "opencode")
const preference = path.join(data, "media-convert.json")
const cache = path.join(data, "media-cache")
const temporary = path.join(os.tmpdir(), "opencode-media")

export async function readMediaPreference() {
  try {
    // SAFETY: the preference file is ours; a missing or malformed file means the default.
    const value = JSON.parse(await readFile(preference, "utf8")) as { convert?: unknown }

    return value?.convert !== false
  } catch {
    return true
  }
}

export async function writeMediaPreference(convert: boolean) {
  await mkdir(data, { recursive: true })

  const partial = `${preference}.${process.pid}.tmp`
  await writeFile(partial, JSON.stringify({ convert }))
  await rename(partial, preference)
}

export async function convertMedia(input: MediaConversionInput, signal: AbortSignal) {
  const kind = kindOf(input.mime)

  if (!kind || input.bytes === undefined && input.path === undefined) return null

  return limited(async () => {
    if (signal.aborted) return null

    const source = input.path ?? (await materialize(input, kind))

    try {
      const info = await stat(source)
      const name = renameForKind(input.name, kind)
      const extension = outputExtension(kind)
      const key = cacheKey(kind, input, info.size, info.mtimeMs).slice(0, 10)
      const target = path.join(cache, `${safeStem(name)}-${key}.${extension}`)

      if (await exists(target)) return await result(target, name, kind, true)
      if (await compliant(kind, source, input.mime, signal))
        return { converted: false, path: input.path ?? "", name: input.name, mime: input.mime, size: info.size }

      await mkdir(cache, { recursive: true })

      const partial = `${target}.${process.pid}.${extension}`

      try {
        await run(kind, source, partial, signal)
        await rename(partial, target)
      } catch (error) {
        await rm(partial, { force: true }).catch(() => {})
        throw error
      }

      return await result(target, name, kind, true)
    } finally {
      if (!input.path) await rm(source, { force: true }).catch(() => {})
    }
  })
}

async function result(file: string, name: string, kind: MediaKind, converted: boolean) {
  const info = await stat(file)
  // Only inline-sized outputs cross the IPC boundary; larger ones stay on disk for the path route.
  const bytes = info.size <= MAX_INLINE_BYTES ? new Uint8Array(await readFile(file)) : undefined

  return { converted, path: file, name, mime: outputMime(kind), size: info.size, bytes }
}

async function compliant(kind: MediaKind, source: string, mime: string, signal: AbortSignal) {
  try {
    if (kind === "video") {
      const info = await probeVideo(source, signal)

      return info ? videoCompliant(info) : false
    }

    if (kind === "audio") {
      const info = await probeAudio(source, signal)

      return info ? audioCompliant(info) : false
    }

    const info = await probeImage(source, signal)

    return info ? imageCompliant({ mime: info.mime || mime, width: info.width, height: info.height }) : false
  } catch {
    // An unreadable probe means "convert and let the encoder decide".
    return false
  }
}

async function run(kind: MediaKind, source: string, target: string, signal: AbortSignal) {
  if (kind === "video")
    return command(
      "ffmpeg",
      [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        source,
        "-vf",
        videoFilter(),
        "-c:v",
        "libx264",
        "-crf",
        String(VIDEO_CRF),
        "-preset",
        VIDEO_PRESET,
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "libopus",
        "-b:a",
        AUDIO_BITRATE,
        "-ac",
        "1",
        "-movflags",
        "+faststart",
        target,
      ],
      signal,
    )

  if (kind === "audio")
    return command(
      "ffmpeg",
      ["-y", "-hide_banner", "-loglevel", "error", "-i", source, "-vn", "-c:a", "libopus", "-b:a", AUDIO_BITRATE, "-ac", "1", target],
      signal,
    )

  return command(
    "magick",
    [
      source,
      "-auto-orient",
      "-colorspace",
      "sRGB",
      "-resize",
      `${IMAGE_SHORT_SIDE}x${IMAGE_SHORT_SIDE}>^`,
      "-quality",
      String(IMAGE_QUALITY),
      target,
    ],
    signal,
  )
}

function command(name: string, args: string[], signal: AbortSignal) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(name, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    let settled = false

    const finish = (done: () => void) => {
      if (settled) return
      settled = true
      signal.removeEventListener("abort", abort)
      done()
    }

    const abort = () => {
      child.kill()
      finish(() => reject(new DOMException("Aborted", "AbortError")))
    }

    child.stdout.on("data", (chunk) => (stdout += String(chunk)))
    child.stderr.on("data", (chunk) => (stderr = (stderr + String(chunk)).slice(-4000)))
    child.once("error", (error) => finish(() => reject(error)))
    child.once("exit", (code) =>
      code === 0
        ? finish(() => resolve(stdout))
        : finish(() => reject(new Error(`${name} exited with ${code}: ${stderr.trim()}`))),
    )

    if (signal.aborted) abort()
    else signal.addEventListener("abort", abort, { once: true })
  })
}

async function probeVideo(source: string, signal: AbortSignal) {
  const raw = await probe(source, "v:0", "stream=width,height,r_frame_rate", signal)
  const stream = raw.streams?.[0]

  if (!stream) return undefined

  return { width: Number(stream.width), height: Number(stream.height), fps: frameRate(String(stream.r_frame_rate ?? "")) }
}

async function probeAudio(source: string, signal: AbortSignal) {
  const raw = await probe(source, "a:0", "stream=codec_name,channels", signal)
  const stream = raw.streams?.[0]

  if (!stream) return undefined

  return {
    codec: String(stream.codec_name ?? ""),
    channels: Number(stream.channels ?? 0),
    bitrate: Number(raw.format?.bit_rate ?? 0),
  }
}

async function probe(source: string, stream: string, entries: string, signal: AbortSignal) {
  const raw = await command(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      stream,
      "-show_entries",
      entries,
      "-show_entries",
      "format=bit_rate",
      "-of",
      "json",
      source,
    ],
    signal,
  )

  // SAFETY: ffprobe emitted this JSON for the documented entries above.
  return JSON.parse(raw) as {
    streams?: Array<Record<string, unknown>>
    format?: Record<string, unknown>
  }
}

async function probeImage(source: string, signal: AbortSignal) {
  const raw = await command("magick", ["identify", "-format", "%m %w %h\n", source], signal)
  const [format, width, height] = raw.trim().split("\n")[0]?.split(" ") ?? []

  if (!format || !width || !height) return undefined

  // SAFETY: IM names formats with the MIME subtype, e.g. JPEG, PNG, WEBP.
  return { mime: `image/${format.toLowerCase()}`, width: Number(width), height: Number(height) }
}

function cacheKey(kind: MediaKind, input: MediaConversionInput, size: number, mtime: number) {
  const hash = createHash("sha1").update(`${MEDIA_SPEC_VERSION}:${kind}:${input.name}:`)

  if (input.bytes)
    // SAFETY: the bytes branch is selected by the caller passing bytes rather than a path.
    return hash.update(input.bytes).digest("hex")

  return hash.update(`${size}:${mtime}:${input.path}`).digest("hex")
}

async function materialize(input: MediaConversionInput, kind: MediaKind) {
  await mkdir(temporary, { recursive: true })

  const extension =
    input.name.match(/\.[^./\\]+$/)?.[0] ?? (kind === "image" ? ".png" : kind === "audio" ? ".wav" : ".mp4")
  const file = path.join(temporary, `${randomUUID()}${extension}`)

  await writeFile(file, input.bytes ?? new Uint8Array())

  return file
}

function safeStem(name: string) {
  const stem = path.basename(name, path.extname(name)).replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 80)

  return stem || "media"
}

async function exists(file: string) {
  try {
    await stat(file)

    return true
  } catch {
    return false
  }
}

// Video encodes are CPU-bound; two at a time keeps a multi-file drop responsive without pinning
// every core.
const LIMIT = 2
let active = 0
const waiting: Array<() => void> = []

async function limited<Value>(work: () => Promise<Value>) {
  if (active >= LIMIT) await new Promise<void>((resolve) => waiting.push(resolve))
  else active++

  try {
    return await work()
  } finally {
    const next = waiting.shift()

    if (next) next()
    else active--
  }
}
