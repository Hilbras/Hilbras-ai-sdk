#!/usr/bin/env bash
# @hilbras/next 2.3.0 — guard harness for tests/stream.test.ts
#
# `stream.ts` shipped with zero tests. Each mutation breaks one protocol or hook
# contract and requires a named test to go red. A survivor means the test claims
# coverage it cannot observe.
set -uo pipefail

cd /home/gin/work/Hilbras/SDK/packages/next
SRC=src/stream.ts
SNAP=$(mktemp -d)/stream.ts
cp "$SRC" "$SNAP"
restore() { cp "$SNAP" "$SRC"; }
trap restore EXIT INT TERM
fingerprint() { grep -c "onRequest\|onComplete\|stream_failed" "$SRC"; }

mutate() { # name  sed-expr  test-substring
  local name="$1" expr="$2" want="$3"
  restore
  sed -i "$expr" "$SRC"
  if cmp -s "$SNAP" "$SRC"; then
    echo "HARNESS-ERROR $name: sed matched nothing (stale pattern)"
    return 2
  fi
  local out
  out=$(npx vitest run tests/stream.test.ts --testNamePattern "$want" 2>&1)
  if echo "$out" | grep -qE "Tests +[0-9]+ failed"; then
    echo "KILLED   $name  (expects: $want)"
  else
    echo "HOLE     $name  (survived: $want)"
  fi
}

echo "== baseline =="
npx vitest run tests/stream.test.ts 2>&1 | grep -E "Tests +[0-9]+ (passed|failed)" || true
echo
echo "== mutations =="

mutate "text-frame-dropped" \
  's|controller.enqueue(encoder.encode(`0:${JSON.stringify(chunk.text)}\\n`));||' \
  "emits text, usage and finish frames"

mutate "usage-frame-dropped" \
  's|encoder.encode(`1:${JSON.stringify({ inputTokens, outputTokens })}\\n`),|encoder.encode(""),|' \
  "emits text, usage and finish frames"

mutate "finish-frame-dropped" \
  's|controller.enqueue(encoder.encode(`2:${JSON.stringify(chunk.reason)}\\n`));||' \
  "emits text, usage and finish frames"

mutate "stream-failure-frame-dropped" \
  's|controller.enqueue(encoder.encode(`3:${JSON.stringify("stream_failed")}\\n`));||' \
  "encodes a stream failure as a 3: frame"

mutate "completion-failure-text-changed" \
  's|controller.enqueue(encoder.encode("stream_failed"));|controller.enqueue(encoder.encode(""));|' \
  "literal text stream_failed"

mutate "onRequest-never-called" \
  's|await onRequest?.(messages);||' \
  "calls onRequest before streaming starts"

mutate "onComplete-never-called" \
  's|await onComplete?.(messages, { inputTokens, outputTokens });||' \
  "calls onComplete with accumulated usage"

mutate "onError-never-called" \
  's|await onError?.(error);||' \
  "calls onError with the provider failure"

# Wrapping `onComplete` in its own try/catch. This is a genuine behaviour change
# ONLY in the case that `onComplete` itself throws: the original lets the outer
# catch emit the `3:` frame, the mutant swallows it. Both new tests below pin
# that, so this mutation is killed by "treats a throwing onComplete as a stream
# failure" — not by the guard above, which cannot see it.
mutate "onComplete-invoked-despite-failure" \
  's|^            await onComplete?.(messages, { inputTokens, outputTokens });|            try { await onComplete?.(messages, { inputTokens, outputTokens }); } catch { /* moved */ }|' \
  "throwing onComplete"

# Moving `onComplete` from the try body into `finally` would make it fire even
# when the provider threw. Same assertion, structurally different mutation.
mutate "onComplete-moved-to-finally" \
  's|^            controller.close();|            await onComplete?.(messages, { inputTokens, outputTokens }); controller.close();|' \
  "does not call onComplete when the stream failed"

mutate "system-prompt-dropped" \
  's|if (systemPrompt) apiMessages.push({ role: "system", content: systemPrompt });||' \
  "prepends a system prompt"

mutate "role-validation-removed" \
  's|!ROLES.has(candidate.role)|false|' \
  "rejects a message with an unknown role"

mutate "messages-array-check-removed" \
  's|if (!Array.isArray(value)) throw new Error("Request body must include a messages array");|if (!Array.isArray(value)) value = [];|' \
  "rejects a body with no messages array"

mutate "provider-name-hardcoded" \
  's|provider: route.provider,|provider: "openai",|' \
  "uses the supplied client verbatim"

mutate "completion-prompt-check-removed" \
  's|if (typeof record.prompt !== "string" \|\| !record.prompt.trim()) {|if (false) {|' \
  "rejects a whitespace-only prompt"

echo
restore
echo "restored; fingerprint: $(fingerprint)"
