import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import chalk from 'chalk';
import ora from 'ora';
import type { ScoredResult } from './types.js';

// GitHub raw (Fastly CDN): safe at 6 unauthenticated, 8 with token.
// Fontsource (jsDelivr): no published limit, much more permissive.
// 6 is the conservative floor that works for both without a token.
const CONCURRENCY_DEFAULT = 6;
const CONCURRENCY_WITH_TOKEN = 8;

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
  if (results.length <= 1) {
    for (const r of results) await downloadFont(r, outDir, token);
    return;
  }

  const concurrency = token ? CONCURRENCY_WITH_TOKEN : CONCURRENCY_DEFAULT;
  const total = results.length;
  let completed = 0;
  let failed = 0;

  // Individual spinners get interleaved and unreadable when concurrent.
  // Instead: single animated counter line + one persisted line per completion.
  const counter = ora({
    text: chalk.dim(`0 / ${total}`),
    prefixText: chalk.cyan('  ↓'),
  }).start();

  const finish = (filename: string, sizeStr: string, ok: boolean) => {
    completed++;
    if (!ok) failed++;
    counter.text = chalk.dim(`${completed} / ${total}`);
    // Print completed file above the spinner by temporarily stopping it
    counter.clear();
    if (ok) {
      process.stdout.write(
        `  ${chalk.cyan('↓')} ${chalk.white(filename.padEnd(45))} ${chalk.dim(sizeStr)}  ${chalk.green('done')}\n`,
      );
    } else {
      process.stdout.write(
        `  ${chalk.red('✕')} ${chalk.red(filename)}\n`,
      );
    }
    if (completed < total) counter.render();
  };

  const queue = [...results];

  const worker = async () => {
    while (queue.length > 0) {
      const r = queue.shift()!;
      try {
        const headers: Record<string, string> = { 'User-Agent': 'fontgrep' };
        if (token) headers['Authorization'] = `token ${token}`;

        const res = await fetch(r.rawUrl, { headers });
        if (!res.ok) {
          finish(r.filename, '', false);
          continue;
        }

        const buffer = Buffer.from(await res.arrayBuffer());
        const size = buffer.length;
        const sizeStr = size >= 1024 ? `${Math.round(size / 1024)}kb` : `${size}b`;

        await mkdir(outDir, { recursive: true });
        await writeFile(join(outDir, r.filename), buffer);

        finish(r.filename, sizeStr, true);
      } catch {
        finish(r.filename, '', false);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, total) }, worker),
  );

  counter.stop();

  const summary = failed > 0
    ? chalk.dim(`  ${completed - failed} downloaded`) + chalk.red(`  ${failed} failed`)
    : chalk.dim(`  ${completed} downloaded`);
  console.log(summary);
}
