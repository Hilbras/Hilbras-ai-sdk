export interface Provider {
  /** The letter shown in the little tile. */
  readonly initial: string;
  readonly name: string;
}

/**
 * The providers in the scrolling strip. Held as data rather than markup because
 * the strip renders the list twice — the second pass is what makes the loop
 * seamless — and hand-duplicating thirty-six spans is how the two copies drift
 * apart.
 */
export const providers: readonly Provider[] = [
  { initial: 'O', name: 'OpenAI' },
  { initial: 'A', name: 'Anthropic' },
  { initial: 'G', name: 'Google AI' },
  { initial: 'V', name: 'Vertex AI' },
  { initial: 'B', name: 'Bedrock' },
  { initial: 'Z', name: 'Azure' },
  { initial: 'M', name: 'Mistral' },
  { initial: 'D', name: 'DeepSeek' },
  { initial: 'X', name: 'xAI' },
  { initial: 'G', name: 'Groq' },
  { initial: 'O', name: 'Ollama' },
  { initial: 'C', name: 'Cohere' },
  { initial: 'T', name: 'Together' },
  { initial: 'F', name: 'Fireworks' },
  { initial: 'P', name: 'Perplexity' },
  { initial: 'C', name: 'Cerebras' },
  { initial: 'D', name: 'DeepInfra' },
  { initial: 'H', name: 'Hugging Face' },
] as const;
