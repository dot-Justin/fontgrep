import type { SearchResult } from './types.js';

const WEIGHT_NAMES: Record<number, string> = {
  100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular',
  500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black',
};

interface FontsourceVariantUrl {
  url: { woff2?: string; woff?: string; ttf?: string };
}

interface FontsourceFont {
  id: string;
  family: string;
  weights: number[];
  styles: string[];
  subsets: string[];
  variants: Record<string, Record<string, Record<string, FontsourceVariantUrl>>>;
}

function toSlug(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, '-');
}

function slugVariants(query: string): string[] {
  const slug = toSlug(query);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of [slug, slug.replace(/-/g, ''), query.trim().toLowerCase()]) {
    if (!seen.has(v)) { seen.add(v); out.push(v); }
  }
  return out;
}

async function fetchFont(id: string): Promise<FontsourceFont | null> {
  try {
    const res = await fetch(`https://api.fontsource.org/v1/fonts/${encodeURIComponent(id)}`, {
      headers: { 'User-Agent': 'fontgrep' },
    });
    if (!res.ok) return null;
    return (await res.json()) as FontsourceFont;
  } catch {
    return null;
  }
}

function toResults(font: FontsourceFont): SearchResult[] {
  const results: SearchResult[] = [];
  const familyCompact = font.family.replace(/\s+/g, '');

  for (const weightStr of Object.keys(font.variants).sort((a, b) => Number(a) - Number(b))) {
    const weight = Number(weightStr);
    const weightName = WEIGHT_NAMES[weight] ?? `W${weight}`;
    const styleMap = font.variants[weightStr];

    for (const style of ['normal', 'italic']) {
      if (!styleMap[style]) continue;
      const latinEntry = styleMap[style]['latin'] ?? Object.values(styleMap[style])[0];
      if (!latinEntry) continue;

      const styleSuffix = style === 'italic' ? '-Italic' : '';
      const filename = `${familyCompact}-${weightName}${styleSuffix}.woff2`;
      const cdnUrl = `https://cdn.jsdelivr.net/fontsource/fonts/${font.id}@latest/latin-${weight}-${style}.woff2`;

      results.push({
        filename,
        path: `fontsource/${font.id}/${filename}`,
        repo: `fontsource/${font.id}`,
        owner: 'fontsource',
        stars: 0,
        ext: 'woff2',
        defaultBranch: 'main',
        source: 'fontsource',
        fontsourceUrl: cdnUrl,
      });
    }
  }

  return results;
}

export async function searchFontsource(query: string): Promise<SearchResult[]> {
  for (const slug of slugVariants(query)) {
    const font = await fetchFont(slug);
    if (font) return toResults(font);
  }
  return [];
}
