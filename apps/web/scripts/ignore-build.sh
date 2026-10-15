#!/bin/sh
# Vercel's ignored build step: exit 0 skips the build, exit 1 builds.
# Production and first deploys always build; otherwise build only when the app or its inputs changed.
[ "$VERCEL_ENV" = production ] && exit 1
base="$VERCEL_GIT_PREVIOUS_SHA"
[ -n "$base" ] && git cat-file -e "$base^{commit}" 2>/dev/null || exit 1
git diff --quiet "$base" HEAD -- . ../../packages ../../pnpm-lock.yaml ../../package.json ../../pnpm-workspace.yaml ../../tsconfig.base.json
