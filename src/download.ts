import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import chalk from 'chalk';
import ora from 'ora';
import type { ScoredResult } from './types.js';

export async function downloadFont(
  result: ScoredResult,
  outDir: string,
  token: string,
): Promise<void> {
  const spinner = ora({
    text: chalk.dim(`${result.filename}`),
    prefixText: chalk.cyan('  ↓'),
  }).start();

  try {
    const headers: Record<string, string> = { 'User-Agent': 'fontgrep' };
    if (token) headers['Authorization'] = `token ${token}`;

    const res = await fetch(result.rawUrl, { headers });

    if (!res.ok) {
      spinner.fail(chalk.red(`${result.filename}  failed (${res.status})`));
      return;
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    const size = buffer.length;
    const sizeStr = size >= 1024 ? `${Math.round(size / 1024)}kb` : `${size}b`;

    await mkdir(outDir, { recursive: true });
    const dest = join(outDir, result.filename);
    await writeFile(dest, buffer);

    spinner.stopAndPersist({
      symbol: chalk.cyan('  ↓'),
      text: `${chalk.white(result.filename)}    ${chalk.dim(sizeStr)}  ${chalk.green('done')}`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    spinner.fail(chalk.red(`${result.filename}  ${msg}`));
  }
}

export async function downloadAll(
  results: ScoredResult[],
  outDir: string,
  token: string,
): Promise<void> {
  for (const r of results) {
    await downloadFont(r, outDir, token);
  }
}
