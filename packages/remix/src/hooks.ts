/**
 * @hilbras/remix — Client Hooks
 *
 * React hooks for Remix client-side use.
 */

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  id?: string;
}

export interface UseChatOptions {
  api?: string;
  onFinish?: (message: Message) => void;
  onError?: (error: Error) => void;
  initialMessages?: Message[];
}

export interface UseChatReturn {
  messages: Message[];
  isLoading: boolean;
  error: Error | null;
  input: string;
  handleInputChange: (e: { target: { value: string } }) => void;
  handleSubmit: (e: { preventDefault: () => void }) => Promise<void>;
  setMessages: (msgs: Message[]) => void;
  append: (message: Message) => Promise<void>;
  reload: () => Promise<void>;
  stop: () => void;
  clear: () => void;
}

/**
 * Chat hook for Remix (stateful, client-side).
 */
export function createChatHook(options: UseChatOptions = {}) {
  const { api = "/api/chat", onFinish, onError, initialMessages = [] } = options;

  return function useChat(): UseChatReturn {
    let _messages: Message[] = [...initialMessages];
    let _isLoading = false;
    let _error: Error | null = null;
    let _input = "";
    let abortController: AbortController | null = null;

    async function sendRequest(msgs: Message[]) {
      _isLoading = true;
      _error = null;
      abortController = new AbortController();

      try {
        const response = await fetch(api, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: msgs }),
          signal: abortController.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let text = "";
        const assistantMsg: Message = { role: "assistant", content: "", id: crypto.randomUUID() };

        _messages = [...msgs, assistantMsg];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          text += decoder.decode(value, { stream: true });
          _messages = _messages.map((m, i) =>
            i === _messages.length - 1 ? { ...m, content: text } : m
          );
        }

        onFinish?.({ ...assistantMsg, content: text });
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          _error = err as Error;
          onError?.(_error);
        }
      } finally {
        _isLoading = false;
      }
    }

    return {
      get messages() { return _messages; },
      get isLoading() { return _isLoading; },
      get error() { return _error; },
      get input() { return _input; },
      setMessages: (msgs: Message[]) => { _messages = msgs; },
      handleInputChange: (e: { target: { value: string } }) => { _input = e.target.value; },
      handleSubmit: async (e: { preventDefault: () => void }) => {
        e.preventDefault();
        if (!_input.trim()) return;
        const userMsg: Message = { role: "user", content: _input };
        _input = "";
        const newMessages = [..._messages, userMsg];
        _messages = newMessages;
        await sendRequest(newMessages);
      },
      append: async (message: Message) => {
        const newMessages = [..._messages, message];
        _messages = newMessages;
        await sendRequest(newMessages);
      },
      reload: async () => {
        if (_messages.length === 0) return;
        const userMsgs = _messages.slice(0, -1);
        _messages = userMsgs;
        await sendRequest(userMsgs);
      },
      stop: () => {
        abortController?.abort();
        _isLoading = false;
      },
      clear: () => {
        _messages = [];
        _error = null;
      },
    };
  };
}
