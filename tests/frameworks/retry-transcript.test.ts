/**
 * @hilbras/sdk — Retry must not duplicate the user turn (E5)
 *
 * `retry()` removes the trailing assistant message and then called
 * `sendMessage(lastUser)`, which appends the user message again — so the
 * provider received the question twice and the transcript showed it twice.
 *
 * The payload builder is a pure function precisely so this is testable without
 * a React renderer (the repo has no testing-library or jsdom).
 */

import { describe, expect, it } from "vitest";
import { buildChatApiMessages } from "../../src/frameworks/react-client/use-chat.js";

const user = (content: string, id = "u1") => ({ id, role: "user" as const, content, timestamp: 0 });
const assistant = (content: string, id = "a1") => ({ id, role: "assistant" as const, content, timestamp: 0 });

const QUESTION = "What is 2+2?";

describe("retry transcript", () => {
  it("sends the user turn exactly once when retrying", () => {
    // `retry` drops the failed assistant turn; the user turn stays put.
    const api = buildChatApiMessages({
      transcript: [user(QUESTION)],
      userContent: QUESTION,
      maxContextMessages: 20,
      appendUserMessage: false,
    });

    expect(api.filter((message) => message.content === QUESTION)).toHaveLength(1);
  });

  it("duplicated it under the old append-always behaviour", () => {
    const api = buildChatApiMessages({
      transcript: [user(QUESTION)],
      userContent: QUESTION,
      maxContextMessages: 20,
      appendUserMessage: true,
    });

    expect(api.filter((message) => message.content === QUESTION)).toHaveLength(2);
  });

  it("still appends the user turn for a normal send", () => {
    const api = buildChatApiMessages({
      transcript: [user("earlier"), assistant("reply")],
      userContent: QUESTION,
      systemPrompt: "be brief",
      maxContextMessages: 20,
      appendUserMessage: true,
    });

    expect(api[0]).toEqual({ role: "system", content: "be brief" });
    expect(api[api.length - 1]).toEqual({ role: "user", content: QUESTION });
    expect(api).toHaveLength(4);
  });
});
