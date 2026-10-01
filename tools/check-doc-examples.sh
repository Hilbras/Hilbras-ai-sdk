#!/usr/bin/env bash
# @hilbras/sdk — documentation example guard
#
# Every tsx / ts / typescript example in the guarded docs is extracted and
# typechecked, one file per fenced block, against the BUILT package. Blocks are
# checked in isolation because a reader pastes one example — not the
# concatenation of all of them, where duplicate identifiers mask real errors.
#
# This exists because six examples had drifted into code that cannot compile:
# `handleInputChange` (not on UseChatReturn), `messages()` called as a function
# where it is an array, `useChat` imported from the package root (which exports
# no hooks at all), and an Angular example importing `useChat` / `ChatService`
# when the module exports `HilbrasChatService`. Nothing in the toolchain
# objected: tsc does not read markdown, and `typecheck:examples` only covers
# `examples/`.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

DOCS=("$REPO/docs/frameworks.md" "$REPO/docs/security.md" "$REPO/docs/api-reference.md")
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT INT TERM

echo "== build (examples are checked against dist/, not src/) =="
npm run build >/dev/null 2>&1 || { echo "HARNESS-ERROR: build failed"; exit 2; }

cat > "$WORK/package.json" <<'JSON'
{ "type": "module" }
JSON

cat > "$WORK/tsconfig.json" <<'JSON'
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "Node16",
    "moduleResolution": "Node16",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "lib": ["ES2023", "DOM"],
    "types": ["node"]
  },
  "include": ["ex"]
}
JSON

cd "$WORK"

# Framework peer deps are optional in the SDK, so the checker needs them present.
# Installed in one command because a later --no-save install prunes earlier ones.
npm install --no-save --silent typescript @types/react @types/node react @angular/core >/dev/null 2>&1

# npm install rewrites node_modules, so the link and the extracted examples are
# re-established afterwards rather than before.
mkdir -p node_modules/@hilbras ex
ln -sfn "$REPO" node_modules/@hilbras/sdk

if ! N=$(node "$REPO/tools/extract-doc-examples.mjs" "$WORK/ex" "${DOCS[@]}"); then
  echo "HARNESS-ERROR: no examples extracted (stale pattern?)"
  exit 2
fi
echo "examples found: $N  (${#DOCS[@]} documents)"

OUT=$(npx tsc -p tsconfig.json 2>&1)
if [ -z "$OUT" ]; then
  echo "OK   all $N examples typecheck against the built package"
else
  echo "FAIL documentation examples do not compile:"
  echo "$OUT" | head -40
  exit 1
fi
