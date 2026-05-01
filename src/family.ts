import type { ScoredResult, FamilyVariant } from './types.js';

const NAMED_WEIGHTS = [
  'Hairline', 'Thin', 'ExtraLight', 'UltraLight', 'Light',
  'Regular', 'Medium', 'SemiBold', 'DemiBold', 'Bold',
  'ExtraBold', 'UltraBold', 'Black', 'Heavy',
];

const STYLES = ['Italic', 'Oblique'];

const NAMED_WEIGHT_PATTERN = new RegExp(
  `[-_]?(${NAMED_WEIGHTS.join('|')})(?=[^a-z]|$)`, 'i',
);

const NUMERIC_WEIGHT_PATTERN = /[-_](\d{3})(?=[-_.\s]|$)/;

const STYLE_PATTERN = new RegExp(
  `[-_]?(${STYLES.join('|')})`, 'i',
);

// Subset/charset indicators — files with these are partial fonts
// Subset/charset indicators — files with these are partial fonts
// Includes full names and common abbreviations (c=cyrillic, l=latin, vi=vietnamese)
const SUBSET_PATTERN = /[-_](latin|cyrillic|vietnamese|greek|hebrew|arabic|devanagari|cjk|ext|c-ext|l-ext|l-5[0-9a-f]+|vi|wght)(?=[-_.\s]|$)/i;

// Files that are clearly subsets: single charset letter codes like montserrat-400-c.woff2
const SUBSET_FILENAME_PATTERN = /[-_]\d{3}[-_][a-z](?:[-_](?:ext|i))?(?=\.|$)/i;

// Hash/version junk in filenames
const JUNK_PATTERN = /[0-9a-f]{6,}|webfont|\[wght\]|subset|v\d+/i;

// Variable font indicators
const VARIABLE_PATTERN = /[-_]?(Variable|VF|VariableFont)/i;

const WEIGHT_ORDER: Record<string, number> = {
  hairline: 50, thin: 100, extralight: 200, ultralight: 200,
  light: 300, regular: 400, medium: 500,
  semibold: 600, demibold: 600, bold: 700,
  extrabold: 800, ultrabold: 800, black: 900, heavy: 950,
};

const NUMERIC_TO_NAME: Record<number, string> = {
  100: 'thin', 200: 'extralight', 300: 'light',
  400: 'regular', 500: 'medium', 600: 'semibold',
  700: 'bold', 800: 'extrabold', 900: 'black',
};

export function parseVariant(filename: string): {
  weight: string;
  style: string;
  isSubset: boolean;
  isVariable: boolean;
  familyBase: string;
} {
  const base = filename.replace(/\.[^.]+$/, '');

  const isSubset = SUBSET_PATTERN.test(base) || SUBSET_FILENAME_PATTERN.test(base) || JUNK_PATTERN.test(base);
  const isVariable = VARIABLE_PATTERN.test(base);

  // Try named weight first
  const namedMatch = base.match(NAMED_WEIGHT_PATTERN);
  let weight = 'regular';

  if (namedMatch) {
    weight = namedMatch[1].toLowerCase();
  } else {
    // Try numeric weight
    const numMatch = base.match(NUMERIC_WEIGHT_PATTERN);
    if (numMatch) {
      const num = parseInt(numMatch[1]);
      weight = NUMERIC_TO_NAME[num] ?? `w${num}`;
    } else if (isVariable) {
      weight = 'variable';
    }
  }

  const styleMatch = base.match(STYLE_PATTERN);
  const style = styleMatch ? styleMatch[1].toLowerCase() : '';

  // Extract family base name (strip weight, style, version, subset info)
  let familyBase = base
    .replace(NAMED_WEIGHT_PATTERN, '')
    .replace(NUMERIC_WEIGHT_PATTERN, '')
    .replace(STYLE_PATTERN, '')
    .replace(VARIABLE_PATTERN, '')
    .replace(SUBSET_PATTERN, '')
    .replace(/[-_]v\d+[-_]/g, '-')    // version strings like -v14-
    .replace(/[-_]+$/, '')             // trailing separators
    .replace(/^[-_]+/, '')             // leading separators
    .toLowerCase();

  // Normalize separators
  familyBase = familyBase.replace(/[-_]+/g, '-');

  return { weight, style, isSubset, isVariable, familyBase };
}

function queryMatchScore(familyName: string, query: string): number {
  const f = familyName.replace(/-/g, '');
  const q = query.toLowerCase().replace(/\s+/g, '');
  if (f === q) return 4;
  if (f.startsWith(q)) return 3;
  if (f.includes(q)) return 2;
  if (query.toLowerCase().split(/\s+/).every((w) => f.includes(w))) return 1;
  return 0;
}

export function groupByFamily(results: ScoredResult[], query: string): {
  families: Map<string, FamilyVariant[]>;
  primaryFamily: string;
} {
  const allVariants: FamilyVariant[] = results.map((r) => {
    const { weight, style, isSubset, isVariable, familyBase } = parseVariant(r.filename);
    return { ...r, weight, style, isSubset, isVariable, familyBase };
  });

  // Filter out subsets — prefer full font files
  const fullFonts = allVariants.filter((v) => !v.isSubset);
  const pool = fullFonts.length > 0 ? fullFonts : allVariants;

  // Group by family base name
  const familyMap = new Map<string, FamilyVariant[]>();
  for (const v of pool) {
    const key = v.familyBase;
    if (!familyMap.has(key)) familyMap.set(key, []);
    familyMap.get(key)!.push(v);
  }

  // Within each family, deduplicate by weight+style (keep best scored)
  for (const [key, variants] of familyMap) {
    const deduped = new Map<string, FamilyVariant>();
    for (const v of variants) {
      const wkey = `${v.weight}-${v.style}`;
      const existing = deduped.get(wkey);
      if (!existing || v.score > existing.score) {
        deduped.set(wkey, v);
      }
    }

    // Sort by weight order
    const sorted = [...deduped.values()].sort((a, b) => {
      const aw = WEIGHT_ORDER[a.weight] ?? 400;
      const bw = WEIGHT_ORDER[b.weight] ?? 400;
      if (aw !== bw) return aw - bw;
      return a.style.localeCompare(b.style);
    });

    familyMap.set(key, sorted);
  }

  // Determine primary family: query match first, then most weights, then stars
  let primaryFamily = '';
  let bestMatch = -1;
  let bestWeights = -1;
  let bestStars = -1;
  for (const [key, variants] of familyMap) {
    const match = queryMatchScore(key, query);
    const weights = variants.length;
    const stars = variants.reduce((s, v) => s + v.stars, 0);
    const beats =
      match > bestMatch ||
      (match === bestMatch && weights > bestWeights) ||
      (match === bestMatch && weights === bestWeights && stars > bestStars);
    if (beats) {
      bestMatch = match;
      bestWeights = weights;
      bestStars = stars;
      primaryFamily = key;
    }
  }

  return { families: familyMap, primaryFamily };
}
