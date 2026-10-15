# Grade queue options

Compared on 2026-10-15 by the grading pipeline stream; the decision is in [decisions.md](decisions.md). Cost assumes a 10,000-student load-test run of about 100k grades, before retries.

| Option | Enforced concurrency cap | Retries, outage | Cost per 100k-grade run | New vendor or account | Observability |
|---|---|---|---|---|---|
| Vercel Queues | Yes, via the undocumented trigger field `maxConcurrency`. Infra measured 129 s for 60 × 5 s jobs at cap 10 (ideal 30 s), too slow at the bell | At-least-once; backoff via the SDK's retry callback; 7-day retention | About $0.60 per million operations: cents | None | No queued or in-flight counts exposed |
| Upstash QStash, flow control | Yes, documented: parallelism and rate per key; pay-as-you-go allows parallelism up to 100 (fixed plans: 200 or more) | At-least-once; retries with backoff, or our own delayed republish; dead-letter queue | $1 per 100k messages: about $1–2 with retries. The free tier (1,000 a day) can't run a load test | Upstash, through the Vercel Marketplace with integrated billing; needs terms accepted and a paid plan | Dashboard, dead-letter queue, flow-control API |
| Upstash Workflow | Same as QStash | Step-level retries | At least 2–3 messages per grade: about $3 | Same as QStash | Run-level view |
| Postgres jobs table plus cron | Yes, `FOR UPDATE SKIP LOCKED` with a running count | Ours to build; Vercel cron fires at most once a minute, so workers need a loop | $0 extra, but it adds load on the same database | None | Full SQL |
| Inngest, Temporal | Yes | Yes | Not priced | New account, and a heavier programming model | Good |
