import { describe, it, expect } from "vitest";
import { MCPClient, createMCPToolExecution } from "../src/index.js";

describe("MCPClient", () => {
  it("can be instantiated", () => {
    const client = new MCPClient();
    expect(client).toBeDefined();
  });

  it("getConnections returns empty array initially", () => {
    const client = new MCPClient();
    expect(client.getConnections()).toEqual([]);
  });

  it("getToolsAsHilbras returns empty array initially", () => {
    const client = new MCPClient();
    expect(client.getToolsAsHilbras()).toEqual([]);
  });

  it("disconnect non-existent server does not throw", async () => {
    const client = new MCPClient();
    await expect(client.disconnect("nonexistent")).resolves.not.toThrow();
  });

  it("disconnectAll does not throw when empty", async () => {
    const client = new MCPClient();
    await expect(client.disconnectAll()).resolves.not.toThrow();
  });

  it("callTool throws when server not connected", async () => {
    const client = new MCPClient();
    await expect(client.callTool("nonexistent", "tool", {})).rejects.toThrow("not connected");
  });

  it("readResource throws when server not connected", async () => {
    const client = new MCPClient();
    await expect(client.readResource("nonexistent", "file:///test")).rejects.toThrow("not connected");
  });
});

describe("createMCPToolExecution", () => {
  it("throws for unknown tool", async () => {
    const client = new MCPClient();
    const executor = createMCPToolExecution(client);
    await expect(executor("unknown_tool", {})).rejects.toThrow("No MCP server has tool");
  });
});
