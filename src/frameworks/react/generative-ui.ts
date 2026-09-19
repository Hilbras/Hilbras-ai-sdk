/**
 * @hilbras/react — Generative UI
 *
 * Allows tool calls to render custom React components inline.
 * Components are rendered server-side and serialized for client consumption.
 *
 * @example
 * ```tsx
 * import { streamUI } from "@hilbras/sdk/react";
 * import { WeatherCard } from "./components";
 *
 * const result = await streamUI({
 *   model: "gpt-4o",
 *   messages: [{ role: "user", content: "What's the weather in Tokyo?" }],
 *   tools: {
 *     get_weather: {
 *       render: async (args) => {
 *         const weather = await fetchWeather(args.city);
 *         return <WeatherCard city={args.city} temp={weather.temp} />;
 *       },
 *     },
 *   },
 * });
 * ```
 */

import type { ReactNode } from "react";

/** A serializable component reference */
export interface ComponentRef {
  /** Component name (must be registered in the registry) */
  name: string;
  /** Props to pass to the component */
  props: Record<string, unknown>;
}

/** A rendered component result */
export interface RenderedComponent {
  type: "component";
  /** The component reference (serializable) */
  ref: ComponentRef;
  /** The actual React element (client-side only, not serialized) */
  element?: ReactNode;
}

/** A tool definition with optional render function for generative UI */
export interface GenerativeTool<TArgs = Record<string, unknown>> {
  /** Description of the tool for the LLM */
  description?: string;
  /** JSON Schema for the tool's parameters */
  parameters?: Record<string, unknown>;
  /** Execute the tool and return data */
  execute?: (args: TArgs) => Promise<unknown> | unknown;
  /** Render a React component for the tool result */
  render?: (args: TArgs) => Promise<ReactNode> | ReactNode;
}

/** Options for the streamUI function */
export interface StreamUIOptions {
  /** Provider to use */
  provider?: string;
  /** Model to use */
  model?: string;
  /** Messages for the conversation */
  messages: Array<{ role: string; content: string }>;
  /** Tools with optional render functions */
  tools: Record<string, GenerativeTool>;
  /** Component registry for deserializing components on the client */
  componentRegistry?: Record<string, React.ComponentType<Record<string, unknown>>>;
}

/** Result of a streamUI call */
export interface StreamUIResult {
  /** The rendered content (mix of text and components) */
  content: ReactNode[];
  /** Tool invocations with their rendered components */
  toolInvocations: Array<{
    id: string;
    name: string;
    args: Record<string, unknown>;
    result?: unknown;
    rendered?: ReactNode;
  }>;
}

/**
 * Registry for mapping component names to React components.
 * Used for deserializing ComponentRefs on the client side.
 */
export class ComponentRegistry {
  private _components = new Map<string, React.ComponentType<Record<string, unknown>>>();

  /** Register a component */
  register(name: string, component: React.ComponentType<Record<string, unknown>>): void {
    this._components.set(name, component);
  }

  /** Register multiple components */
  registerAll(components: Record<string, React.ComponentType<Record<string, unknown>>>): void {
    for (const [name, component] of Object.entries(components)) {
      this._components.set(name, component);
    }
  }

  /** Get a registered component */
  get(name: string): React.ComponentType<Record<string, unknown>> | undefined {
    return this._components.get(name);
  }

  /** Check if a component is registered */
  has(name: string): boolean {
    return this._components.has(name);
  }

  /** Get all registered component names */
  names(): string[] {
    return Array.from(this._components.keys());
  }
}

/**
 * Deserialize a ComponentRef into a React element.
 * Requires a ComponentRegistry with the referenced component registered.
 *
 * @param ref - The serializable component reference
 * @param registry - The component registry
 * @returns The React element, or a fallback element if not found
 */
export function deserializeComponent(
  ref: ComponentRef,
  registry: ComponentRegistry,
): ReactNode {
  const Component = registry.get(ref.name);
  if (!Component) {
    // Return a fallback element
    return `Unknown component: ${ref.name}`;
  }
  return createElement(Component, ref.props);
}

/**
 * Serialize a React element into a ComponentRef.
 * Useful for server-side rendering tool results.
 *
 * @param element - The React element to serialize
 * @param registry - The component registry
 * @returns The serializable component reference, or null if not serializable
 */
export function serializeComponent(
  element: ReactNode,
  registry: ComponentRegistry,
): ComponentRef | null {
  // Check if element is a React element with type and props
  if (
    element &&
    typeof element === "object" &&
    "type" in element &&
    "props" in element
  ) {
    const el = element as { type: unknown; props: Record<string, unknown> };
    if (typeof el.type === "string" && registry.has(el.type)) {
      return {
        name: el.type,
        props: el.props,
      };
    }
  }
  return null;
}

/** React.createElement import (lazy) */
let createElement: typeof import("react").createElement;

/**
 * Initialize the generative UI module.
 * Must be called before using serializeComponent/deserializeComponent.
 */
export function initGenerativeUI(): void {
  try {
    // Dynamic import to avoid hard dependency on React
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const react = require("react");
    createElement = react.createElement;
  } catch {
    throw new Error(
      "Generative UI requires React to be installed. " +
      "Install it with: npm install react"
    );
  }
}

// Auto-initialize on import
try {
  initGenerativeUI();
} catch {
  // React may not be available — that's OK, the error will surface when trying to use generative UI
}
