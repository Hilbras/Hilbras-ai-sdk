#!/usr/bin/env bash
# @hilbras/sdk — v3.5.0 guard harness for tests/frameworks/route-security.test.ts
#
# Each mutation removes exactly one control from the shared core and asserts
# that a specific, named test goes red. A mutation that leaves the suite green
# is a HOLE: it means the test claims to cover a control it cannot observe.
#
# The core file is snapshotted first and restored from that snapshot on exit,
# so an interrupted run cannot leave a mutation in the source.
set -uo pipefail

cd /home/gin/work/Hilbras/SDK
CORE=src/frameworks/shared/handler-core.ts
SNAP=$(mktemp -d)/handler-core.ts
SPECIAL="$SNAP.special"

cp "$CORE" "$SNAP"
restore() { cp "$SNAP" "$CORE"; }
trap restore EXIT INT TERM

# Fingerprints to prove nothing survived an interrupted run.
fingerprint() { grep -c "maxBodyBytes\|trustClientFields" "$CORE"; }

mutate() { # name  sed-expr  test-substring
  local name="$1" expr="$2" want="$3"
  restore
  cp "$SNAP" "$SPECIAL"
  sed -i "$expr" "$CORE"
  if cmp -s "$SNAP" "$CORE"; then
    echo "HARNESS-ERROR $name: sed matched nothing (stale pattern)"
    return 2
  fi
  local out
  out=$(npx vitest run tests/frameworks/route-security.test.ts \
          --testNamePattern "$want" 2>&1)
  if echo "$out" | grep -qE "Tests +[0-9]+ failed"; then
    echo "KILLED   $name  (expects: $want)"
  else
    echo "HOLE     $name  (survived: $want)"
  fi
}

echo "== baseline: suite must be green before any mutation =="
npx vitest run tests/frameworks/route-security.test.ts 2>&1 \
  | grep -E "Tests +[0-9]+ (passed|failed)" || true
echo

echo "== mutations =="
# The hooks are invoked in the adapter, not the core — mutating the core's own
# copy of the call would be a no-op, so these target src/frameworks/nextjs/.
ADAPTER=src/frameworks/nextjs/route-handlers.ts
ASNAP=$(mktemp -d)/route-handlers.ts
cp "$ADAPTER" "$ASNAP"
arestore() { cp "$ASNAP" "$ADAPTER"; cp "$SNAP" "$CORE"; }
trap arestore EXIT INT TERM

amutate() { # name  sed-expr  test-substring
  local name="$1" expr="$2" want="$3"
  arestore
  sed -i "$expr" "$ADAPTER"
  if cmp -s "$ASNAP" "$ADAPTER"; then
    echo "HARNESS-ERROR $name: sed matched nothing (stale pattern)"
    return 2
  fi
  local out
  out=$(npx vitest run tests/frameworks/route-security.test.ts \
          --testNamePattern "$want" 2>&1)
  if echo "$out" | grep -qE "Tests +[0-9]+ failed"; then
    echo "KILLED   $name  (expects: $want)"
  else
    echo "HOLE     $name  (survived: $want)"
  fi
}

mutate "body-size-limit-removed" \
  's/if (Number.isFinite(declared) \&\& declared > limits.maxBodyBytes) {/if (false) {/' \
  "content-length hint alone"

mutate "body-size-read-check-removed" \
  's/if (new TextEncoder().encode(raw).byteLength > limits.maxBodyBytes) {/if (false) {/' \
  "measures bytes, not characters"

amutate "onRequest-never-invoked" \
  's/await options.onRequest?.({ request: req, body, effective });/void effective;/' \
  "rejects with the status the hook throws"

mutate "trustClientFields-ignored" \
  's/const trust = options.trustClientFields;/const trust = true;/' \
  "ignores body.model when false"

mutate "maxStepsClamp-removed" \
  's/maxSteps: typeof maxStepsRaw === "number" ? Math.min(maxStepsRaw, options.limits.maxStepsClamp) : undefined,/maxSteps: maxStepsRaw,/' \
  "clamps body.maxSteps"

mutate "maxTokensClamp-removed" \
  's|? Math.min(body.maxTokens, options.limits.maxTokensClamp)|? body.maxTokens|' \
  "clamps body.maxTokens"

mutate "temperatureClamp-removed" \
  's|clampNumber(body.temperature, tempMin, tempMax)|body.temperature|' \
  "clamps temperature"

mutate "maxMessages-limit-removed" \
  's/if (messages.length > options.limits.maxMessages) {/if (false) {/' \
  "rejects more messages than maxMessages"

mutate "maxTools-limit-removed" \
  's/if (body.tools.length > options.limits.maxTools) {/if (false) {/' \
  "rejects more tools than maxTools"

amutate "onError-never-invoked" \
  's/if (options.onError) {/if (false) {/' \
  "receives a provider-phase error"

echo
arestore
echo "restored; core fingerprint: $(fingerprint)"
echo "adapter onRequest lines: $(grep -c 'options.onRequest' "$ADAPTER")"
