# Authorization examples

These examples demonstrate the v3.4 enforcement controls.

- `rbac.ts` — provider/model/tool restrictions, strict enforcement, audit attribution
- `tool-policy.ts` — `allowedTools` / `deniedTools` enforced where tools run
- `signing.ts` — the body-bound `v2` signature profile and replay protection

Authorization runs at the transport layer, so a denied request never reaches a
provider. Tool policy is enforced separately, at the point where a tool would
actually execute, because tools run locally and never leave the process.
