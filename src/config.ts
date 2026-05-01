import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { FontgrepConfig } from './types.js';
import { promptSetup } from './prompt.js';

const CONFIG_DIR = join(homedir(), '.config', 'fontgrep');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

export async function getConfig(): Promise<FontgrepConfig | null> {
  try {
    const raw = await readFile(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    // Handle old config format (just { token: string })
    if (parsed.configured === undefined) {
      return { token: parsed.token || null, configured: true };
    }
    return parsed as FontgrepConfig;
  } catch {
    return null;
  }
}

export async function saveConfig(config: FontgrepConfig): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
}

export async function ensureConfigured(): Promise<FontgrepConfig> {
  const existing = await getConfig();
  if (existing?.configured) return existing;

  // First run
  const token = await promptSetup();
  const config: FontgrepConfig = { token, configured: true };
  await saveConfig(config);
  console.log();
  return config;
}
