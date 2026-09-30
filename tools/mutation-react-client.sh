#!/usr/bin/env bash
# @hilbras/sdk — guard harness for tests/frameworks/react-client.test.ts
#
# The suite has four tests. One asserts exports exist; the other three assert
# properties that a future refactor could silently break. Each mutation below
# breaks exactly one and requires a named test to go red.
set -uo pipefail

cd /home/gin/work/Hilbras/SDK
SRC=src/frameworks/react-client/provider.ts
SNAP=$(mktemp -d)/provider.ts
cp "$SRC" "$SNAP"
restore() { cp "$SNAP" "$SRC"; }
trap restore EXIT INT TERM
fingerprint() { grep -c "HilbrasContext\|createElement" "$SRC"; }

mutate() { # name  sed-expr  test-substring
  local name="$1" expr="$2" want="$3"
  restore
  sed -i "$expr" "$SRC"
  if cmp -s "$SNAP" "$SRC"; then
    echo "HARNESS-ERROR $name: sed matched nothing (stale pattern)"
    return 2
  fi
  local out
  out=$(npx vitest run tests/frameworks/react-client.test.ts --testNamePattern "$want" 2>&1)
  # Two ways this suite can fail: an assertion failure ("Tests N failed"), or a
  # module that cannot be collected at all — which is what a stray JSX return
  # produces under a tsconfig with no --jsx, and it prints "Tests no tests".
  # Checking only the first reported a real kill as a hole.
  if echo "$out" | grep -qE "Tests +[0-9]+ failed|Tests +no tests|Test Files +[0-9]+ failed"; then
    echo "KILLED   $name  (expects: $want)"
  else
    echo "HOLE     $name  (survived: $want)"
  fi
}

echo "== baseline =="
npx vitest run tests/frameworks/react-client.test.ts 2>&1 | grep -E "Tests +[0-9]+ (passed|failed)" || true
echo
echo "== mutations =="

# The browser-credential warning is the whole reason this subpath is reachable,
# and it lives only in a doc comment, so nothing else would notice its removal.
mutate "security-warning-removed" \
  's/@warning Passing an API key here bundles it into your client-side/@warning removed/' \
  "browser-credential warning"

mutate "provider-warning-removed" \
  's/calls providers \*\*from the browser\*\*/runs somewhere/' \
  "warning that the provider calls providers from the browser"

# A bare `return children` keeps every export a function while making the
# context unreachable, so an export-shape test cannot see it.
mutate "provider-render-removed" \
  's|  return createElement(HilbrasContext.Provider, { value }, children);|  return children as never;|' \
  "renders its children through context"

# The provider element is built with createElement, not JSX: the SDK ships no
# .tsx and its tsconfig sets no --jsx, so a stray JSX return breaks the build.
mutate "jsx-introduced" \
  's|  return createElement(HilbrasContext.Provider, { value }, children);|   return <HilbrasContext.Provider value={value}>{children}</HilbrasContext.Provider>;|' \
  "createElement, not JSX"

echo
restore
echo "restored; fingerprint: $(fingerprint)"
