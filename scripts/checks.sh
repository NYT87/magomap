#!/usr/bin/env bash
# magomap's checks. The gate runs this; CI runs it too.
# Written over the whole workspace, so new packages are covered without editing it.
# Non-interactive, never rewrites files, exits non-zero on any failure.
set -euo pipefail
cd "$(dirname "$0")/.."

pnpm install --frozen-lockfile --reporter=silent
pnpm check
pnpm -r --if-present typecheck
pnpm -r --if-present test
pnpm -r --if-present build
