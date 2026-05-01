import type { SearchResult } from './types.js';

const SEARCH_URL = 'https://api.github.com/search/code';
const BATCH_SIZE = 9;
const BATCH_DELAY_MS = 6000;

export type StatusCallback = (msg: string) => void;

interface GitHubSearchItem {
  name: string;
  path: string;
  repository: {
    full_name: string;
    owner: { login: string };
  };
}

interface GitHubSearchResponse {
  total_count: number;
  items: GitHubSearchItem[];
}

interface RepoInfo {
  default_branch: string;
  stargazers_count: number;
}

async function countdown(seconds: number, onStatus: StatusCallback): Promise<void> {
  for (let i = seconds; i > 0; i--) {
    onStatus(`rate limited, resuming in ${i}s...`);
    await new Promise((r) => setTimeout(r, 1000));
  }
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

async function fetchRepoInfo(
  repoFullName: string,
  token: string,
): Promise<RepoInfo> {
  const res = await fetch(`https://api.github.com/repos/${repoFullName}`, {
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'fontgrep',
    },
  });

  if (!res.ok) {
    return { default_branch: 'main', stargazers_count: 0 };
  }

  const data = (await res.json()) as RepoInfo;
  return {
    default_branch: data.default_branch ?? 'main',
    stargazers_count: data.stargazers_count ?? 0,
  };
}

async function fetchPage(
  url: string,
  token: string,
  onStatus: StatusCallback,
): Promise<GitHubSearchResponse> {
  const res = await fetch(url, {
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'fontgrep',
    },
  });

  if (res.status === 401) {
    throw new Error('GitHub token is invalid. Run `fontgrep --setup` to reconfigure.');
  }

  if (res.status === 403 || res.status === 429) {
    const resetHeader = res.headers.get('X-RateLimit-Reset');
    const retryAfter = res.headers.get('Retry-After');
    let waitSec = 0;

    if (retryAfter) {
      waitSec = parseInt(retryAfter) || 60;
    } else if (resetHeader) {
      waitSec = Math.ceil((parseInt(resetHeader) * 1000 - Date.now()) / 1000);
    } else {
      waitSec = 60;
    }

    if (waitSec > 0) {
      await countdown(waitSec, onStatus);
      return fetchPage(url, token, onStatus);
    }
    return { total_count: 0, items: [] };
  }

  if (res.status === 422) {
    return { total_count: 0, items: [] };
  }

  if (!res.ok) {
    throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
  }

  return (await res.json()) as GitHubSearchResponse;
}

async function searchSingle(
  filenameQuery: string,
  ext: string,
  token: string,
  onStatus: StatusCallback,
): Promise<GitHubSearchItem[]> {
  const q = `filename:${filenameQuery} extension:${ext}`;
  const baseUrl = `${SEARCH_URL}?q=${encodeURIComponent(q)}&per_page=100`;

  const first = await fetchPage(baseUrl, token, onStatus);
  const allItems = [...first.items];
  const totalPages = Math.min(Math.ceil(first.total_count / 100), 10);

  for (let page = 2; page <= totalPages; page++) {
    onStatus(`${filenameQuery} .${ext} — page ${page}/${totalPages}`);
    const data = await fetchPage(`${baseUrl}&page=${page}`, token, onStatus);
    allItems.push(...data.items);
    if (data.items.length === 0) break;
  }

  return allItems;
}

async function runInBatches<T>(
  tasks: (() => Promise<T>)[],
  batchSize: number,
  delayMs: number,
): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < tasks.length; i += batchSize) {
    if (i > 0) await new Promise((r) => setTimeout(r, delayMs));
    const batch = tasks.slice(i, i + batchSize);
    results.push(...(await Promise.all(batch.map((fn) => fn()))));
  }
  return results;
}

export async function searchFonts(
  query: string,
  extensions: string[],
  token: string,
  onStatus: StatusCallback = () => {},
): Promise<{ results: SearchResult[]; totalCount: number; repoCount: number }> {
  const variants = queryVariants(query);

  onStatus(`trying: ${variants.join(', ')}`);

  let totalFound = 0;

  // Build all search tasks: variant × extension
  const tasks = variants.flatMap((variant) =>
    extensions.map((ext) => async () => {
      const items = await searchSingle(variant, ext, token, onStatus);
      totalFound += items.length;
      if (items.length > 0) {
        onStatus(`found ${totalFound} results so far...`);
      }
      return items;
    }),
  );

  // Run in batches to respect rate limits
  const batched = await runInBatches(tasks, BATCH_SIZE, BATCH_DELAY_MS);
  const allItems = batched.flat();

  // Deduplicate by repo+path (same file found via different query variants)
  const itemMap = new Map<string, GitHubSearchItem>();
  for (const item of allItems) {
    const key = `${item.repository.full_name}:${item.path}`;
    if (!itemMap.has(key)) itemMap.set(key, item);
  }
  const uniqueItems = [...itemMap.values()];

  if (uniqueItems.length === 0) {
    return { results: [], totalCount: 0, repoCount: 0 };
  }

  // Fetch repo info for unique repos
  const uniqueRepos = [...new Set(uniqueItems.map((item) => item.repository.full_name))];
  onStatus(`fetching details for ${uniqueRepos.length} repos...`);
  const repoInfoMap = new Map<string, RepoInfo>();

  const repoTasks = uniqueRepos.map((repo) => () => fetchRepoInfo(repo, token));
  const repoInfos = await runInBatches(repoTasks, BATCH_SIZE, BATCH_DELAY_MS);
  for (let i = 0; i < uniqueRepos.length; i++) {
    repoInfoMap.set(uniqueRepos[i], repoInfos[i]);
  }

  const results: SearchResult[] = uniqueItems.map((item) => {
    const ext = item.name.split('.').pop()?.toLowerCase() ?? '';
    const info = repoInfoMap.get(item.repository.full_name)!;
    return {
      filename: item.name,
      path: item.path,
      repo: item.repository.full_name,
      owner: item.repository.owner.login,
      stars: info.stargazers_count,
      ext,
      defaultBranch: info.default_branch,
    };
  });

  return { results, totalCount: results.length, repoCount: uniqueRepos.length };
}

export function buildRawUrl(result: SearchResult): string {
  if (result.fontsourceUrl) return result.fontsourceUrl;
  return `https://raw.githubusercontent.com/${result.repo}/${result.defaultBranch}/${result.path}`;
}
