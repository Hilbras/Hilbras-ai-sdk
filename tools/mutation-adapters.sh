#!/usr/bin/env bash
# @hilbras/sdk — guard harness for tests/adapters/openai-compatible.test.ts
#
# Nine adapter files shipped at 0% coverage. A suite that has never failed is
# indistinguishable from one that cannot fail, so each mutation breaks one
# behaviour and requires a named test to go red.
set -uo pipefail

cd /home/gin/work/Hilbras/SDK
SRC=src/adapters/openai-compatible.ts
SNAP=$(mktemp -d)/adapter.ts
cp "$SRC" "$SNAP"
restore() { cp "$SNAP" "$SRC"; }
trap 'restore; cp "$ESNAP" "$EXTRA"' EXIT INT TERM
fingerprint() { grep -c "supportsNativeTools\|_transformBody\|argumentsDelta\|res.status === 400" "$SRC"; }

EXTRA=src/adapters/extra.ts
ESNAP=$(mktemp -d)/extra.ts
cp "$EXTRA" "$ESNAP"

mutate_file() { # file  name  sed-expr  test-substring
  local file="$1" name="$2" expr="$3" want="$4"
  cp "$ESNAP" "$EXTRA"
  sed -i "$expr" "$file"
  if cmp -s "$ESNAP" "$file"; then
    echo "HARNESS-ERROR $name: sed matched nothing (stale pattern)"
    cp "$ESNAP" "$EXTRA"; return 2
  fi
  local out
  out=$(npx vitest run tests/adapters/openai-compatible.test.ts --testNamePattern "$want" 2>&1)
  if echo "$out" | grep -qE "Tests +[0-9]+ failed|Tests +no tests|Test Files +[0-9]+ failed"; then
    echo "KILLED   $name  (expects: $want)"
  else
    echo "HOLE     $name  (survived: $want)"
  fi
  cp "$ESNAP" "$EXTRA"
}

mutate() { # name  sed-expr  test-substring
  local name="$1" expr="$2" want="$3"
  restore
  sed -i "$expr" "$SRC"
  if cmp -s "$SNAP" "$SRC"; then
    echo "HARNESS-ERROR $name: sed matched nothing (stale pattern)"
    return 2
  fi
  local out
  out=$(npx vitest run tests/adapters/openai-compatible.test.ts --testNamePattern "$want" 2>&1)
  if echo "$out" | grep -qE "Tests +[0-9]+ failed|Tests +no tests|Test Files +[0-9]+ failed"; then
    echo "KILLED   $name  (expects: $want)"
  else
    echo "HOLE     $name  (survived: $want)"
  fi
}

echo "== baseline =="
npx vitest run tests/adapters/openai-compatible.test.ts 2>&1 | grep -E "Tests +[0-9]+ (passed|failed)" || true
echo
echo "== mutations =="

mutate "bearer-auth-dropped" \
  's|headers\["Authorization"\] = `Bearer ${auth.apiKey}`;|headers["Authorization"] = "";|' \
  "applies bearer auth"

mutate "custom-header-auth-dropped" \
  's|headers\[auth.name\] = auth.value;|headers[auth.name] = "";|' \
  "applies custom-header auth"

mutate "max-tokens-always-sent" \
  's|if (params.maxTokens != null \&\& params.maxTokens > 0) {|if (false) {|' \
  "omits max_tokens when unset"

mutate "tools-always-sent" \
  's|if (this._supportsNativeTools \&\& params.tools?.length) {|if (params.tools?.length) {|' \
  "omits tools entirely when supportsNativeTools"

mutate "transformBody-ignored" \
  's|if (this._transformBody) {|if (false) {|' \
  "applies transformBody last"

mutate "extra-allowlist-dropped" \
  's|assertExtraFieldAllowed(k);|/* dropped */;|' \
  "refuses an extra field that would override"

# assertExtraFieldAllowed lives in src/adapters/extra.ts, not the adapter under
# test, so it needs its own snapshot or the restore would leave that file mutated.
mutate_file "src/adapters/extra.ts" "extra-pollution-guard-dropped" \
  's@if (key === "__proto__" || key === "prototype" || key === "constructor") {@if (false) {@' \
  "refuses prototype-polluting"


mutate "tool-choice-dropped" \
  's|body.tool_choice = "auto";||' \
  "includes tools and tool_choice"

mutate "reasoning-mapped-to-text" \
  's@const reasoningContent = (delta.reasoning_content ?? delta.thinking)@const reasoningContent = (undefined as string | undefined)@' \
  "surfaces reasoning_content as reasoning"

mutate "thinking-field-ignored" \
  's|?? delta.thinking|?? undefined|' \
  "reads the .thinking. field as reasoning"

mutate "stream-usage-dropped" \
  's|inputTokens: usage.prompt_tokens ?? 0,|inputTokens: 0,|' \
  "reports usage when the provider sends it"

mutate "degradation-never-retries" \
  's|if (res.status === 400) {|if (false) {|' \
  "retries without max_tokens"

mutate "degradation-retries-any-400" \
  's@if (/max_tokens|max completion|max_tokens.*(?:exceed|too large|must be)|context length/i.test(errorBody)) {@if (true) {@' \
  "does not retry a 400 unrelated"

mutate "embed-usage-dropped" \
  's|inputTokens: usage?.prompt_tokens ?? 0,|inputTokens: 0,|' \
  "posts to /embeddings"

mutate "embed-dimensions-dropped" \
  's|if (params.dimensions != null) body.dimensions = params.dimensions;||' \
  "passes dimensions through"

echo
restore
echo "restored; fingerprint: $(fingerprint)"
