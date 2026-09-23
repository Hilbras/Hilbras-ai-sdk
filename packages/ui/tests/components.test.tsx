import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";
import { ChatBox, useChatBox } from "../src/ChatBox.js";
import { MessageList } from "../src/MessageList.js";
import { Input } from "../src/Input.js";
import { CostBadge } from "../src/CostBadge.js";
import { ModelSelector } from "../src/ModelSelector.js";
import { ErrorBanner } from "../src/ErrorBanner.js";
import { ThinkingIndicator } from "../src/ThinkingIndicator.js";
import { ToolCallCard } from "../src/ToolCallCard.js";

afterEach(() => {
  cleanup();
});

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <ChatBox provider="openai" model="gpt-4o">
      {children}
    </ChatBox>
  );
}

describe("ChatBox", () => {
  it("provides context to children", () => {
    function TestChild() {
      const { messages, input, setInput } = useChatBox();
      return (
        <div>
          <span data-testid="msg-count">{messages.length}</span>
          <input data-testid="input" value={input} onChange={(e) => setInput(e.target.value)} />
        </div>
      );
    }

    render(
      <Wrapper>
        <TestChild />
      </Wrapper>
    );

    expect(screen.getByTestId("msg-count").textContent).toBe("0");
  });

  it("throws when used outside provider", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<MessageList />)).toThrow("useChatBox must be used within a <ChatBox>");
    consoleSpy.mockRestore();
  });
});

describe("MessageList", () => {
  it("renders empty state", () => {
    render(<Wrapper><MessageList /></Wrapper>);
    expect(screen.getByRole("log")).toBeTruthy();
  });

  it("renders messages", () => {
    function AddMessages() {
      const { sendMessage } = useChatBox();
      return <button onClick={() => sendMessage("hello")}>send</button>;
    }

    render(
      <Wrapper>
        <AddMessages />
        <MessageList />
      </Wrapper>
    );

    fireEvent.click(screen.getByText("send"));
    expect(screen.getByText("hello")).toBeTruthy();
  });
});

describe("Input", () => {
  it("renders textarea", () => {
    render(<Wrapper><Input /></Wrapper>);
    expect(screen.getByRole("textbox", { name: "Message input" })).toBeTruthy();
  });

  it("disables when loading", () => {
    render(<Wrapper><Input disabled /></Wrapper>);
    expect((screen.getByRole("textbox", { name: "Message input" }) as HTMLTextAreaElement).disabled).toBe(true);
  });
});

describe("CostBadge", () => {
  it("renders cost display", () => {
    render(<Wrapper><CostBadge /></Wrapper>);
    expect(screen.getByText(/\$0\.0000/)).toBeTruthy();
  });
});

describe("ModelSelector", () => {
  it("renders model options", () => {
    const models = [
      { id: "gpt-4o", name: "GPT-4o", provider: "OpenAI" },
      { id: "claude-3", name: "Claude 3", provider: "Anthropic" },
    ];
    render(
      <Wrapper>
        <ModelSelector models={models} value="gpt-4o" onChange={() => {}} />
      </Wrapper>
    );
    expect(screen.getByText(/GPT-4o/)).toBeTruthy();
    expect(screen.getByText(/Claude 3/)).toBeTruthy();
  });
});

describe("ErrorBanner", () => {
  it("renders nothing when no error", () => {
    const { container } = render(<Wrapper><ErrorBanner /></Wrapper>);
    expect(container.innerHTML).toBe("");
  });
});

describe("ThinkingIndicator", () => {
  it("renders nothing when not loading", () => {
    const { container } = render(<Wrapper><ThinkingIndicator /></Wrapper>);
    expect(container.innerHTML).toBe("");
  });
});

describe("ToolCallCard", () => {
  it("renders tool call name", () => {
    const toolCall = { id: "1", name: "search", arguments: { query: "hello" } };
    render(
      <Wrapper>
        <ToolCallCard toolCall={toolCall} />
      </Wrapper>
    );
    expect(screen.getByRole("button", { name: /Tool: search/ })).toBeTruthy();
  });

  it("expands on click", () => {
    const toolCall = { id: "1", name: "search", arguments: { query: "hello" } };
    render(
      <Wrapper>
        <ToolCallCard toolCall={toolCall} />
      </Wrapper>
    );
    fireEvent.click(screen.getByRole("button", { name: /Tool: search/ }));
    expect(screen.getByText(/Arguments:/)).toBeTruthy();
  });
});
