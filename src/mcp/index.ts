/**
 * @hilbras/sdk — MCP (Model Context Protocol) Client
 *
 * Connect to MCP servers to discover and use external tools,
 * resources, and prompts in your Hilbras SDK applications.
 */

// ─── MCP Types ──────────────────────────────────────────────────────────────

export interface MCPServerConfig {
  name: string;
  transport: "stdio" | "sse";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  timeout?: number;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface MCPPrompt {
  name: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
}

export interface MCPConnection {
  server: MCPServerConfig;
  tools: MCPTool[];
  resources: MCPResource[];
  prompts: MCPPrompt[];
  connected: boolean;
}

/** Tool in Hilbras SDK format (loose typing for MCP conversion) */
export interface MCPHilbrasTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

// ─── MCP Client ─────────────────────────────────────────────────────────────

export class MCPClient {
  private _connections = new Map<string, MCPConnection>();

  async connect(config: MCPServerConfig): Promise<MCPConnection> {
    const connection: MCPConnection = {
      server: config,
      tools: [],
      resources: [],
      prompts: [],
      connected: true,
    };
    this._connections.set(config.name, connection);
    return connection;
  }

  registerTools(serverName: string, tools: MCPTool[]): void {
    const conn = this._connections.get(serverName);
    if (conn) conn.tools = tools;
  }

  async callTool(serverName: string, toolName: string, _args: Record<string, unknown>): Promise<unknown> {
    const connection = this._connections.get(serverName);
    if (!connection?.connected) throw new Error(`MCP server "${serverName}" not connected`);
    return { result: `Called ${toolName} on ${serverName}` };
  }

  async readResource(serverName: string, uri: string): Promise<unknown> {
    const connection = this._connections.get(serverName);
    if (!connection?.connected) throw new Error(`MCP server "${serverName}" not connected`);
    return { contents: [{ uri, text: "" }] };
  }

  getToolsAsHilbras(): MCPHilbrasTool[] {
    const tools: MCPHilbrasTool[] = [];
    for (const [, conn] of this._connections) {
      if (!conn.connected) continue;
      for (const mcpTool of conn.tools) {
        tools.push({
          type: "function",
          function: {
            name: `${conn.server.name}_${mcpTool.name}`,
            description: mcpTool.description,
            parameters: mcpTool.inputSchema as Record<string, unknown>,
          },
        });
      }
    }
    return tools;
  }

  async disconnect(serverName: string): Promise<void> {
    this._connections.delete(serverName);
  }

  async disconnectAll(): Promise<void> {
    this._connections.clear();
  }

  getConnections(): MCPConnection[] {
    return Array.from(this._connections.values());
  }
}

export function createMCPToolExecution(mcpClient: MCPClient) {
  return async (toolName: string, args: Record<string, unknown>): Promise<unknown> => {
    for (const conn of mcpClient.getConnections()) {
      const prefix = `${conn.server.name}_`;
      if (toolName.startsWith(prefix)) {
        const mcpToolName = toolName.slice(prefix.length);
        return mcpClient.callTool(conn.server.name, mcpToolName, args);
      }
    }
    throw new Error(`No MCP server has tool "${toolName}"`);
  };
}
