import type { SearchResult, ScoredResult } from './types.js';
import { buildRawUrl } from './github.js';

const EXT_RANK: Record<string, number> = { woff2: 30, otf: 20, ttf: 10 };

function scoreResult(result: SearchResult, query: string): number {
  let s = 0;

  s += EXT_RANK[result.ext] ?? 0;
  s += Math.min(Math.log10(result.stars + 1) * 10, 50);

  const normalizedFilename = result.filename.toLowerCase().replace(/[-_]/g, '');
  const normalizedQuery = query.toLowerCase().replace(/\s+/g, '');
  if (normalizedFilename.startsWith(normalizedQuery)) s += 20;

  s -= Math.min(result.path.split('/').length * 2, 10);

  return s;
}

export function rankResults(results: SearchResult[], query: string): ScoredResult[] {
  const scored: ScoredResult[] = results.map((r) => ({
    ...r,
    rank: 0,
    rawUrl: buildRawUrl(r),
    score: scoreResult(r, query),
  }));

  // Deduplicate by filename, keeping highest score
  const seen = new Map<string, ScoredResult>();
  for (const r of scored) {
    const key = r.filename.toLowerCase();
    const existing = seen.get(key);
    if (!existing || r.score > existing.score) {
      seen.set(key, r);
    }
  }

  const deduped = [...seen.values()].sort((a, b) => b.score - a.score);

  for (let i = 0; i < deduped.length; i++) {
    deduped[i].rank = i + 1;
  }

  return deduped;
}
