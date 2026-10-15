#!/usr/bin/env bash
# Deploys production Electric to Fly.io and points the Vercel production app at it.
# Needs: `fly auth login` and `vercel login` done.
# Safe to re-run: it reuses the app, the volume and the existing Electric secret.
set -euo pipefail
cd "$(dirname "$0")"

# Target the project by ID. No `vercel link`, which would write .env.local.
export VERCEL_ORG_ID=team_Xg3Y7nS6gz4OGRLbiHc1kaZ4
export VERCEL_PROJECT_ID=prj_P6s1Bnp0RZZ99h8EXBgT5z42Sr5I

app=goblins-electric
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

fly apps list --json | grep -q "\"$app\"" || fly apps create "$app"

# Electric needs Neon's direct (unpooled) connection for logical replication.
vercel env pull "$tmp/prod.env" --environment production --yes >/dev/null
database_url=$(grep '^DATABASE_URL_UNPOOLED=' "$tmp/prod.env" | cut -d= -f2- | tr -d '"')
[ -n "$database_url" ] || { echo "DATABASE_URL_UNPOOLED missing on Vercel production" >&2; exit 1; }

secret=$(grep '^ELECTRIC_SECRET=' "$tmp/prod.env" | cut -d= -f2- | tr -d '"' || true)
new_secret=false
if [ -z "$secret" ]; then
  secret=$(openssl rand -hex 32)
  new_secret=true
fi

fly secrets set --app "$app" --stage DATABASE_URL="$database_url" ELECTRIC_SECRET="$secret" >/dev/null
fly deploy --app "$app" --config fly.toml --ha=false

url="https://$app.fly.dev"
curl -fsS "$url/v1/health" && echo

if $new_secret; then
  # Not --sensitive: sensitive values come back empty from `env pull`, and
  # re-runs read this value back to keep Fly and Vercel in step.
  printf %s "$secret" | vercel env add ELECTRIC_SECRET production --yes >/dev/null
fi
vercel env rm ELECTRIC_URL production --yes >/dev/null 2>&1 || true
printf %s "$url" | vercel env add ELECTRIC_URL production --yes >/dev/null
echo "Electric is live at $url. Redeploy production on Vercel to pick up ELECTRIC_URL."
