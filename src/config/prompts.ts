/**
 * @hilbras/sdk — System Prompt Builder
 *
 * Build system prompts with variable substitution, conditional sections,
 * and tool documentation. Supports:
 * - Variable interpolation: ${varName}
 * - Conditional sections: {{#if condition}} ... {{/if}}
 * - Tool documentation injection
 * - Environment disclosure
 */

export interface PromptVariable {
  name: string;
  value: string;
}

export interface PromptSection {
  heading?: string;
  content: string;
  condition?: boolean;
}

/**
 * Build a system prompt from sections and variables.
 */
export function buildPrompt(
  sections: PromptSection[],
  variables?: PromptVariable[],
): string {
  const varMap = new Map(variables?.map((v) => [v.name, v.value]) ?? []);
  const parts: string[] = [];

  for (const section of sections) {
    if (section.condition === false) continue;
    let content = interpolate(section.content, varMap);
    if (section.heading) {
      parts.push(`# ${section.heading}\n\n${content}`);
    } else {
      parts.push(content);
    }
  }

  return parts.join("\n\n");
}

/** Interpolate ${varName} placeholders */
function interpolate(text: string, vars: Map<string, string>): string {
  return text.replace(/\$\{(\w+)\}/g, (_, name) => vars.get(name) ?? "");
}

/**
 * Build a tools section for the system prompt.
 */
export function buildToolSection(
  tools: Array<{ name: string; description: string; parameters?: Record<string, unknown> }>,
): string {
  if (tools.length === 0) return "";

  const lines = tools.map((t) => {
    let desc = `- **${t.name}**: ${t.description}`;
    if (t.parameters) {
      const params = Object.keys(t.parameters).join(", ");
      if (params) desc += ` (params: ${params})`;
    }
    return desc;
  });

  return `# Available Tools\n\n${lines.join("\n")}`;
}

/**
 * Build an environment disclosure section.
 */
export function buildEnvironmentSection(opts: {
  os?: string;
  shell?: string;
  cwd?: string;
  date?: string;
  timezone?: string;
}): string {
  const parts: string[] = ["# Working Environment"];
  if (opts.os) parts.push(`- OS: ${opts.os}`);
  if (opts.shell) parts.push(`- Shell: ${opts.shell}`);
  if (opts.cwd) parts.push(`- Working directory: ${opts.cwd}`);
  if (opts.date) parts.push(`- Date: ${opts.date}`);
  if (opts.timezone) parts.push(`- Timezone: ${opts.timezone}`);
  return parts.join("\n");
}

/**
 * Build a complete system prompt for a coding agent.
 */
export function buildCodingAgentPrompt(opts: {
  productName?: string;
  cwd?: string;
  tools?: Array<{ name: string; description: string }>;
  language?: string;
  additionalInstructions?: string;
}): string {
  const sections: PromptSection[] = [
    {
      heading: undefined,
      content: `You are ${opts.productName ?? "Hilbras AI"}, an interactive coding agent running on a user's computer.`,
    },
    {
      heading: "Language",
      content: `Write in the user's language unless they explicitly ask for a different one.`,
    },
    {
      heading: "Tool Use",
      content: `Use the tools available to you to make real changes on the user's system. For anything beyond a simple question, default to taking action with tools. Prefer dedicated tools (\`list\`, \`read\`, \`search\`) over raw shell commands for file operations.`,
    },
    opts.tools?.length ? {
      heading: "Available Tools",
      content: buildToolSection(opts.tools),
    } : undefined,
    {
      heading: "Working Directory",
      content: `The current working directory is \`${opts.cwd ?? process.cwd()}\`. Use this as the project root. The directory listing below shows the actual structure.`,
    },
    {
      heading: "Guidelines",
      content: `- Understand the codebase by reading it with tools before making changes.
- Make minimal changes to achieve the goal.
- Match the surrounding code's style and conventions.
- Before calling a task done, verify it: run the checks that cover your change.
- Never treat displaying code in your response as a substitute for writing it to disk.
- Deliver complete changes — never use placeholders like "// ... rest unchanged".`,
    },
    opts.additionalInstructions ? {
      heading: "Additional Instructions",
      content: opts.additionalInstructions,
    } : undefined,
  ].filter(Boolean) as PromptSection[];

  return buildPrompt(sections);
}
