export * as Mime from "./mime.js"

import { detectMediaType, isDocumentMediaType } from "@opencode/ai/utils/media-type"
import { lookup } from "mime-types"

const imageMimes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"])

export function detect(bytes: Uint8Array) {
  const detected = detectMediaType(bytes)
  if (detected) return detected
  if (startsWith(bytes, [0x42, 0x4d])) return "image/bmp"
  return isText(bytes) ? "text/plain" : "application/octet-stream"
}

/** Sniffed media type, falling back to the file name's extension when the bytes are opaque. */
export function detectNamed(bytes: Uint8Array, name: string | undefined) {
  const detected = detect(bytes)
  if (detected !== "application/octet-stream" || name === undefined) return detected
  return lookup(name) || detected
}

/** Media the server forwards to the model as message content. */
export function isMedia(mime: string) {
  return imageMimes.has(mime) || mime.startsWith("audio/") || mime.startsWith("video/") || isDocumentMediaType(mime)
}

function startsWith(bytes: Uint8Array, prefix: number[]) {
  return prefix.every((value, index) => bytes[index] === value)
}

function isText(bytes: Uint8Array) {
  if (bytes.length === 0) return true
  if (bytes.includes(0)) return false
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes, { stream: true })
  } catch {
    return false
  }
  const controls = bytes.reduce((count, byte) => count + Number(byte < 9 || (byte > 13 && byte < 32)), 0)
  return controls / bytes.length <= 0.3
}
