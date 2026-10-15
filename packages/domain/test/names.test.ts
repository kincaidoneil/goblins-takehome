import { describe, expect, it } from "vitest"
import { parseJoinCodeInput } from "../src/join-code"
import { cleanDisplayName, normalizeName } from "../src/names"
import { Option } from "effect"

describe("normalizeName", () => {
  it("ignores case, spacing and punctuation", () => {
    expect(normalizeName("maya r")).toBe(normalizeName("Maya R."))
    expect(normalizeName("  MAYA   R ")).toBe("mayar")
  })
  it("ignores accents", () => {
    expect(normalizeName("José")).toBe(normalizeName("jose"))
  })
  it("keeps marks that are part of the spelling", () => {
    expect(normalizeName("किरण")).not.toBe(normalizeName("करण"))
  })
  it("keeps letters from any script", () => {
    expect(normalizeName("李 明")).toBe("李明")
  })
  it("is empty when there is nothing to match on", () => {
    expect(normalizeName(" .-! ")).toBe("")
  })
})

describe("cleanDisplayName", () => {
  it("trims and collapses whitespace", () => {
    expect(cleanDisplayName("  Maya    R. ")).toBe("Maya R.")
  })
})

describe("parseJoinCodeInput", () => {
  it("accepts spaces and dashes", () => {
    expect(parseJoinCodeInput("482 913")).toEqual(Option.some("482913"))
    expect(parseJoinCodeInput("482-913")).toEqual(Option.some("482913"))
  })
  it("rejects anything but six digits", () => {
    expect(Option.isNone(parseJoinCodeInput("48291"))).toBe(true)
    expect(Option.isNone(parseJoinCodeInput("48291a"))).toBe(true)
  })
})
