/**
 * create-hilbras-app — Validation utilities
 *
 * Input validation for project scaffolding CLI.
 */

export function validateTemplateName(template: string): void {
  if (
    template.includes("/") ||
    template.includes("\\") ||
    template === ".." ||
    template.startsWith("../") ||
    template.startsWith("..\\")
  ) {
    throw new Error(`Invalid template name "${template}". Template names must be simple names without path separators.`);
  }
}

export function validateProjectName(name: string): void {
  if (
    name.includes("/") ||
    name.includes("\\") ||
    name === ".." ||
    name.startsWith("../") ||
    name.startsWith("..\\")
  ) {
    throw new Error(`Invalid project name "${name}". Project names must be simple names without path separators.`);
  }
}
