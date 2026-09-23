/**
 * @hilbras/sdk — AWS Bedrock Adapter
 *
 * Handles AWS Bedrock Converse API. Supports Claude, Llama, Mistral,
 * and other models available through Bedrock.
 *
 * Authentication: AWS SigV4 signing with access key + secret key.
 * Configure via ProviderConfig:
 *   - baseUrl: "https://bedrock-runtime.{region}.amazonaws.com"
 *   - authentication: { type: "bearer", apiKey: AWS_SECRET_ACCESS_KEY }
 *   - extraHeaders: { "x-aws-access-key-id": ACCESS_KEY_ID, "x-aws-session-token": SESSION_TOKEN? }
 *
 * API format:
 * - Chat: POST /model/{modelId}/converse-stream (streaming)
 * - Chat: POST /model/{modelId}/converse (non-streaming)
 * - Embeddings: POST /model/{modelId}/invoke (for embedding models)
 */

import { createHash, createHmac } from "node:crypto";
import type { Transport } from "../transport/transport.js";
import type { ProviderConfig } from "../types/providers.js";
import type { Message } from "../types/messages.js";
import type { Tool } from "../types/tools.js";
import type { StreamChunk } from "../types/streams.js";
import type { AIProvider, AdapterConfig } from "../types/adapter.js";
import type { EmbeddingParams, EmbeddingResult } from "../types/multi-modal.js";
import { ProviderRequestError } from "../errors/index.js";
import { ReasoningNormalizer } from "../reasoning/normalizer.js";

export interface BedrockAdapterConfig extends AdapterConfig {
  /** AWS region (default: extracted from baseUrl or us-east-1) */
  region?: string;
}

/** AWS SigV4 signing helper */
class AwsSigV4 {
  private _accessKeyId: string;
  private _secretAccessKey: string;
  private _sessionToken?: string;
  private _region: string;
  private _service = "bedrock";

  constructor(opts: { accessKeyId: string; secretAccessKey: string; sessionToken?: string; region: string }) {
    this._accessKeyId = opts.accessKeyId;
    this._secretAccessKey = opts.secretAccessKey;
    this._sessionToken = opts.sessionToken;
    this._region = opts.region;
  }

  private _sha256(data: string): string {
    return createHash("sha256").update(data).digest("hex");
  }

  private _hmacSha256(key: string | Buffer, data: string): Buffer {
    return createHmac("sha256", key).update(data).digest();
  }

  private _getSigningKey(date: string): Buffer {
    const kDate = this._hmacSha256(`AWS4${this._secretAccessKey}`, date);
    const kRegion = this._hmacSha256(kDate, this._region);
    const kService = this._hmacSha256(kRegion, this._service);
    return this._hmacSha256(kService, "aws4_request");
  }

  sign(method: string, url: string, body: string, headers: Record<string, string>): Record<string, string> {
    const now = new Date();
    const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, "");
    const amzDate = dateStamp + "T" + now.toISOString().slice(11, 19).replace(/:/g, "") + "Z";

    const parsed = new URL(url);
    const payloadHash = this._sha256(body);

