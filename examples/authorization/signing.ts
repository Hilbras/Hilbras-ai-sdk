import { HilbrasClient, ReplayGuard, RequestSigner, signingMiddleware } from "@hilbras/sdk";

/**
 * The `v2` profile binds the request body, the key id, and a per-request nonce
 * into the signature. `v1` remains the default and does not authenticate the
 * body — see the migration guide before switching a live verifier.
 */
const signer = new RequestSigner({
  secret: process.env.GATEWAY_SECRET!,
  keyId: "key-2026-09",
  profile: "v2",
});

const client = new HilbrasClient({ middleware: signingMiddleware(signer) });

/**
 * On the receiving side, verify the signature and reject replays. A signature
 * proves authorship, not freshness; the guard supplies the timestamp window and
 * the seen-signature cache.
 */
export function verifyInbound(
  url: string,
  method: string,
  body: string | Uint8Array,
  headers: Record<string, string>,
): { valid: boolean; reason?: string } {
  const verifier = new RequestSigner({
    secret: process.env.GATEWAY_SECRET!,
    keyId: "key-2026-09",
    profile: "v2",
  });
  const guard = new ReplayGuard({ maxAgeMs: 5 * 60_000, maxSkewMs: 30_000 });

  return verifier.verifyFresh(
    url,
    { method, body, headers },
    headers["x-hilbras-signature"],
    { guard },
  );
}
