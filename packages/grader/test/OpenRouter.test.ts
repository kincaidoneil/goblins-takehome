import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { afterAll, beforeAll, describe, expect, it } from "@effect/vitest"
import { Cause, ConfigProvider, Effect, Either, Exit, Layer, Redacted } from "effect"
import type { CompletionRequest } from "../src/index.ts"
import * as OpenRouter from "../src/OpenRouter.ts"

/** A fake OpenRouter: each test picks the response by model id. */
type Reply = (req: IncomingMessage, res: ServerResponse, body: unknown) => void

const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  res.writeHead(status, { "content-type": "application/json", ...headers })
  res.end(JSON.stringify(body))
}

const ok = (content: string | null, finish = "stop") => ({
  id: "gen-1",
  model: "google/gemini-2.5-flash",
  choices: [{ finish_reason: finish, message: { role: "assistant", content } }],
  usage: { prompt_tokens: 1200, completion_tokens: 80, cost: 0.00042 },
})

const replies: Record<string, Reply> = {
  ok: (_req, res) => json(res, 200, ok("3/4")),
  "rate-limited": (_req, res) => json(res, 429, { error: { code: 429, message: "slow down" } }, { "retry-after": "7" }),
  "server-error": (_req, res) => json(res, 502, { error: { code: 502, message: "upstream down" } }),
  "no-credits": (_req, res) => json(res, 402, { error: { code: 402, message: "Insufficient credits" } }),
  "error-in-200": (_req, res) => json(res, 200, { error: { code: 503, message: "provider overloaded" } }),
  "rate-limited-in-200": (_req, res) => json(res, 200, { error: { code: 429, message: "upstream rate limit" } }),
  "cut-off": (_req, res) => json(res, 200, ok("partial", "length")),
  empty: (_req, res) => json(res, 200, ok(null)),
  "no-cost": (_req, res) => json(res, 200, { ...ok("3/4"), usage: { prompt_tokens: 10, completion_tokens: 2 } }),
  garbage: (_req, res) => {
    res.writeHead(200)
    res.end("<html>oops</html>")
  },
  slow: (_req, res) => setTimeout(() => json(res, 200, ok("late")), 2_000),
}

let baseUrl = ""
let lastBody: unknown
const server = createServer((req, res) => {
  let raw = ""
  req.on("data", (chunk) => (raw += chunk))
  req.on("end", () => {
    lastBody = JSON.parse(raw)
    const model = (lastBody as { model: string }).model
    replies[model]?.(req, res, lastBody)
  })
})

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => {
  server.closeAllConnections()
  server.close()
})

const client = () =>
  OpenRouter.make({ apiKey: Redacted.make("test"), timeoutMs: 500, baseUrl, appName: "test" })

const request = (model: string): CompletionRequest => ({
  model,
  messages: [
    { role: "system", content: "grade" },
    { role: "user", content: [{ type: "text", text: "p1" }, { type: "image", url: "data:image/png;base64,AA" }] },
  ],
  tag: { purpose: "grade" },
  jsonSchema: { name: "grade", schema: { type: "object" } },
})

const run = (model: string) => Effect.either(client().complete(request(model)))

describe("OpenRouter client", () => {
  it.effect("returns the completion with usage and cost, and sends images as image_url parts", () =>
    Effect.gen(function* () {
      const result = yield* run("ok")
      expect(result).toEqual(
        Either.right({
          id: "gen-1",
          model: "google/gemini-2.5-flash",
          text: "3/4",
          usage: { promptTokens: 1200, completionTokens: 80, costUsd: 0.00042 },
        }),
      )
      expect(lastBody).toMatchObject({
        messages: [
          { role: "system", content: "grade" },
          { role: "user", content: [{ type: "text" }, { type: "image_url", image_url: { url: "data:image/png;base64,AA" } }] },
        ],
        response_format: { type: "json_schema", json_schema: { name: "grade", strict: true } },
        usage: { include: true },
      })
    }),
  )

  it.live("maps each failure to its typed error", () =>
    Effect.gen(function* () {
      const tagOf = (r: Either.Either<unknown, { _tag: string }>) => (Either.isLeft(r) ? r.left : undefined)
      expect(tagOf(yield* run("rate-limited"))).toMatchObject({ _tag: "RateLimited", retryAfterMs: 7000 })
      expect(tagOf(yield* run("server-error"))).toMatchObject({ _tag: "ProviderError", status: 502, message: "upstream down" })
      expect(tagOf(yield* run("no-credits"))).toMatchObject({ _tag: "ProviderError", status: 402 })
      expect(tagOf(yield* run("error-in-200"))).toMatchObject({ _tag: "ProviderError", status: 503 })
      expect(tagOf(yield* run("rate-limited-in-200"))).toMatchObject({ _tag: "RateLimited" })
      expect(tagOf(yield* run("cut-off"))).toMatchObject({
        _tag: "BadResponse",
        usage: { promptTokens: 1200, completionTokens: 80, costUsd: 0.00042 },
      })
      expect(tagOf(yield* run("no-cost"))).toMatchObject({ _tag: "BadResponse", message: expect.stringContaining("cost is unknown") })
      expect(tagOf(yield* run("empty"))).toMatchObject({ _tag: "BadResponse" })
      expect(tagOf(yield* run("garbage"))).toMatchObject({ _tag: "BadResponse" })
      expect(tagOf(yield* run("slow"))).toMatchObject({ _tag: "Timeout", afterMs: 500 })
    }),
  )

  it.live("reports an unreachable host as ProviderError with status 0", () =>
    Effect.gen(function* () {
      const unreachable = OpenRouter.make({
        apiKey: Redacted.make("test"),
        timeoutMs: 2_000,
        baseUrl: "http://127.0.0.1:1",
        appName: "test",
      })
      const result = yield* Effect.either(unreachable.complete(request("ok")))
      expect(Either.isLeft(result) && result.left).toMatchObject({ _tag: "ProviderError", status: 0 })
    }),
  )
})

describe("OpenRouter layer", () => {
  it.effect("refuses to build unless MODEL_CLIENT=openrouter", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        Layer.build(OpenRouter.layer).pipe(
          Effect.scoped,
          Effect.withConfigProvider(ConfigProvider.fromMap(new Map([["OPENROUTER_API_KEY", "sk-test"]]))),
        ),
      )
      expect(Exit.isFailure(exit) && Cause.isDie(exit.cause)).toBe(true)
    }),
  )

  it.effect("builds when MODEL_CLIENT=openrouter and a key is set", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        Layer.build(OpenRouter.layer).pipe(
          Effect.scoped,
          Effect.withConfigProvider(
            ConfigProvider.fromMap(new Map([["OPENROUTER_API_KEY", "sk-test"], ["MODEL_CLIENT", "openrouter"]])),
          ),
        ),
      )
      expect(Exit.isSuccess(exit)).toBe(true)
    }),
  )
})