    // Normalize headers
    const normalized: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) {
      normalized[k.toLowerCase().trim()] = v.trim();
    }
    normalized["host"] = parsed.host;
    normalized["x-amz-date"] = amzDate;
    normalized["x-amz-content-sha256"] = payloadHash;
    if (this._sessionToken) {
      normalized["x-amz-security-token"] = this._sessionToken;
    }

    const signedHeaders = Object.keys(normalized).sort();
    const canonicalHeaders = signedHeaders.map((h) => `${h}:${normalized[h]}`).join("\n") + "\n";
    const signedHeadersStr = signedHeaders.join(";");

    const canonicalRequest = [
      method.toUpperCase(),
      parsed.pathname,
      parsed.searchParams.toString(),
      canonicalHeaders,
      signedHeadersStr,
      payloadHash,
    ].join("\n");

    const credentialScope = `${dateStamp}/${this._region}/${this._service}/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      this._sha256(canonicalRequest),
    ].join("\n");

    const signingKey = this._getSigningKey(dateStamp);
    const signature = this._hmacSha256(signingKey, stringToSign).toString("hex");

    const authHeader = `AWS4-HMAC-SHA256 Credential=${this._accessKeyId}/${credentialScope}, SignedHeaders=${signedHeadersStr}, Signature=${signature}`;

    const result: Record<string, string> = { ...headers };
    result["Authorization"] = authHeader;
    result["X-Amz-Date"] = amzDate;
    result["X-Amz-Content-Sha256"] = payloadHash;
    if (this._sessionToken) {
      result["X-Amz-Security-Token"] = this._sessionToken;
    }
    return result;
  }
}

export class BedrockAdapter implements AIProvider {
  readonly id = "bedrock";
  private _provider: ProviderConfig;
  private _transport: Transport;
  private _region: string;
  private _signer: AwsSigV4;

  constructor(config: BedrockAdapterConfig) {
    this._provider = config.provider;
    this._transport = config.transport;
    this._region = config.region ?? this._extractRegion() ?? "us-east-1";

    const auth = this._provider.authentication;
    if (auth.type !== "bearer" || !auth.apiKey) {
      throw new Error("Bedrock requires 'bearer' authentication with AWS secret access key as apiKey. Pass access key ID via extraHeaders['x-aws-access-key-id'].");
    }

    // Extract AWS credentials:
    // - secretAccessKey: from authentication.apiKey
    // - accessKeyId: from extraHeaders['x-aws-access-key-id']
    // - sessionToken: from extraHeaders['x-aws-session-token'] (optional)
    const extraHeaders = this._provider.extraHeaders ?? {};
    const accessKeyId = extraHeaders["x-aws-access-key-id"] ?? "";
    const sessionToken = extraHeaders["x-aws-session-token"];

    if (!accessKeyId) {
      throw new Error("Bedrock requires x-aws-access-key-id in extraHeaders. Set extraHeaders: { 'x-aws-access-key-id': 'YOUR_KEY_ID' } on your provider config.");
    }

    this._signer = new AwsSigV4({
      accessKeyId,
      secretAccessKey: auth.apiKey,
      sessionToken,
      region: this._region,
    });
  }

  private _extractRegion(): string | undefined {
    const url = this._provider.baseUrl;
    const match = url.match(/bedrock-runtime\.([a-z0-9-]+)\.amazonaws\.com/);
    return match?.[1];
  }

  private _modelId(model: string): string {
    // Bedrock uses full model IDs like "anthropic.claude-3-5-sonnet-20241022-v2:0"
    // Allow users to pass short names that we map
    if (model.includes(".")) return model;

    // Common shorthand mappings
    const mappings: Record<string, string> = {
      "claude-sonnet": "anthropic.claude-3-5-sonnet-20241022-v2:0",
      "claude-haiku": "anthropic.claude-3-haiku-20240307-v1:0",
      "claude-opus": "anthropic.claude-3-opus-20240229-v1:0",
      "llama-3.1-70b": "meta.llama3-1-70b-instruct-v1:0",
      "llama-3.1-8b": "meta.llama3-1-8b-instruct-v1:0",
      "mistral-large": "mistral.mistral-large-2402-v1:0",
      "mistral-7b": "mistral.mistral-7b-instruct-v0:2",
    };
    return mappings[model] ?? model;
  }

  private _convertMessages(messages: Message[]): { system?: string; messages: Array<Record<string, unknown>> } {
    let system: string | undefined;
    const converted: Array<Record<string, unknown>> = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        system = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
        continue;
      }

      const bedrockMsg: Record<string, unknown> = {
        role: msg.role,
        content: [],
      };

      // Convert tool calls (assistant messages with tool_calls)
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          (bedrockMsg.content as Array<Record<string, unknown>>).push({
            toolUse: {
              id: tc.id,
              name: tc.function.name,
              input: JSON.parse(tc.function.arguments || "{}"),
            },
          });
        }
      }

      // Convert tool results
      if (msg.tool_call_id) {
        bedrockMsg.role = "user";
        (bedrockMsg.content as Array<Record<string, unknown>>).push({
          toolResult: {
            toolUseId: msg.tool_call_id,
            content: [{ text: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content) }],
          },
        });
      } else if (typeof msg.content === "string" && !msg.tool_calls) {
        (bedrockMsg.content as Array<Record<string, unknown>>).push({ text: msg.content });
      } else if (msg.content == null && !msg.tool_calls) {
        (bedrockMsg.content as Array<Record<string, unknown>>).push({ text: "" });
      }

      converted.push(bedrockMsg);
    }

    return { system, messages: converted };
  }

  private _convertTools(tools?: Tool[]): Array<Record<string, unknown>> | undefined {
    if (!tools?.length) return undefined;
    return tools.map((t) => ({
      toolSpec: {
        name: t.function.name,
        description: t.function.description,
        inputSchema: {
          json: t.function.parameters,
        },
      },
    }));
  }

  private _buildConverseBody(params: {
    model: string;
    messages: Message[];
    temperature?: number;
    maxTokens?: number;
    tools?: Tool[];
    stream: boolean;
  }): Record<string, unknown> {
    const { system, messages } = this._convertMessages(params.messages);
    const body: Record<string, unknown> = {
      modelId: this._modelId(params.model),
      messages,
    };

    if (system) {
      body.system = [{ text: system }];
    }

    if (params.temperature != null) {
      body.inferenceConfig = {
        ...(body.inferenceConfig as Record<string, unknown>),
        temperature: params.temperature,
      };
    }

    if (params.maxTokens != null && params.maxTokens > 0) {
      body.inferenceConfig = {
        ...(body.inferenceConfig as Record<string, unknown>),
        maxTokens: params.maxTokens,
      };
    }

    const bedrockTools = this._convertTools(params.tools);
    if (bedrockTools) {
      body.tools = bedrockTools;
    }

    return body;
  }

  async *stream(params: {
    model: string;
    messages: Message[];
    temperature?: number;
    maxTokens?: number;
    tools?: Tool[];
    extra?: Record<string, unknown>;
    signal?: AbortSignal;
  }): AsyncGenerator<StreamChunk> {
    const reasoningNormalizer = new ReasoningNormalizer();
    const modelId = this._modelId(params.model);
    const url = `${this._provider.baseUrl}/model/${modelId}/converse-stream`;
    const body = this._buildConverseBody({
      model: params.model,
      messages: params.messages,
      temperature: params.temperature,
      maxTokens: params.maxTokens,
      tools: params.tools,
      stream: true,
    });

    const bodyStr = JSON.stringify(body);
    const headers = this._signer.sign("POST", url, bodyStr, {
      "Content-Type": "application/json",
      "Accept": "application/json",
    });

    const res = await this._transport.request(url, {
      method: "POST",
      headers,
      body: bodyStr,
      signal: params.signal,
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => "");
      throw new ProviderRequestError(res.status, errorBody, this._provider.name);
    }

    if (!res.body) {
      throw new ProviderRequestError(500, "Response body is null", this._provider.name);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const lines = part.split("\n");
          let rawData = "";
          for (const line of lines) {
            if (line.startsWith("data: ")) rawData = line.slice(6).trim();
          }
          if (!rawData || rawData === "[DONE]") continue;

          let data: Record<string, unknown>;
          try { data = JSON.parse(rawData); } catch { continue; }

          // Bedrock Converse Stream events
          const eventType = data.$type as string;

          if (eventType === "contentBlockStart") {
            const contentBlock = data.contentBlockIndex as number;
            const start = data.start as Record<string, unknown> | undefined;
            if (start?.toolUse) {
              const toolUse = start.toolUse as Record<string, unknown>;
              yield {
                type: "tool_call",
                id: (toolUse.toolUseId as string) ?? `call_${contentBlock}`,
                name: (toolUse.name as string) ?? "",
                argumentsDelta: "",
                index: contentBlock,
                done: false,
              };
            }
          } else if (eventType === "contentBlockDelta") {
            const delta = data.delta as Record<string, unknown> | undefined;
            if (!delta) continue;

            if (delta.text) {
              const text = delta.text as string;
              const reasoning = reasoningNormalizer.feedText(text);
              if (reasoning) yield reasoning;
              else if (!ReasoningNormalizer.looksLikeReasoningTag(text)) {
                yield { type: "text", text };
              }
            } else if (delta.reasoningContent) {
              const rc = delta.reasoningContent as Record<string, unknown>;
              if (rc.text) yield { type: "reasoning", text: rc.text as string };
            } else if (delta.toolUse) {
              const toolUse = delta.toolUse as Record<string, unknown>;
              const contentBlock = data.contentBlockIndex as number;
              yield {
                type: "tool_call",
                id: `call_${contentBlock}`,
                name: "",
                argumentsDelta: JSON.stringify(toolUse.input ?? {}),
                index: contentBlock,
                done: false,
              };
            }
          } else if (eventType === "contentBlockStop") {
            const contentBlock = data.contentBlockIndex as number;
            yield {
              type: "tool_call",
              id: `call_${contentBlock}`,
              name: "",
              argumentsDelta: "",
              index: contentBlock,
              done: true,
            };
          } else if (eventType === "messageStop") {
            yield { type: "finish", reason: "end_turn" } as any;
          } else if (eventType === "metadata") {
            const usage = data.usage as Record<string, number> | undefined;
            if (usage) {
              yield {
                type: "usage",
                inputTokens: usage.inputTokens ?? 0,
                outputTokens: usage.outputTokens ?? 0,
                totalTokens: (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
              };
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async complete(params: {
    model: string;
    messages: Message[];
    temperature?: number;
    maxTokens?: number;
    tools?: Tool[];
    extra?: Record<string, unknown>;
    signal?: AbortSignal;
  }): Promise<string> {
    const modelId = this._modelId(params.model);
    const url = `${this._provider.baseUrl}/model/${modelId}/converse`;
    const body = this._buildConverseBody({
      model: params.model,
      messages: params.messages,
      temperature: params.temperature,
      maxTokens: params.maxTokens,
      tools: params.tools,
      stream: false,
    });

    const bodyStr = JSON.stringify(body);
    const headers = this._signer.sign("POST", url, bodyStr, {
      "Content-Type": "application/json",
      "Accept": "application/json",
    });

    const res = await this._transport.request(url, {
      method: "POST",
      headers,
      body: bodyStr,
      signal: params.signal,
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => "");
      throw new ProviderRequestError(res.status, errorBody, this._provider.name);
    }

    const data = await res.json() as Record<string, unknown>;
    const output = data.output as Record<string, unknown> | undefined;
    if (!output) return "";

    const content = output.content as Array<Record<string, unknown>> | undefined;
    if (!content?.length) return "";

    // Extract text from content blocks
    const textParts: string[] = [];
    for (const block of content) {
      if (block.text) textParts.push(block.text as string);
    }
    return textParts.join("");
  }

  async embed(params: EmbeddingParams): Promise<EmbeddingResult> {
    const modelId = this._modelId(params.model);
    const url = `${this._provider.baseUrl}/model/${modelId}/invoke`;

    const input = Array.isArray(params.input) ? params.input[0] : params.input;
    const body = JSON.stringify({
      inputText: input,
    });

    const headers = this._signer.sign("POST", url, body, {
      "Content-Type": "application/json",
      "Accept": "application/json",
    });

    const res = await this._transport.request(url, {
      method: "POST",
      headers,
      body,
      signal: params.signal,
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => "");
      throw new ProviderRequestError(res.status, errorBody, this._provider.name);
    }

    const data = await res.json() as Record<string, unknown>;
    const embedding = data.embedding as number[] | undefined;

    return {
      embeddings: embedding ? [embedding] : [],
      usage: {
        inputTokens: (data.inputTextTokenCount as number) ?? 0,
        totalTokens: (data.inputTextTokenCount as number) ?? 0,
      },
    };
  }
}
