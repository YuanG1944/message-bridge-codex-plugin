import {
  DEFAULT_DANGER_HOST_TOOLS,
  DEFAULT_SAFE_HOST_TOOLS,
} from '../constants/index.js';
import type { HostControlPolicyConfig } from '../types.js';

export class HostControlPolicy {
  private readonly allowedTools: Set<string>;
  private readonly dangerTools: Set<string>;
  private readonly enableDangerTools: boolean;

  constructor(config: HostControlPolicyConfig = {}) {
    this.allowedTools = new Set(
      config.allowed_tools?.length ? config.allowed_tools : [...DEFAULT_SAFE_HOST_TOOLS],
    );
    this.dangerTools = new Set(
      config.danger_tools?.length ? config.danger_tools : [...DEFAULT_DANGER_HOST_TOOLS],
    );
    this.enableDangerTools = Boolean(config.enableDangerTools);
  }

  isToolEnabled(name: string): boolean {
    if (this.dangerTools.has(name) && !this.enableDangerTools) return false;
    return this.allowedTools.has(name) || (this.enableDangerTools && this.dangerTools.has(name));
  }

  visibleTools(): string[] {
    const tools = new Set(this.allowedTools);
    if (this.enableDangerTools) {
      for (const tool of this.dangerTools) tools.add(tool);
    }
    return Array.from(tools).sort();
  }

  assertAllowed(name: string): void {
    if (!this.isToolEnabled(name)) {
      throw new Error(`Tool ${name} is disabled by host-control policy.`);
    }
  }
}
