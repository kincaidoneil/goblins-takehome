# Setup: what only Kincaid can do

Agents don't create accounts, sign in, accept terms or type keys into web forms. This page lists every step that needs a person. Everything else the Infra and CI stream does with the `vercel`, `gh`, `electric` and `neonctl` CLIs.

Put keys in `.env.local` at the root of the main checkout (`~/goblins-takehome/.env.local`). It is gitignored. [`.env.example`](../.env.example) lists every variable. Never paste a key into chat, a PR or a commit. Tell the orchestrator when a step is done; agents never wait on these, they work around whatever is missing.

## Already done

- GitHub: signed in to `gh`, repo created, Codex reviews on.
- Vercel CLI: signed in as `kincaidoneil`, team "Kincaid's Team" on the Hobby plan.

## 1. GitHub: let CI block merges (decision needed)

GitHub only enforces branch protection on private repos with GitHub Pro. Without it, a red CI run can't block a merge; agents would only follow the rule by convention.

Pick one:

- **Make the repo public (recommended).** Free, and the repo is a deliverable anyway. The risk is anyone reading it before you submit. No secrets are committed.

  ```bash
  gh repo edit kincaidoneil/goblins-takehome --visibility public --accept-visibility-change-consequences
  ```

- **Upgrade to GitHub Pro** ($4/month). Keeps it private. This is your money, so it's your call.

- **Do nothing.** Agents check CI themselves before merging. Weaker, and a reviewer may notice.

## 2. Vercel: connect GitHub and accept Neon's terms

Run these in a terminal in `~/goblins-takehome`. Each needs a person to confirm.

1. Accept the Neon marketplace terms. This installs Neon on the team; agents then create the database.

   ```bash
   vercel integration accept-terms neon
   ```

2. Make sure the Vercel GitHub app can see the repo, so merges to `main` deploy and PRs get previews. Open <https://github.com/settings/installations>, choose Vercel, and add `goblins-takehome` if it uses "Only select repositories".

## 3. Neon API key

Agents need it to turn on logical replication (Electric requires it), and to manage the per-preview database branches.

1. In the Vercel dashboard, open Storage, then the Neon integration, then "Open in Neon". If there is no database yet, wait for the agent to say it created one.
2. In the Neon console, go to Organization settings, then API keys, and create a key named `goblins-agents`.
3. Add it to `.env.local`:

   ```
   NEON_API_KEY=
   ```

## 4. Electric Cloud

1. Create an account at <https://dashboard.electric-sql.cloud> (signing in with GitHub is fine).
2. Create an API token in the dashboard's settings. Agents use it with the `electric` CLI to create one sync source per environment, including per-PR previews.
3. Add it to `.env.local`:

   ```
   ELECTRIC_API_TOKEN=
   ```

Agents create the sources and set `ELECTRIC_SOURCE_ID` and `ELECTRIC_SECRET` on Vercel themselves.

## 5. Clerk

1. At <https://dashboard.clerk.com>, create an application named `goblins-autograder`.
2. Under sign-in options, turn on Google and turn everything else off (email, password, other social providers). The development instance uses Clerk's shared Google credentials, so no Google Cloud setup.
3. From the API keys page, add both keys to `.env.local`:

   ```
   VITE_CLERK_PUBLISHABLE_KEY=
   CLERK_SECRET_KEY=
   ```

## 6. OpenRouter

1. Copy the key from the Goblins email into `.env.local`:

   ```
   OPENROUTER_API_KEY=
   ```

2. At <https://openrouter.ai/settings/keys>, confirm the key's credit limit is $20, so a bug can't spend more.

## Spending caps

| Service | Cap | Why it's enough |
|---|---|---|
| OpenRouter | $20 limit on the key (step 6) | The only service with metered spend |
| Vercel | None needed | Hobby plan has no billing; usage over the free limits pauses, it doesn't charge |
| Neon, Electric, Clerk | None needed | Free tiers with no card on file |

If any free tier turns out too small (for example for the load test), the stream that hits it asks the orchestrator, and you decide whether to ask Goblins to pay.

## After you finish

Tell the orchestrator which steps are done. The Infra and CI stream then links the project, provisions Neon, Blob and Queues, sets Vercel environment variables and GitHub Actions secrets from `.env.local`, and confirms the first preview deploy.
