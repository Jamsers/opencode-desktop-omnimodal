import { createHash } from "node:crypto"
import path from "node:path"
import { MEDIA_SPEC_VERSION, outputExtension, type MediaKind } from "./media-spec.js"

export type MediaIdentity = {
  kind: MediaKind
  name: string
  path?: string
  bytes?: Uint8Array
  size: number
  mtime: number
}

/** The same source identity must produce the same key on both the desktop and server paths. */
export function mediaCacheKey(input: MediaIdentity) {
  const hash = createHash("sha1").update(`${MEDIA_SPEC_VERSION}:${input.kind}:${input.name}:`)

  if (input.bytes) return hash.update(input.bytes).digest("hex")

  return hash.update(`${input.size}:${input.mtime}:${input.path}`).digest("hex")
}

export function mediaCacheFile(root: string, name: string, kind: MediaKind, key: string) {
  const stem = path.basename(name, path.extname(name)).replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 80) || "media"

  return path.join(root, `${stem}-${key.slice(0, 10)}.${outputExtension(kind)}`)
}
