#!/usr/bin/env bash
# Vercel "Ignored Build Step" (exit 0 skips the build, exit 1 builds). Kept in a file
# because vercel.json caps `ignoreCommand` at 256 characters.
# Production and first deploys always build; otherwise build only if the app, a
# package or the workspace config changed since the previous deploy.
[ "$VERCEL_ENV" = production ] && exit 1
base="$VERCEL_GIT_PREVIOUS_SHA"
[ -n "$base" ] && git cat-file -e "$base^{commit}" 2>/dev/null || exit 1
git diff --quiet "$base" HEAD -- . ../../packages ../../pnpm-lock.yaml ../../package.json ../../pnpm-workspace.yaml ../../tsconfig.base.json
