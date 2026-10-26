// The fork's media conversion spec. Kept pure so the desktop shell (attachments) and the core
// server (agent reads) can share one definition without either depending on the other's runtime.

export type MediaKind = "image" | "audio" | "video"

/** Bump to invalidate every cached conversion when the spec changes. */
export const MEDIA_SPEC_VERSION = 1

/** The model-ingestion cap; conversions are judged against the output's size. */
export const MAX_INLINE_BYTES = 20 * 1024 * 1024

export const IMAGE_SHORT_SIDE = 1080
export const IMAGE_QUALITY = 80

export const AUDIO_BITRATE = "16k"
/** Already-compliant audio may sit a little above 16k without a re-encode. */
export const AUDIO_MAX_BITRATE = 32_000

export const VIDEO_SHORT_SIDE = 540
export const VIDEO_FPS = 4
export const VIDEO_CRF = 32
export const VIDEO_PRESET = "slow"

const IMAGE_MIMES = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"])

export function kindOf(mime: string): MediaKind | undefined {
  const type = mime.toLowerCase().split(";")[0]?.trim() ?? ""

  if (IMAGE_MIMES.has(type)) return "image"
  if (type.startsWith("audio/")) return "audio"
  if (type.startsWith("video/")) return "video"
}

export function outputMime(kind: MediaKind) {
  if (kind === "image") return "image/webp"
  if (kind === "audio") return "audio/ogg"
  return "video/mp4"
}

export function outputExtension(kind: MediaKind) {
  if (kind === "image") return "webp"
  if (kind === "audio") return "ogg"
  return "mp4"
}

/** Replaces the extension while keeping the stem the model sees in the attachment name. */
export function renameForKind(name: string, kind: MediaKind) {
  const extension = outputExtension(kind)
  const stem = name.replace(/\.[^./\\]+$/, "") || name

  return `${stem}.${extension}`
}

export function videoFilter() {
  const fit = `min(1,${VIDEO_SHORT_SIDE}/min(iw,ih))`

  // The single quotes belong to ffmpeg's filter parser: they keep the commas inside min() from
  // being read as filter separators.
  return `fps=${VIDEO_FPS},scale='2*floor(iw*${fit}/2)':'2*floor(ih*${fit}/2)'`
}

export function videoCompliant(input: { width: number; height: number; fps: number }) {
  return Math.min(input.width, input.height) <= VIDEO_SHORT_SIDE && input.fps <= VIDEO_FPS
}

export function imageCompliant(input: { mime: string; width: number; height: number }) {
  return input.mime.toLowerCase() === "image/webp" && Math.min(input.width, input.height) <= IMAGE_SHORT_SIDE
}

export function audioCompliant(input: { codec: string; channels: number; bitrate: number }) {
  return input.codec === "opus" && input.channels === 1 && input.bitrate > 0 && input.bitrate <= AUDIO_MAX_BITRATE
}

/** Parses ffprobe's "30/1" and "30000/1001" frame-rate strings. */
export function frameRate(value: string) {
  const [numerator, denominator] = value.split("/").map(Number)

  if (!numerator || !denominator) return 0

  return numerator / denominator
}
