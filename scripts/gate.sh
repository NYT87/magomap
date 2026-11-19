#!/usr/bin/env bash
# The gate for one task (see docs/superpowers/build-process.md).
# Usage: scripts/gate.sh [base-ref]   (default: origin/main, or main when there is no remote)
# Prints one line: "GATE: PASS" or "GATE: FAIL <reason>". Full output goes to gate.log.
set -uo pipefail
cd "$(dirname "$0")/.."

base="${1:-}"
if [[ -z "$base" ]]; then
  if git rev-parse --verify -q origin/main >/dev/null; then base=origin/main; else base=main; fi
fi
log=gate.log
: >"$log"

fail() {
  echo "GATE: FAIL $1" | tee -a "$log"
  exit 1
}

# Compare the base with the working tree (committed and uncommitted changes of this task).
changes() { git diff --name-status "$base" -- "$@"; }

# 1. Protected paths: a task may create them, never change or delete them.
protected=(
  scripts/checks.sh scripts/gate.sh
  .github/workflows
  biome.json tsconfig.base.json
  docs/superpowers docs/brand-guidelines.md
  .claude/agents
)
while IFS=$'\t' read -r status path _; do
  [[ -z "$status" || "$status" == A ]] && continue
  fail "protected path: $path"
done < <(changes "${protected[@]}")

# 2. Quality-bar guard, on added lines of code files only.
code_files=(':(glob)**/*.ts' ':(glob)**/*.tsx' ':(glob)**/*.js' ':(glob)**/*.mjs' ':(glob)**/*.cjs')
is_test() { [[ "$1" =~ \.(test|spec)\.[cm]?[jt]sx?$ || "$1" == */e2e/* ]]; }

while IFS=$'\t' read -r status path _; do
  if [[ "$status" == D ]] && is_test "$path"; then fail "quality guard: deleted test file $path"; fi
done < <(changes "${code_files[@]}")

current=""
added_tests=0
declare -A removed_asserts=() added_asserts=()
while IFS= read -r line; do
  if [[ "$line" == "+++ b/"* ]]; then current="${line#+++ b/}"; continue; fi
  [[ "$line" == "+++ "* || "$line" == "--- "* ]] && continue
  if [[ "$line" == +* ]]; then
    text="${line:1}"
    [[ "$text" == *gate-allow:* ]] && continue
    for pattern in '@ts-ignore' '@ts-nocheck' 'biome-ignore' 'eslint-disable' '.skip(' '.only(' 'it.todo(' 'test.todo(' 'describe.skip'; do
      [[ "$text" == *"$pattern"* ]] && fail "quality guard: $pattern in $current"
    done
    if [[ "$text" == *'@ts-expect-error'* && ! "$text" =~ @ts-expect-error[[:space:]]+[^[:space:]] ]]; then
      fail "quality guard: @ts-expect-error without a reason in $current"
    fi
    if [[ "$text" == *' as any'* ]] && ! is_test "$current"; then fail "quality guard: 'as any' in $current"; fi
    if is_test "$current" && [[ "$text" =~ (expect\(|assert) ]]; then
      added_asserts[$current]=$(( ${added_asserts[$current]:-0} + 1 ))
    fi
  elif [[ "$line" == -* ]] && is_test "$current" && [[ "${line:1}" =~ (expect\(|assert) ]]; then
    removed_asserts[$current]=$(( ${removed_asserts[$current]:-0} + 1 ))
  fi
done < <(git diff --unified=0 "$base" -- "${code_files[@]}" ':!scripts/gate.sh')

while IFS=$'\t' read -r status path _; do
  [[ "$status" == A ]] && is_test "$path" && added_tests=1
done < <(changes "${code_files[@]}")
for file in "${!removed_asserts[@]}"; do
  if (( ${removed_asserts[$file]} > ${added_asserts[$file]:-0} )) && (( added_tests == 0 )); then
    fail "quality guard: assertions removed from $file"
  fi
done

# 3. The project's checks.
if ! bash scripts/checks.sh >>"$log" 2>&1; then
  fail "checks failed (see gate.log)"
fi
echo "GATE: PASS" | tee -a "$log"
