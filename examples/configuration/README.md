# Configuration examples

These examples demonstrate the v3.3 configuration resolver.

- `runtime.ts` — runtime configuration without filesystem access
- `file.ts` — explicit Node file reading through an injected reader

Both examples use `client.getConfigSnapshot()` and
`client.getConfigDiagnostics()` for safe inspection.
