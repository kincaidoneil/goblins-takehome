import { describe, expect, it } from "@effect/vitest"
import { Option } from "effect"
import { render } from "../src/UsageReport.ts"

const totals = (purpose: "grade" | "eval", costUsd: number) => ({
  purpose,
  calls: 10,
  failed: 1,
  costUsd,
  costPerCallUsd: costUsd / 10,
  costPerGradeUsd: purpose === "grade" ? costUsd / 8 : null,
  p50LatencyMs: 3000,
  p95LatencyMs: 6000,
})

describe("usage report", () => {
  it("maps spend onto the PRD budget lines and reconciles with OpenRouter", () => {
    const report = render({
      generatedAt: new Date("2026-10-15T00:00:00Z"),
      log: Option.some([totals("eval", 7.5), totals("grade", 0.01)]),
      key: Option.some({ usageUsd: 7.51, limitUsd: 20, remainingUsd: 12.49 }),
    })
    expect(report).toContain("| Evals | $8.00 | $7.50 | 94% | near limit |")
    expect(report).toContain("| Production and demo | $4.00 | $0.0100 | 0% | ok |")
    expect(report).toContain("| **Total** | $20.00 | $7.51 | 38% | |")
    expect(report).toContain("The call log accounts for all of it.")
    expect(report).toContain("| grade | 10 | 1 (10%) | $0.0100 | $0.0010 | $0.0013 |")
    expect(report).not.toContain("Warning")
  })

  it("flags unlogged spend and a key limit above the budget", () => {
    const report = render({
      generatedAt: new Date(),
      log: Option.some([totals("grade", 1)]),
      key: Option.some({ usageUsd: 3, limitUsd: 150, remainingUsd: 147 }),
    })
    expect(report).toContain("Spend not in this call log: $2.00")
    expect(report).toContain("Warning: the key's limit ($150.00) is above the project budget of $20.00")
  })

  it("says which source is missing instead of failing", () => {
    const report = render({ generatedAt: new Date(), log: Option.none(), key: Option.none(), logError: "no DATABASE_URL", keyError: "401" })
    expect(report).toContain("Call log: not available: no DATABASE_URL")
    expect(report).toContain("OpenRouter key: not available: 401")
  })
})
