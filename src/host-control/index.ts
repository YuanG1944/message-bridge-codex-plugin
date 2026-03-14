import os from 'node:os';
import type { HostControlConfig, HostControlProvider } from '../types.js';
import { LinuxHostControlProvider } from './linux.provider.js';
import { MacOsHostControlProvider } from './macos.provider.js';

export function createHostControlProvider(config: HostControlConfig): HostControlProvider {
  const provider = config.provider === 'auto' ? os.platform() : config.provider;
  if (provider === 'darwin' || provider === 'macos') return new MacOsHostControlProvider();
  return new LinuxHostControlProvider();
}
