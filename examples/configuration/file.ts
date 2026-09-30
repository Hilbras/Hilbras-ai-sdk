import { readFileSync } from "node:fs";
import { HilbrasClient, createFileSource } from "@hilbras/sdk";

const client = new HilbrasClient({
  configSources: [
    createFileSource({
      path: "./hilbras.config.json",
      readFile: (path) => readFileSync(path, "utf8"),
    }),
  ],
});

console.log(client.getConfigSnapshot());
