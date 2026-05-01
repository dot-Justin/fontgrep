import { input, password, confirm } from '@inquirer/prompts';
import chalk from 'chalk';
import type { PromptResult } from './types.js';

export async function promptSetup(): Promise<string | null> {
  console.log();
  console.log(chalk.bold('  welcome to fontgrep'));
  console.log();
  console.log(`  ${chalk.white('fontgrep')} searches public github repos for font files.`);
  console.log(`  it works out of the box — no account needed.`);
  console.log();
  console.log(chalk.dim('  optionally, you can add a github token for extra results.'));
  console.log(chalk.dim('  github search finds some files sourcegraph misses, but'));
  console.log(chalk.dim('  it has strict rate limits (~30 req/min) and slows things down.'));
  console.log();

  const wantsToken = await confirm({
    message: 'add a github token for additional results?',
    default: false,
  });

  if (!wantsToken) {
    console.log();
    console.log(chalk.green('  ✓ ready to go. you can add a token later with: fontgrep setup'));
    return null;
  }

  console.log();
  console.log(chalk.dim('  create one at github.com/settings/tokens (no scopes needed)'));
  console.log();

  const token = await password({
    message: 'paste token',
    mask: '*',
  });

  if (!token.trim()) {
    console.log(chalk.dim('  no token entered, skipping. run fontgrep setup to add one later.'));
    return null;
  }

  console.log(chalk.green('  ✓ token saved'));
  return token.trim();
}

export async function promptToken(): Promise<string> {
  console.log();
  console.log(chalk.dim('  create a token at github.com/settings/tokens (no scopes needed)'));
  console.log();

  const token = await password({
    message: 'paste token',
    mask: '*',
  });

  if (!token.trim()) {
    throw new Error('No token provided.');
  }

  console.log(chalk.green('  ✓ token saved'));
  return token.trim();
}

export async function promptAction(maxRank: number, relatedFamilies: string[] = [], showGithub = false): Promise<PromptResult> {
  const familyHint = relatedFamilies.length > 0
    ? `, [f1-f${relatedFamilies.length}] switch family`
    : '';
  const githubHint = showGithub ? ', [g] github results' : '';
  const answer = await input({
    message: `download [1-${maxRank}], [a] all${familyHint}${githubHint}, [q] quit`,
    theme: { prefix: '  →' },
  });

  const trimmed = answer.trim().toLowerCase();

  if (trimmed === 'q' || trimmed === 'quit') return 'quit';
  if (trimmed === 'a' || trimmed === 'all') return 'all';
  if (showGithub && (trimmed === 'g' || trimmed === 'github')) return 'github';

  // Family switch: f1, f2, ...
  const familyMatch = trimmed.match(/^f(\d+)$/);
  if (familyMatch) {
    const idx = parseInt(familyMatch[1]) - 1;
    if (idx >= 0 && idx < relatedFamilies.length) {
      return { switchToFamily: relatedFamilies[idx] };
    }
    console.log(chalk.red(`  no such family: f${idx + 1}`));
    return promptAction(maxRank, relatedFamilies);
  }

  // Support ranges and comma-separated: "1-3", "1,3,5", "1-3,5"
  const nums: number[] = [];
  for (const part of trimmed.split(',')) {
    const rangeParts = part.trim().split('-');
    if (rangeParts.length === 2) {
      const start = parseInt(rangeParts[0]);
      const end = parseInt(rangeParts[1]);
      if (!isNaN(start) && !isNaN(end) && start >= 1 && end <= maxRank && start <= end) {
        for (let i = start; i <= end; i++) nums.push(i);
      }
    } else {
      const num = parseInt(part.trim());
      if (!isNaN(num) && num >= 1 && num <= maxRank) nums.push(num);
    }
  }

  if (nums.length === 0) {
    console.log(chalk.red(`  invalid selection: ${answer}`));
    return promptAction(maxRank, relatedFamilies);
  }

  return [...new Set(nums)].sort((a, b) => a - b);
}
