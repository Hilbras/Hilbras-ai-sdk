/**
 * @hilbras/sdk — Tool policy
 *
 * `SDKConfig.allowedTools` and `SDKConfig.deniedTools` have always been part of
 * the configuration schema, but nothing consulted them: they were validated for
 * overlap and then ignored. This module makes them enforceable at the point
 * where a tool actually runs.
 *
 * Semantics match the rest of the configuration system: an absent or empty
 * allow-list means every tool is permitted, and a deny-list always wins over an
 * allow-list. A tool policy is a pure value with no I/O, so it can be shared
 * between a client, an agent loop, and a framework handler.
 */

/** Plain shape accepted wherever a {@link ToolPolicy} is configured. */
export interface ToolPolicyInput {
  /** Permitted tool names. Empty or absent means all tools are permitted. */
  allowedTools?: readonly string[];
  /** Tool names that are never permitted. Takes precedence over the allow-list. */
  deniedTools?: readonly string[];
}

/** Result of checking one tool name against a policy. */
export interface ToolPolicyCheck {
  allowed: boolean;
  reason?: string;
}

export class ToolPolicy {
  private readonly _allowed: readonly string[] | undefined;
  private readonly _denied: readonly string[];

  /**
   * @param input The allow-list and deny-list.
   * @param options `emptyAllowListIsRestrictive` keeps an empty allow-list
   *   meaningful as "nothing is permitted". It is off by default because an
   *   empty `allowedTools` in configuration means "no restriction", and
   *   {@link narrow} needs the opposite meaning: the intersection of two
   *   allow-lists can legitimately be empty, and treating that as unrestricted
   *   would make narrowing wider instead of narrower.
   */
  constructor(
    input: ToolPolicyInput = {},
    options: { emptyAllowListIsRestrictive?: boolean } = {},
  ) {
    const allowed = input.allowedTools;
    this._allowed = allowed === undefined
      ? undefined
      : allowed.length > 0 || options.emptyAllowListIsRestrictive
        ? Object.freeze([...allowed])
        : undefined;
    this._denied = Object.freeze([...(input.deniedTools ?? [])]);
  }

  /** True when the policy constrains nothing. */
  isEmpty(): boolean {
    return this._allowed === undefined && this._denied.length === 0;
  }

  get allowedTools(): readonly string[] | undefined {
    return this._allowed;
  }

  get deniedTools(): readonly string[] {
    return this._denied;
  }

  /** Check a single tool name. */
  check(toolName: string): ToolPolicyCheck {
    if (this._denied.includes(toolName)) {
      return { allowed: false, reason: `Tool "${toolName}" is denied by policy` };
    }
    if (this._allowed !== undefined && !this._allowed.includes(toolName)) {
      return {
        allowed: false,
        reason: `Tool "${toolName}" is not in the allowed tool list (${this._allowed.join(", ")})`,
      };
    }
    return { allowed: true };
  }

  isAllowed(toolName: string): boolean {
    return this.check(toolName).allowed;
  }

  /**
   * Return the intersection of this policy with a narrower one. A tool must be
   * permitted by both policies to be permitted by the result, so a per-user
   * allow-list can only narrow a client-level policy, never widen it.
   */
  narrow(other: ToolPolicyInput | ToolPolicy | undefined): ToolPolicy {
    if (other === undefined) return this;
    const narrower = other instanceof ToolPolicy ? other : new ToolPolicy(other);
    let allowed: readonly string[] | undefined;
    if (this._allowed === undefined) {
      allowed = narrower.allowedTools;
    } else if (narrower.allowedTools === undefined) {
      allowed = this._allowed;
    } else {
      allowed = this._allowed.filter((name) => narrower.allowedTools!.includes(name));
    }
    return new ToolPolicy(
      { allowedTools: allowed, deniedTools: [...this._denied, ...narrower.deniedTools] },
      { emptyAllowListIsRestrictive: true },
    );
  }

  /**
   * Validate a whole tool set at once. Returns the first violation, or `null`
   * when every tool is permitted.
   */
  checkAll(toolNames: readonly string[]): ToolPolicyCheck | null {
    for (const name of toolNames) {
      const result = this.check(name);
      if (!result.allowed) return result;
    }
    return null;
  }

  /** Throw when a tool is not permitted. */
  assertAllowed(toolName: string): void {
    const result = this.check(toolName);
    if (!result.allowed) {
      throw new Error(result.reason ?? `Tool "${toolName}" is not permitted`);
    }
  }

  toJSON(): ToolPolicyInput {
    return {
      allowedTools: this._allowed ? [...this._allowed] : undefined,
      deniedTools: this._denied.length > 0 ? [...this._denied] : undefined,
    };
  }
}

/** Create a tool policy from a plain input. */
export function createToolPolicy(input: ToolPolicyInput = {}): ToolPolicy {
  return new ToolPolicy(input);
}
