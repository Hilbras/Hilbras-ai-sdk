#!/usr/bin/env bash
# @hilbras/next 2.3.0 — guard harness for tests/middleware.test.ts
#
# Reverts the trust-proxy fix one edit at a time and requires a named test to go
# red. The first mutation restores the exact v2.2.0 keying (`split(",")[0]`).
set -uo pipefail

cd /home/gin/work/Hilbras/SDK
SRC=src/frameworks/nextjs/edge/middleware.ts
SNAP=$(mktemp -d)/middleware.ts
cp "$SRC" "$SNAP"
restore() { cp "$SNAP" "$SRC"; }
trap restore EXIT INT TERM
fingerprint() { grep -c "trustProxy\|forwardedClientIp" "$SRC"; }

mutate() { # name  sed-expr  test-substring
  local name="$1" expr="$2" want="$3"
  restore
  sed -i "$expr" "$SRC"
  if cmp -s "$SNAP" "$SRC"; then
    echo "HARNESS-ERROR $name: sed matched nothing (stale pattern)"
    return 2
  fi
  local out
  out=$(npx vitest run tests/frameworks/next-middleware.test.ts --testNamePattern "$want" 2>&1)
  if echo "$out" | grep -qE "Tests +[0-9]+ failed"; then
    echo "KILLED   $name  (expects: $want)"
  else
    echo "HOLE     $name  (survived: $want)"
  fi
}

echo "== baseline =="
npx vitest run tests/frameworks/next-middleware.test.ts 2>&1 | grep -E "Tests +[0-9]+ (passed|failed)" || true
echo

echo "== mutations =="

# The v2.2.0 defect, verbatim: leftmost x-forwarded-for entry as the bucket key.
mutate "leftmost-entry-restored (the v2.2.0 defect)" \
  's|const index = entries.length - trustProxy;|const index = 0;|' \
  "rotates x-forwarded-for"

# The caller passes `trustProxy` into `forwardedClientIp`; hardcoding 1 there must
# be killed by a middleware-level test that uses a different depth, because a
# `forwardedClientIp` unit test never exercises the call site.
mutate "trust-depth-hardcoded-by-caller" \
  's|^      trustProxy,$|      1,|' \
  "trusts two proxies in the chain"

# A wrong trust depth passed through from the caller must surface end to end.
mutate "trust-depth-off-by-one" \
  's|const index = entries.length - trustProxy;|const index = entries.length - 1 - trustProxy;|' \
  "reads the nearest hop for one trusted proxy"

# EQUIVALENT MUTANT — verified, not a test gap.
# `if (index < 0) return undefined` is unobservable in JavaScript: every
# negative array index reads `undefined`, which is exactly what the guard
# returns. Checked exhaustively in node over 7 headers x trustProxy 0..11 —
# zero inputs differ. The guard is kept as documentation of intent and as
# insurance against a future refactor that changes the indexing, but no test
# can distinguish it from its removal, so none is written.
#
# mutate "out-of-range-check-removed" \
#   's|if (index < 0) return undefined;|if (false) return undefined;|' \
#   "exceeds the chain length"

mutate "empty-segment-filter-removed" \
  's|    .filter(Boolean);||' \
  "tolerates whitespace and empty segments"

mutate "x-real-ip-unguarded" \
  's|if (trustProxy > 0) {|if (true) {|' \
  "x-real-ip as a fallback only when a proxy is trusted"

mutate "shared-bucket-fallback-removed" \
  's|return "unidentified";|return `unidentified-${Math.random()}`;|' \
  "header-less callers in one bucket"

mutate "store-ignored" \
  's|await store.hit(key, windowSeconds \* 1000);|await createMemoryStore().hit(key, windowSeconds * 1000);|' \
  "uses the supplied store for counting"

mutate "cleanup-hook-ignored" \
  's|await store.cleanup?.();||' \
  "calls store.cleanup"

echo
restore
echo "restored; fingerprint: $(fingerprint)"
