import { describe, expect, it } from "vitest";
import { HilbrasClient } from "../src/client/client.js";
import { listProviders } from "../src/catalog/index.js";

describe("provider catalog integration", () => {
  it("accepts a display-name provider id case-insensitively", () => {
    const client = new HilbrasClient();
    const registeredName = client.addProviderFromCatalog("OpenAI", "gpt-4o", "test-key");
    expect(registeredName).toBe("OpenAI");
    expect(client.getProvider(registeredName)?.baseUrl).toBe("https://api.openai.com/v1");
    expect(listProviders()).toContain("openai");
  });
});
