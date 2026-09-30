import { HilbrasClient, createRuntimeSource } from "@hilbras/sdk";

const client = new HilbrasClient({
  configSources: [
    createRuntimeSource({
      temperature: 0.3,
      maxRetries: 2,
      requestTimeoutMs: 30_000,
    }),
  ],
});

console.log(client.getConfigDiagnostics());
console.log(client.getConfigSnapshot());
