export interface FontgrepConfig {
  token: string | null;
  configured: boolean;
}

export interface SearchResult {
  filename: string;
  path: string;
  repo: string;
  owner: string;
  stars: number;
  ext: string;
  defaultBranch: string;
}

export interface ScoredResult extends SearchResult {
  rank: number;
  rawUrl: string;
  score: number;
}

export interface FamilyVariant extends ScoredResult {
  weight: string;
  style: string;
  isSubset: boolean;
  isVariable: boolean;
  familyBase: string;
}

export interface CLIOptions {
  ext: string[];
  first: boolean;
  family: boolean;
  raw: boolean;
  out: string;
  setup: boolean;
}
