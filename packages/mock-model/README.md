# @goblins/mock-model

A mock `ModelClient` (the interface in `@goblins/grader`) for development, E2E tests and the load test. It never calls a provider and reports zero cost.

## Choosing the client

`selectModel({ env, loadTestHeader })` returns `Real` or `Mock(config)`:

1. A load-test header (`x-goblins-load-test`) always selects the mock it describes, even in production.
2. Otherwise `MODEL_CLIENT=real` selects the real model. Nothing else spends money.
3. Otherwise the mock, configured by `MOCK_MODEL` (default `mode=fixed`).

The grading consumer runs outside the HTTP request, so the web app stores the header value with the submission and passes it to `selectModel` when it grades.

The env var and the header use the same syntax:

```
mode=fixed; latency=500
mode=sampled; profile=seed; scenario=provider-down; at=60; for=300; start=1760000000000; run=lt-42
mode=replay; recording=seed-window; start=1760000000000; run=lt-42
```

`latency` is milliseconds. `start` is the run's start in epoch milliseconds; `at` and `for` are seconds after `start` and override a scenario's default window. Load tests should always send `start`: scenarios and replay depend only on time since `start`, so every serverless instance sees an outage at the same moment without sharing state.

## Modes

**Fixed** returns scripted content with a fixed latency and no random errors. E2E tests use it to reach every grade state.

**Sampled** draws each call's latency and failure from a profile, optionally with a scenario on top:

| Scenario | Default window | Effect |
|---|---|---|
| `rate-limit-storm` | minutes 2–5 | 70% of calls get a 429 with Retry-After 2–10 s |
| `provider-down` | minutes 2–7 | every call gets a 503 after 0.1–0.4 s |
| `latency-doubling` | whole run | every latency doubles; calls pushed past 60 s time out |

**Replay** reproduces a recorded window: a call made `t` into the run takes the latency and outcome of a recorded call made about `t` into the recording (same 10-second bucket). The recording's pattern over time survives at whatever call rate the load test drives. Runs longer than the recording loop over it.

## Scripted content

Put a marker in any text part of the request. The first valid marker wins; without one, the answer is full marks.

```
[[mock:graded score=3 max=4 feedback="Sign error in step 2"]]
[[mock:needs-teacher reason="Work is illegible"]]
[[mock:fail error=ProviderError until=1760000000000]]   # RateLimited | Timeout | ProviderError | BadResponse
[[mock:malformed]]                                      # 200 with text that is not JSON
[[mock:text value="any completion text"]]
```

`fail` without `until` fails every call. With `until`, calls fail until that time and then succeed, so a test can watch a failed grade succeed on retry without the mock keeping state across instances. Build markers with `marker(...)` rather than by hand.

Completion text for `graded` and `needs-teacher` comes from `renderJson`. Pass `render` to `layer(config, { render })` to match the grader's output schema.

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
