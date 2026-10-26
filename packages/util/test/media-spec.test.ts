import { describe, expect, test } from "bun:test"
import { frameRate, imageCompliant, renameForKind, videoCompliant } from "../src/media-spec.js"

describe("media spec", () => {
  test("compliance is decided by the short side and frame rate", () => {
    expect(videoCompliant({ width: 960, height: 540, fps: 4 })).toBe(true)
    expect(videoCompliant({ width: 540, height: 960, fps: 4 })).toBe(true)
    expect(videoCompliant({ width: 1080, height: 1920, fps: 4 })).toBe(false)
    expect(videoCompliant({ width: 960, height: 540, fps: 5 })).toBe(false)
  })

  test("only small WebP images skip conversion", () => {
    expect(imageCompliant({ mime: "image/webp", width: 1920, height: 1080 })).toBe(true)
    expect(imageCompliant({ mime: "image/png", width: 1920, height: 1080 })).toBe(false)
    expect(imageCompliant({ mime: "image/webp", width: 1920, height: 1090 })).toBe(false)
  })

  test("converted names keep the stem and swap the extension", () => {
    expect(renameForKind("clip.mov", "video")).toBe("clip.mp4")
    expect(renameForKind("photo.png", "image")).toBe("photo.webp")
    expect(renameForKind("recording", "audio")).toBe("recording.ogg")
  })

  test("ffprobe frame rates parse as fractions", () => {
    expect(frameRate("30/1")).toBe(30)
    expect(frameRate("30000/1001")).toBeCloseTo(29.97)
    expect(frameRate("")).toBe(0)
  })
})
