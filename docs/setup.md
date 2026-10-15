# Setup: what only Kincaid can do

Agents don't create accounts, sign in, accept terms or type keys into web forms. This page lists every step that needs a person. Everything else the Infra and CI stream does with the `vercel`, `gh`, `electric` and `neonctl` CLIs.

Put keys in `.env.local` at the root of the main checkout (`~/goblins-takehome/.env.local`). It is gitignored. [`.env.example`](../.env.example) lists every variable. Never paste a key into chat, a PR or a commit. Tell the orchestrator when a step is done; agents never wait on these, they work around whatever is missing.

## Already done

- GitHub: signed in to `gh`, repo created, Codex reviews on.
- Vercel CLI: signed in as `kincaidoneil`, team "Kincaid's Team" on the Hobby plan.
- Vercel: project linked to GitHub; Neon (`goblins-db`, logical replication on) and Blob provisioned.
- Clerk and OpenRouter keys in `.env.local`, copied to Vercel and GitHub secrets.
- Repo stays private until submission; agents check CI by convention.

## Neon API key (optional)

Only needed if previews don't get their own database branch through the Vercel integration. The Infra and CI stream asks for it if so.

## Electric Cloud

1. Create an account at <https://dashboard.electric-sql.cloud> (signing in with GitHub is fine).
2. Create an API token in the dashboard's settings. Agents use it with the `electric` CLI to create one sync source per environment, including per-PR previews.
3. Add it to `.env.local`:

   ```
   ELECTRIC_API_TOKEN=
   ```

Agents create the sources and set `ELECTRIC_SOURCE_ID` and `ELECTRIC_SECRET` on Vercel themselves.

## Clerk (done)

1. At <https://dashboard.clerk.com>, create an application named `goblins-autograder`.
2. Under sign-in options, turn on Google and turn everything else off (email, password, other social providers). The development instance uses Clerk's shared Google credentials, so no Google Cloud setup.
3. From the API keys page, add both keys to `.env.local`:

   ```
   VITE_CLERK_PUBLISHABLE_KEY=
   CLERK_SECRET_KEY=
   ```

## OpenRouter (done)

1. Copy the key from the Goblins email into `.env.local`:

   ```
   OPENROUTER_API_KEY=
   ```

2. At <https://openrouter.ai/settings/keys>, confirm the key's credit limit is $20, so a bug can't spend more.

## Spending caps

| Service | Cap | Why it's enough |
|---|---|---|
| OpenRouter | $20 limit on the key (OpenRouter section) | The only service with metered spend |
| Upstash QStash | $25 total for load tests, pay-as-you-go (Kincaid approved 2026-10-15) | Added by the grading pipeline stream through the Vercel integration |
| Vercel | None needed | Hobby plan has no billing; usage over the free limits pauses, it doesn't charge |
| Neon, Electric, Clerk | None needed | Free tiers with no card on file |

If any free tier turns out too small (for example for the load test), the stream that hits it asks the orchestrator, and you decide whether to ask Goblins to pay.

## After you finish

Tell the orchestrator which steps are done. The Infra and CI stream then links the project, provisions Neon, Blob and Queues, sets Vercel environment variables and GitHub Actions secrets from `.env.local`, and confirms the first preview deploy.
