#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { ensureConfigured, saveConfig, getConfig } from './config.js';
import { searchFonts } from './github.js';
import { searchSourcegraph } from './sourcegraph.js';
import { searchFontsource } from './fontsource.js';
import { rankResults } from './rank.js';
import { showResultsTable, showFamilyGroups, showRawUrls } from './display.js';
import { downloadFont, downloadAll } from './download.js';
import { promptAction, promptToken } from './prompt.js';
import { groupByFamily } from './family.js';
import { startBanner } from './banner.js';
import { startPreview } from './preview.js';
import { join } from 'node:path';
import type { SearchResult } from './types.js';

const program = new Command();

program
  .name('fontgrep')
  .description('Search GitHub for font files by name')
  .version('0.1.0')
  .argument('<query>', 'font name to search for')
  .option('-e, --ext <extensions...>', 'file extensions to search', ['ttf', 'otf', 'woff2'])
  .option('-f, --first', 'download the top result immediately')
  .option('--list', 'show flat list instead of grouped family view')
  .option('--raw', 'output raw download URLs only')
  .option('-o, --out <dir>', 'output directory for downloads', '.')
  .option('--setup', 'reconfigure GitHub token')
  .action(async (query: string, options) => {
    try {
      await run(query, options);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`\n  error: ${msg}`));
      process.exit(1);
    }
  });

const setupCmd = new Command('setup')
  .description('Configure GitHub token')
  .action(async () => {
    const token = await promptToken();
    await saveConfig({ token, configured: true });
  });

program.addCommand(setupCmd);

function mergeResults(primary: SearchResult[], secondary: SearchResult[]): SearchResult[] {
  const seen = new Set(primary.map((r) => `${r.repo}:${r.path}`));
  const merged = [...primary];
  for (const r of secondary) {
    const key = `${r.repo}:${r.path}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(r);
    }
  }
  return merged;
}

async function run(query: string, options: {
  ext: string[];
  first?: boolean;
  list?: boolean;
  raw?: boolean;
  out: string;
  setup?: boolean;
}): Promise<void> {
  if (options.setup) {
    const token = await promptToken();
    await saveConfig({ token, configured: true });
    console.log();
  }

  const config = await ensureConfigured();

  const stopBanner = startBanner(query);
  const [sg, fs] = await Promise.all([
    searchSourcegraph(query, options.ext, () => {}),
    searchFontsource(query),
  ]);
  stopBanner();

  // Secondary: GitHub API (only if token configured)
  let gh = { results: [] as SearchResult[], totalCount: 0, repoCount: 0 };
  if (config.token) {
    try {
      gh = await searchFonts(query, options.ext, config.token, () => {});
    } catch {
      // fine, we have Sourcegraph results
    }
  }

  const merged = mergeResults(fs, mergeResults(sg.results, gh.results));
  const scored = rankResults(merged, query);

  if (scored.length === 0) {
    console.log(chalk.red(`  no fonts found for "${query}"`));
    return;
  }

  const githubCount = scored.filter((r) => r.source !== 'fontsource').length;
  const repos = new Set(scored.filter((r) => r.source !== 'fontsource').map((r) => r.repo));
  const fontsourceNote = fs.length > 0 ? chalk.cyan('  ✦ fontsource') : '';
  console.log(
    `  ${chalk.bold(String(githubCount))} github results across ${repos.size} repos` +
    (githubCount < merged.length - fs.length ? chalk.dim(` (${merged.length - fs.length} before dedup)`) : '') +
    fontsourceNote,
  );
  console.log();

  const token = config.token ?? '';

  // --raw: output URLs
  if (options.raw) {
    showRawUrls(scored);
    return;
  }

  // --first: grab top hit
  if (options.first) {
    await downloadFont(scored[0], options.out, token);
    console.log();
    console.log(chalk.dim(`  saved to ${join(options.out, scored[0].filename)}`));
    return;
  }

  // --list: flat table (old behavior)
  if (options.list) {
    showResultsTable(scored);
    console.log();

    const action = await promptAction(scored.length);
    if (action === 'quit') return;

    console.log();
    if (action === 'all') {
      await downloadAll(scored, options.out, token);
    } else if (Array.isArray(action)) {
      const selected = action.map((n) => scored[n - 1]);
      await downloadAll(selected, options.out, token);
      console.log();
      console.log(chalk.dim(`  saved to ${options.out}/`));
    }
    return;
  }

  // Default: family-grouped view
  const { families, primaryFamily } = groupByFamily(scored, query);

  if (families.size === 0) {
    showResultsTable(scored);
    return;
  }

  const outDir = join(options.out, query.replace(/\s+/g, '-'));
  let activeFamilies = families;
  let currentFamily = primaryFamily;

  while (true) {
    const current = activeFamilies.get(currentFamily)!;
    const isFontsourcePrimary = current.some((v) => v.source === 'fontsource');
    const relatedFamilies = showFamilyGroups(activeFamilies, currentFamily);
    const action = await promptAction(current.length, relatedFamilies, isFontsourcePrimary && fs.length > 0);

    if (action === 'quit') break;

    if (action === 'preview') {
      const isFontsource = current.some((v) => v.source === 'fontsource');
      const bestRepo = current.reduce((b, v) => v.stars > b.stars ? v : b, current[0]);
      const starsStr = bestRepo.stars >= 1000
        ? `${(bestRepo.stars / 1000).toFixed(1)}k`
        : String(bestRepo.stars);
      const sourceLabel = isFontsource
        ? 'fontsource'
        : `${bestRepo.repo} (${starsStr}★)`;
      const displayLabel = `${current.length} weight${current.length !== 1 ? 's' : ''} · ${sourceLabel}`;
      console.log();
      await startPreview(current, token, currentFamily, displayLabel);
      console.log();
      continue;
    }

    if (action === 'github') {
      const ghScored = scored.filter((r) => r.source !== 'fontsource');
      const { families: ghFamilies, primaryFamily: ghPrimary } = groupByFamily(ghScored, query);
      activeFamilies = ghFamilies;
      currentFamily = ghPrimary;
      console.log();
      continue;
    }

    if (typeof action === 'object' && 'switchToFamily' in action) {
      currentFamily = action.switchToFamily;
      console.log();
      continue;
    }

    console.log();
    if (action === 'all') {
      await downloadAll(current, outDir, token);
    } else if (Array.isArray(action)) {
      const selected = action.map((n) => current[n - 1]);
      await downloadAll(selected, outDir, token);
    }
    console.log();
    console.log(chalk.dim(`  saved to ${outDir}/`));
    break;
  }
}

program.parse();
