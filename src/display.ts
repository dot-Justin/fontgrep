import chalk from 'chalk';
import Table from 'cli-table3';
import type { ScoredResult, FamilyVariant } from './types.js';

function formatStars(stars: number): string {
  if (stars >= 1000) return `${(stars / 1000).toFixed(1)}k`;
  return String(stars);
}

export function showResultsTable(results: ScoredResult[]): void {
  const table = new Table({
    head: [
      chalk.dim('#'),
      chalk.dim('file'),
      chalk.dim('repo'),
      chalk.dim('★'),
      chalk.dim('ext'),
    ],
    chars: {
      top: '─', 'top-mid': '─', 'top-left': '─', 'top-right': '─',
      bottom: '─', 'bottom-mid': '─', 'bottom-left': '─', 'bottom-right': '─',
      left: ' ', 'left-mid': ' ', mid: '─', 'mid-mid': '─',
      right: ' ', 'right-mid': ' ', middle: '  ',
    },
    style: { head: [], border: ['dim'], 'padding-left': 1, 'padding-right': 1 },
  });

  for (const r of results) {
    table.push([
      chalk.bold(String(r.rank)),
      chalk.white(r.filename),
      chalk.dim(r.repo),
      chalk.yellow(formatStars(r.stars)),
      chalk.cyan(r.ext),
    ]);
  }

  console.log(table.toString());
}

function formatWeight(weight: string, style: string): string {
  const label = style ? `${weight} ${style}` : weight;
  return label;
}

export function showFamilyGroups(
  families: Map<string, FamilyVariant[]>,
  primaryFamily: string,
): void {
  const primary = families.get(primaryFamily);
  const others = [...families.entries()].filter(([k]) => k !== primaryFamily);

  if (primary && primary.length > 0) {
    const bestRepo = primary.reduce((best, v) => v.stars > best.stars ? v : best, primary[0]);
    console.log(
      `  ${chalk.bold(primary[0].familyBase)}` +
      chalk.dim(`  ·  ${primary.length} weights  ·  best source: ${bestRepo.repo} (${formatStars(bestRepo.stars)}★)`),
    );
    console.log();

    for (let i = 0; i < primary.length; i++) {
      const v = primary[i];
      const num = chalk.dim(`${String(i + 1).padStart(3)}.`);
      const wt = formatWeight(v.weight, v.style).padEnd(20);
      const file = chalk.white(v.filename.padEnd(45));
      const ext = chalk.cyan(v.ext);
      console.log(`  ${num} ${wt} ${file} ${ext}`);
    }
  }

  // Only show related families with 3+ weights (filters out noise)
  const realOthers = others.filter(([, v]) => v.length >= 5);
  if (realOthers.length > 0) {
    console.log();
    console.log(chalk.dim(`  also found ${realOthers.length} related families:`));
    for (const [name, variants] of realOthers) {
      console.log(chalk.dim(`    ${name} (${variants.length} weights)`));
    }
  }

  console.log();
}

export function showRawUrls(results: ScoredResult[]): void {
  for (const r of results) {
    console.log(r.rawUrl);
  }
}
