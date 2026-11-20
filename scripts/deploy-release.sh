#!/usr/bin/env bash
# Builds the web app and deploys the Worker (D1) for one release.
#
# Usage:
#   scripts/deploy-release.sh build  <version> <sha>             builds apps/web/dist; prints the build time
#   scripts/deploy-release.sh deploy <version> <sha> <built-at>  deploys the already-built apps/web/dist
#   scripts/deploy-release.sh <version> <sha>                    both, in one go (manual/emergency use)
#
#   <version>   the release version, e.g. 0.2.0; must equal the root package.json version
#   <sha>       the release commit (40 hex characters); must be the checked-out commit
#   <built-at>  the build time printed by `build` (UTC, YYYY-MM-DDTHH:MM:SSZ)
#
# The web build and the Worker get the same commit (7 characters) and build time, so one release
# shows identical app and server lines in Account. CI builds in a job without secrets and deploys
# in another, so `build` and `deploy` are separate steps there.
# Wrangler reads CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID from the environment; this script
# never prints them. Exits non-zero on any failure, before building or deploying when a check fails.
set -euo pipefail
cd "$(dirname "$0")/.."

fail() {
  echo "deploy-release: $1" >&2
  exit 1
}
usage="usage: scripts/deploy-release.sh [build|deploy] <version> <sha> [<built-at>]"

mode=all
case "${1:-}" in
  build | deploy) mode=$1; shift ;;
esac
case "$mode" in
  build | all) [[ $# -eq 2 ]] || fail "$usage" ;;
  deploy) [[ $# -eq 3 ]] || fail "$usage" ;;
esac
version=$1
sha=$2

[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "version '$version' is not X.Y.Z"
package_version=$(node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync("package.json", "utf8")).version)')
[[ "$version" == "$package_version" ]] ||
  fail "version $version does not match package.json version $package_version"

[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || fail "sha '$sha' is not a full 40-character commit"
head=$(git rev-parse HEAD)
[[ "$sha" == "$head" ]] || fail "sha $sha is not the checked-out commit $head"

APP_COMMIT=${sha:0:7}
if [[ "$mode" == deploy ]]; then
  APP_BUILT_AT=$3
  [[ "$APP_BUILT_AT" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] ||
    fail "built-at '$APP_BUILT_AT' is not YYYY-MM-DDTHH:MM:SSZ"
  [[ -f apps/web/dist/index.html ]] || fail "apps/web/dist has no built app; run the build step first"
else
  APP_BUILT_AT=$(date -u +%FT%TZ)
fi
export APP_COMMIT APP_BUILT_AT

if [[ "$mode" != deploy ]]; then
  echo "deploy-release: building magomap $version, commit $APP_COMMIT, built $APP_BUILT_AT" >&2
  # Build output goes to stderr: in `build` mode stdout carries only the build time.
  pnpm --filter @magomap/web build >&2
fi

if [[ "$mode" == build ]]; then
  echo "$APP_BUILT_AT"
  exit 0
fi

echo "deploy-release: deploying magomap $version, commit $APP_COMMIT, built $APP_BUILT_AT" >&2
pnpm --filter @magomap/api exec wrangler deploy --env d1 \
  --var "APP_VERSION:$version" \
  --var "APP_COMMIT:$APP_COMMIT" \
  --var "APP_BUILT_AT:$APP_BUILT_AT"
