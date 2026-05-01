import type { SearchResult } from './types.js';
import type { StatusCallback } from './github.js';

interface SourcegraphMatch {
  type: string;
  path: string;
  repository: string;
  repoStars: number;
  commit: string;
}

async function searchByExtension(
  query: string,
  ext: string,
  onStatus: StatusCallback,
): Promise<SourcegraphMatch[]> {
  const sgQuery = `file:${query}.*\\.${ext} type:path count:1000`;
  const url = `https://sourcegraph.com/.api/search/stream?q=${encodeURIComponent(sgQuery)}`;

  const res = await fetch(url, {
    headers: {
      Accept: 'text/event-stream',
      'User-Agent': 'fontgrep/0.1.0',
    },
  });

  if (!res.ok) {
    onStatus(`sourcegraph returned ${res.status}, skipping...`);
    return [];
  }

  const text = await res.text();
  const matches: SourcegraphMatch[] = [];

  for (const line of text.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    try {
      const data = JSON.parse(line.slice(6));
      if (!Array.isArray(data)) continue;
      for (const item of data) {
        if (item.type === 'path') {
          matches.push(item as SourcegraphMatch);
        }
      }
    } catch {
      // skip non-JSON lines
    }
  }

  return matches;
}

function queryVariants(query: string): string[] {
  const parts = query.trim().split(/\s+/);
  const seen = new Set<string>();
  const variants: string[] = [];

  const add = (v: string) => {
    const lower = v.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      variants.push(v);
    }
  };

  add(query.trim());
  add(parts.join(''));
  add(parts.join('-'));
  add(parts.join('_'));

  if (parts.length === 1) {
    const split = parts[0].replace(/([a-z])([A-Z])/g, '$1 $2').split(' ');
    if (split.length > 1) {
      add(split.join('-'));
      add(split.join('_'));
      add(split.join(''));
    }
  }

  return variants;
}

export async function searchSourcegraph(
  query: string,
  extensions: string[],
  onStatus: StatusCallback = () => {},
): Promise<{ results: SearchResult[]; totalCount: number; repoCount: number }> {
  const variants = queryVariants(query);

  onStatus(`trying: ${variants.join(', ')}`);

  let totalFound = 0;
  const allMatches: SourcegraphMatch[] = [];

  for (const variant of variants) {
    const variantResults = await Promise.all(
      extensions.map((ext) => searchByExtension(variant, ext, onStatus)),
    );
    for (const matches of variantResults) {
      allMatches.push(...matches);
      totalFound += matches.length;
    }
    if (totalFound > 0) {
      onStatus(`found ${totalFound} results so far...`);
    }
  }

  // Deduplicate by repo+path
  const itemMap = new Map<string, SourcegraphMatch>();
  for (const match of allMatches) {
    const key = `${match.repository}:${match.path}`;
    if (!itemMap.has(key)) itemMap.set(key, match);
  }
  const unique = [...itemMap.values()];

  if (unique.length === 0) {
    return { results: [], totalCount: 0, repoCount: 0 };
  }

  const repos = new Set<string>();
  const results: SearchResult[] = unique.map((match) => {
    // repository is "github.com/owner/repo" — strip the prefix
    const repoFullName = match.repository.replace(/^github\.com\//, '');
    const owner = repoFullName.split('/')[0];
    const filename = match.path.split('/').pop() ?? match.path;
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    repos.add(repoFullName);

    return {
      filename,
      path: match.path,
      repo: repoFullName,
      owner,
      stars: match.repoStars ?? 0,
      ext,
      defaultBranch: match.commit, // commit hash works in raw URLs
    };
  });

  return { results, totalCount: results.length, repoCount: repos.size };
}
