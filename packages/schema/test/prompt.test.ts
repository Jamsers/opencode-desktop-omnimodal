import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Base64 } from "../src/prompt.js"

describe("Prompt.Base64", () => {
  const decode = Schema.decodeUnknownSync(Base64)

  test("accepts canonical base64 of any length", () => {
    for (const value of ["", "AA==", "AAA=", "AAAA"]) expect(decode(value)).toBe(value)

    // The former regex-based filter rejected canonical base64 above roughly 9 MB in JSC.
    const large = Buffer.alloc(7_245_718).toString("base64")
    expect(decode(large)).toBe(large)
  })

  test("rejects malformed base64", () => {
    for (const value of ["A", "AAA", "A===", "====", "AAAAA", "AA=A", "AA==AA==", "AAA=AAAA", "A A A=", "AA--"])
      expect(() => decode(value)).toThrow()
  })
})
