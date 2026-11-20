#!/usr/bin/env bash
# Builds the web app and deploys the Worker (D1) for one release.
# Usage: scripts/deploy-release.sh <version> <sha>
#   <version>  the release version, e.g. 0.2.0; must equal the root package.json version
#   <sha>      the release commit (40 hex characters); must be the checked-out commit
# The web build and the Worker get the same commit (7 characters) and build time, so one
# release shows identical app and server lines in Account.
# Wrangler reads CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID from the environment; this
# script never prints them. Exits non-zero on any failure, before building when a check fails.
set -euo pipefail
cd "$(dirname "$0")/.."

fail() {
  echo "deploy-release: $1" >&2
  exit 1
}

[[ $# -eq 2 ]] || fail "usage: scripts/deploy-release.sh <version> <sha>"
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
APP_BUILT_AT=$(date -u +%FT%TZ)
export APP_COMMIT APP_BUILT_AT
echo "deploy-release: magomap $version, commit $APP_COMMIT, built $APP_BUILT_AT"

pnpm --filter @magomap/web build
pnpm --filter @magomap/api exec wrangler deploy --env d1 \
  --var "APP_VERSION:$version" \
  --var "APP_COMMIT:$APP_COMMIT" \
  --var "APP_BUILT_AT:$APP_BUILT_AT"
