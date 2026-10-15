# @goblins/mock-model

A mock `ModelClient` (the interface in `@goblins/grader`) for development, E2E tests and the load test. It never calls a provider and reports zero cost.

## Choosing the client

Two calls, one where the request arrives and one where grading runs:

1. `authorizeLoadTest({ env, loadTestHeader, mockSpecHeader })` in the request handler. The request is load-test traffic only when `x-goblins-load-test` is `<LOAD_TEST_TOKEN>:<runId>`. A missing or wrong token, or an unset `LOAD_TEST_TOKEN`, returns `undefined` and the request takes the normal path. With a valid token, `x-goblins-mock-model` picks the mock spec (default `mode=sampled; profile=seed`). The web app stores the returned `{ runId, spec }` with the submission, never the token.
2. `selectModel({ env, loadTest })` in the grading consumer returns `Real` or `Mock(config)`:
   - a stored load-test run always gets its mock, even in production;
   - otherwise `MODEL_CLIENT=openrouter` selects the real model, and nothing else spends money;
   - otherwise the mock, configured by `MOCK_MODEL` (default `mode=fixed`).

`MOCK_MODEL` and `x-goblins-mock-model` use the same syntax:

```
mode=fixed; latency=500
mode=sampled; profile=seed; scenario=provider-down; at=60; for=300; start=1760000000000
mode=replay; recording=seed-window; start=1760000000000
```

`latency` is milliseconds. `start` is the run's start in epoch milliseconds; `at` and `for` are seconds after `start` and override a scenario's default window. Load tests should always send `start`: scenarios and replay depend only on time since `start`, so every serverless instance sees an outage at the same moment without sharing state.

## Modes

**Fixed** answers from the fixture table with a fixed latency and no random errors. E2E tests use it to reach every grade state.

**Sampled** draws each call's latency and failure from a profile, optionally with a scenario on top:

| Scenario | Default window | Effect |
|---|---|---|
| `rate-limit-storm` | minutes 2–5 | 70% of calls get a 429 with Retry-After 2–10 s |
| `provider-down` | minutes 2–7 | every call fails after 0.1–0.4 s with `ProviderError` status 0 (no HTTP response), which the grader retries |
| `latency-doubling` | whole run | every latency doubles; calls pushed past 60 s time out |

**Replay** reproduces a recorded window: a call made `t` into the run takes the latency and outcome of a recorded call made about `t` into the recording (same 10-second bucket). The recording's pattern over time survives at whatever call rate the load test drives. Runs longer than the recording loop over it.

## Fixture whiteboards

The mock hashes each image in the request (SHA-256 of the bytes, from a data URL or fetched from an http URL) and looks the hashes up in `src/fixtures.ts`. The first image that matches a fixture decides, so other images such as a diagram don't get in the way; with no match, the last image's hash decides. A fetch that takes longer than the model timeout fails as `Timeout`. E2E tests and the class simulator submit the files in `fixtures/`:

| File | Outcome |
|---|---|
| `correct.png` | graded 2/2 |
| `partial.png` | graded 1/2 |
| `wrong.png` | graded 0/2 |
| `blank.png` | graded 0/2, "No work shown." |
| `illegible.png` | needs teacher, with a reason |
| `fails-once.png` | non-retryable 400 on the first try for each grade, graded 2/2 on the retry |
| `fails-always.png` | times out on every try |
| `malformed.png` | a 200 whose text is not JSON |

An image that matches no fixture gets an outcome derived from its hash: 70% full marks, 15% zero, 15% needs teacher. The same image always gets the same outcome. A request with no image gets full marks. An image the mock can't read fails as a 400, as the provider would.

This only works if the fixture bytes reach the model request unchanged. If the app re-encodes or resizes whiteboards before grading, register the processed bytes instead.

To add a fixture: add the PNG to `fixtures/` (the sources are in `fixtures/whiteboards.html`), add an entry to `src/fixtures.ts`, and run the tests. They check every hash and print the right one on a mismatch.

Completion text for graded and needs-teacher outcomes comes from `renderJson`. Pass `render` to `layer(config, { render })` to match the grader's output schema. It receives the answer and the request, since the grader's format has one entry per rubric line in the request; the app wiring passes the active grader's renderer.

## Seed data: guessed, not measured

No real calls have been logged yet. Until they are:

- The `seed` profile is a guess: log-normal latency with median 3.5 s and p95 9 s, 0.5% rate limits, 0.5% provider errors, 0.2% bad responses, 1,800 prompt and 250 completion tokens.
- The `seed-window` recording is synthetic: 10 minutes at 5 calls per second drawn from the seed profile, with a 45-second burst of 429s at minute 4.

Load-test reports must say which profile or recording a run used. Once latency calibration has logged real calls, export rows from the call log, build a profile and a recording with `profileFromCallLog` and `recordingFromCallLog`, and add them to `src/registry.ts`.

## Tests

```
pnpm --filter @goblins/mock-model test
```

`test/scenario.test.ts` checks the error mix each scenario produces, inside and outside its window, through the client.
