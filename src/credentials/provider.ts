/**
 * @hilbras/sdk — Credential Provider
 *
 * Resolves credentials from various sources without exposing secrets throughout the app.
 * Supports explicit tokens, environment variables, and future keychain integration.
 */

export type CredentialSource =
  | { type: "explicit"; apiKey: string }
  | { type: "environment"; variable: string };

export interface CredentialProvider {
  resolve(source: CredentialSource): Promise<string>;
}

export class DefaultCredentialProvider implements CredentialProvider {
  async resolve(source: CredentialSource): Promise<string> {
    switch (source.type) {
      case "explicit":
        return source.apiKey;
      case "environment": {
        const value = process.env[source.variable];
        if (!value) {
          throw new Error(`Environment variable '${source.variable}' is not set`);
        }
        return value;
      }
    }
  }
}

/** Singleton for credential resolution */
let _default: CredentialProvider | null = null;

export function getCredentialProvider(): CredentialProvider {
  if (!_default) _default = new DefaultCredentialProvider();
  return _default;
}

export function setCredentialProvider(provider: CredentialProvider): void {
  _default = provider;
}
