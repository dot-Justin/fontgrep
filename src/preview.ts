import * as http from 'node:http';
import * as net from 'node:net';
import * as fs from 'node:fs/promises';
import * as nodePath from 'node:path';
import * as os from 'node:os';
import * as readline from 'node:readline';
import { spawn } from 'node:child_process';
import chalk from 'chalk';
import ora from 'ora';
import { downloadFont } from './download.js';
import type { FamilyVariant, ScoredResult } from './types.js';

const WEIGHT_CSS: Record<string, number | string> = {
  hairline: 50, thin: 100, extralight: 200, ultralight: 200,
  light: 300, regular: 400, medium: 500, semibold: 600,
  demibold: 600, bold: 700, extrabold: 800, ultrabold: 800,
  black: 900, heavy: 950, variable: '100 900',
};

const FORMAT_MAP: Record<string, string> = {
  ttf: 'truetype', otf: 'opentype', woff: 'woff', woff2: 'woff2',
};

const FONT_MIME: Record<string, string> = {
  ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2',
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function cssWeight(v: FamilyVariant): number | string {
  return WEIGHT_CSS[v.weight] ?? 400;
}

async function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as net.AddressInfo;
      server.close(() => resolve(addr.port));
    });
    server.on('error', reject);
  });
}

function openBrowser(url: string): void {
  try {
    const child = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
    child.unref();
  } catch {
    console.log(chalk.dim(`  open ${url} in your browser`));
  }
}

async function downloadFontPreview(
  result: ScoredResult,
  outDir: string,
  token: string,
): Promise<void> {
  const spinner = ora({
    text: chalk.dim(result.filename),
    prefixText: chalk.dim('  ◌'),
    color: 'yellow',
  }).start();

  try {
    const headers: Record<string, string> = { 'User-Agent': 'fontgrep' };
    if (token) headers['Authorization'] = `token ${token}`;

    const res = await fetch(result.rawUrl, { headers });
    if (!res.ok) {
      spinner.fail(chalk.dim(`${result.filename}  (${res.status})`));
      return;
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    await fs.mkdir(outDir, { recursive: true });
    await fs.writeFile(nodePath.join(outDir, result.filename), buffer);

    spinner.stopAndPersist({
      symbol: chalk.dim('  ◌'),
      text: chalk.dim(result.filename),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    spinner.fail(chalk.dim(`${result.filename}  ${msg}`));
  }
}

function generateHtml(
  variants: FamilyVariant[],
  familyName: string,
  displayLabel: string,
): string {
  // @font-face blocks
  const fontFaceBlocks = variants.map((v) => {
    const w = cssWeight(v);
    const fmt = FORMAT_MAP[v.ext] ?? 'truetype';
    const style = v.style === 'italic' ? 'italic' : 'normal';
    return `@font-face {
      font-family: 'PreviewFont';
      src: url('/fonts/${escapeHtml(v.filename)}') format('${fmt}');
      font-weight: ${w};
      font-style: ${style};
      font-display: swap;
    }`;
  }).join('\n');

  // Family name — split into per-character spans for soft-blur-in
  const rawFamilyName = familyName.split('-').map(capitalize).join(' ');
  const escapedFamilyName = escapeHtml(rawFamilyName);
  const charCount = rawFamilyName.length;
  const charSpans = rawFamilyName.split('').map((ch, i) => {
    if (ch === ' ') return `<span class="char space" style="--i:${i}">&nbsp;</span>`;
    return `<span class="char" aria-hidden="true" style="--i:${i}">${escapeHtml(ch)}</span>`;
  }).join('');

  // Row stagger starts after most chars have landed
  const rowStartMs = Math.max(400, charCount * 40 + 250);

  // Specimen strips — full-width, floating meta label
  const strips = variants.map((v) => {
    const w = cssWeight(v);
    const style = v.style === 'italic' ? 'italic' : 'normal';
    const wLabel = capitalize(v.weight);
    const wNum = typeof w === 'number' ? w : '100–900';
    const badge = v.isVariable
      ? '<span class="strip-badge">variable</span>'
      : v.style === 'italic'
        ? '<span class="strip-badge">italic</span>'
        : '';
    return `<div class="strip">
      <div class="strip-meta">
        <span class="strip-name">${escapeHtml(wLabel)}</span>
        <span class="strip-dot">·</span>
        <span class="strip-num">${wNum}</span>
        ${badge}
      </div>
      <div class="sample-text" style="font-weight: ${w}; font-style: ${style};">The quick brown fox jumps over the lazy dog</div>
    </div>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapedFamilyName} — fontgrep</title>
<!-- Space Grotesk: brand/UI · DM Mono: labels/numbers (design-taste-frontend: no Inter/system-ui) -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
${fontFaceBlocks}

/* ── Color system ──
   --bg is @property <color> so it can be CSS-transitioned (cascades into color-mix() too).
   --fg and --accent are unregistered — instant updates, Figma-correct. */
@property --bg {
  syntax: '<color>';
  inherits: true;
  initial-value: #0d0c0b;
}

:root {
  --fg: #f2ede6;
  --bg: #0d0c0b;
  --accent: #c9a84c;
  --preview-size: 64px;
  --preview-spacing: 0;
  --preview-leading: 1.15;
  /* Animate bg only — fired when computeBg() crosses the dark/light threshold */
  transition: --bg 0.55s cubic-bezier(0.32, 0.72, 0, 1);
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

html, body {
  background: var(--bg);
  color: var(--fg);
  min-height: 100dvh;
}

body {
  font-family: 'Space Grotesk', 'DM Mono', ui-monospace, monospace;
  padding-bottom: 140px;
}

/* ── Grain overlay (high-end-visual-design: Editorial Luxury texture)
   Fixed + pointer-events-none per performance rules — never on scrolling content ── */
.grain {
  position: fixed;
  inset: 0;
  z-index: 9999;
  pointer-events: none;
  opacity: 0.045;
  mix-blend-mode: overlay;
}
.grain svg { width: 100%; height: 100%; }

/* ── Top bar — pure positioner, NO opacity/filter/transform (would isolate backdrop stacking context) ── */
.top-bar {
  position: fixed;
  top: 0; left: 0; right: 0;
  height: 60px;
  display: flex;
  align-items: center;
  padding: 0 1.5rem;
  z-index: 200;
  pointer-events: none;
}

/* Liquid glass pill — fade lives HERE not on .top-bar, so backdrop-filter sees real page content.
   backdrop-filter on a parent with opacity<1 blurs an isolated compositing surface (invisible),
   not the actual document — that's why the blur was missing. */
.top-bar-pill {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  height: 38px;
  border-radius: 9999px;
  padding: 0 5px 0 1.25rem;
  pointer-events: auto;
  /* Glass substrate: dark fill + heavy blur of content behind */
  background: color-mix(in srgb, var(--bg) 65%, transparent);
  backdrop-filter: blur(28px) saturate(160%) brightness(0.8);
  -webkit-backdrop-filter: blur(28px) saturate(160%) brightness(0.8);
  /* Hairline border — slightly brighter top edge simulates ambient light on rim */
  border: 1px solid color-mix(in srgb, var(--fg) 10%, transparent);
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, var(--fg) 10%, transparent),
    0 4px 20px -2px rgba(0, 0, 0, 0.4);
  /* Fade in — animation on pill, not parent, preserves backdrop stacking context */
  opacity: 0;
  animation: fade-in 0.3s 0.05s cubic-bezier(0.32, 0.72, 0, 1) forwards;
}

@keyframes fade-in { to { opacity: 1; } }

.fg-brand {
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 500;
  font-size: 0.72rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--accent);
  opacity: 0.7;
  user-select: none;
}

.close-btn {
  font-family: 'DM Mono', monospace;
  font-size: 0.62rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  background: transparent;
  border: 1px solid color-mix(in srgb, var(--fg) 18%, transparent);
  color: color-mix(in srgb, var(--fg) 50%, transparent);
  padding: 0 12px;
  height: 28px;
  line-height: 1;
  min-width: 44px;
  border-radius: 9999px;
  cursor: pointer;
  display: flex;
  align-items: center;
  align-self: center;
  transition:
    color 0.15s cubic-bezier(0.4, 0, 0.2, 1),
    border-color 0.15s cubic-bezier(0.4, 0, 0.2, 1),
    background 0.15s cubic-bezier(0.4, 0, 0.2, 1),
    transform 0.15s cubic-bezier(0.4, 0, 0.2, 1);
}
.close-btn:hover {
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 55%, transparent);
  background: color-mix(in srgb, var(--accent) 7%, transparent);
  transform: translateY(-1px);
}
.close-btn:active {
  transform: scale(0.97);
  transition-duration: 0.08s;
}

/* ── Hero ── */
.hero {
  padding: 6rem 3rem 2rem;
  opacity: 0;
  transform: translateY(10px);
  animation: hero-in 0.45s 0.1s cubic-bezier(0.32, 0.72, 0, 1) forwards;
}

@keyframes hero-in { to { opacity: 1; transform: translateY(0); } }

/* Eyebrow — editorial divider line with centered metadata
   micro-scale-fade (animate-text catalog) */
.eyebrow {
  display: flex;
  align-items: center;
  gap: 1.25rem;
  margin-bottom: 2.25rem;
  opacity: 0;
  animation: micro-scale-fade 0.4s 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}
@keyframes micro-scale-fade {
  from { opacity: 0; transform: scale(0.97); }
  to   { opacity: 1; transform: scale(1); }
}
.eyebrow-rule {
  flex: 1;
  height: 1px;
  background: color-mix(in srgb, var(--fg) 12%, transparent);
}
.eyebrow-text {
  font-family: 'DM Mono', monospace;
  font-size: 0.63rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--accent);
  opacity: 0.72;
  white-space: nowrap;
}

/* Title — soft-blur-in per character (animate-text: Apple hero reveal)
   Anti-center bias: left-aligned (design-taste-frontend §3 Rule 3) */
.specimen-title {
  font-family: 'PreviewFont', sans-serif;
  font-size: clamp(5rem, 18vw, 14rem);
  font-weight: 700;
  line-height: 0.88;
  letter-spacing: -0.03em;
  color: var(--fg);
  display: block;
}

.char {
  display: inline-block;
  opacity: 0;
  transform: translateY(0.22em);
  filter: blur(8px);
  animation: char-in 0.65s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  animation-delay: calc(var(--i) * 40ms + 200ms);
}
.char.space { display: inline; }

@keyframes char-in {
  to { opacity: 1; transform: translateY(0); filter: blur(0); }
}

/* ── Specimen strips — full-width (type foundry layout) ── */
.specimens {
  padding: 0;
  margin-top: 3.5rem;
}

.strip {
  position: relative;
  padding: 2.25rem 3rem 2.25rem 3.25rem;
  border-bottom: 1px solid color-mix(in srgb, var(--fg) 7%, transparent);
  border-left: 2px solid transparent;
  /* Entrance state — rises from below (high-end-visual-design §5C) */
  opacity: 0;
  transform: translateY(16px);
  filter: blur(4px);
  transition:
    border-left-color 0.15s cubic-bezier(0.4, 0, 0.2, 1),
    background 0.15s cubic-bezier(0.4, 0, 0.2, 1);
}
.strip.visible {
  opacity: 1;
  transform: translateY(0);
  filter: blur(0);
  transition:
    border-left-color 0.15s cubic-bezier(0.4, 0, 0.2, 1),
    background 0.15s cubic-bezier(0.4, 0, 0.2, 1),
    opacity 0.55s cubic-bezier(0.32, 0.72, 0, 1),
    transform 0.55s cubic-bezier(0.32, 0.72, 0, 1),
    filter 0.55s cubic-bezier(0.32, 0.72, 0, 1);
}
.strip:hover {
  border-left-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 4%, transparent);
}

/* Floating meta label — top-right of each strip */
.strip-meta {
  position: absolute;
  top: 0.9rem;
  right: 3rem;
  display: flex;
  align-items: center;
  gap: 0.45rem;
  font-family: 'DM Mono', monospace;
  font-size: 0.58rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--fg) 28%, transparent);
  transition: color 0.15s cubic-bezier(0.4, 0, 0.2, 1);
}
.strip:hover .strip-meta {
  color: color-mix(in srgb, var(--fg) 60%, transparent);
}
.strip-dot {
  opacity: 0.5;
}
.strip-badge {
  border: 1px solid color-mix(in srgb, var(--accent) 60%, transparent);
  color: var(--accent);
  padding: 1px 5px;
  border-radius: 2px;
  font-size: 0.5rem;
  opacity: 0.8;
  letter-spacing: 0.06em;
}

.sample-text {
  font-family: 'PreviewFont', sans-serif;
  font-size: var(--preview-size);
  letter-spacing: calc(var(--preview-spacing) * 1px);
  line-height: var(--preview-leading);
  color: var(--fg);
  overflow-wrap: break-word;
  word-break: break-word;
  transition:
    font-size 0.2s cubic-bezier(0.32, 0.72, 0, 1),
    letter-spacing 0.2s cubic-bezier(0.32, 0.72, 0, 1),
    line-height 0.2s cubic-bezier(0.32, 0.72, 0, 1);
}

/* ── Controls panel — two-row layout ── */
.controls-panel {
  position: fixed;
  bottom: 0; left: 0; right: 0;
  background: color-mix(in srgb, var(--bg) 96%, transparent);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-top: 1px solid color-mix(in srgb, var(--fg) 8%, transparent);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
  padding: 1rem 3rem 1.25rem;
  transform: translateY(100%);
  animation: panel-up 0.5s 0.6s cubic-bezier(0.32, 0.72, 0, 1) forwards;
  z-index: 100;
}

@keyframes panel-up { to { transform: translateY(0); } }

.controls-row {
  display: flex;
  align-items: center;
  gap: 2rem;
  max-width: 1400px;
  margin: 0 auto;
}
.controls-row + .controls-row {
  margin-top: 0.85rem;
  padding-top: 0.85rem;
  border-top: 1px solid color-mix(in srgb, var(--fg) 6%, transparent);
}

.ctrl-label {
  font-family: 'DM Mono', monospace;
  font-size: 0.58rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--fg) 40%, transparent);
  white-space: nowrap;
  display: block;
  margin-bottom: 4px;
}
.ctrl-val {
  color: var(--accent);
}

.ctrl-group {
  display: flex;
  flex-direction: column;
}

/* Sample text — full width row 1 */
#sampleText {
  width: 100%;
  background: color-mix(in srgb, var(--fg) 5%, transparent);
  border: 1px solid color-mix(in srgb, var(--fg) 10%, transparent);
  border-radius: 5px;
  color: var(--fg);
  font-family: 'Space Grotesk', sans-serif;
  font-size: 0.82rem;
  padding: 6px 12px;
  outline: none;
  transition: border-color 0.15s cubic-bezier(0.4, 0, 0.2, 1);
}
#sampleText:focus {
  border-color: var(--accent);
}
.ctrl-text {
  flex: 1;
}

/* Range sliders */
input[type="range"] {
  -webkit-appearance: none;
  appearance: none;
  width: 88px;
  height: 2px;
  background: color-mix(in srgb, var(--fg) 18%, transparent);
  border-radius: 1px;
  outline: none;
  cursor: pointer;
  display: block;
}
input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--accent);
  cursor: pointer;
  transition: transform 0.1s cubic-bezier(0.32, 0.72, 0, 1);
}
input[type="range"]::-webkit-slider-thumb:hover { transform: scale(1.3); }
input[type="range"]::-moz-range-thumb {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--accent);
  border: none;
  cursor: pointer;
}

/* Color pickers */
.ctrl-colors {
  display: flex;
  flex-direction: row;
  gap: 1rem;
  align-items: center;
}
.ctrl-color-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  cursor: pointer;
}
input[type="color"] {
  -webkit-appearance: none;
  appearance: none;
  width: 32px;
  height: 20px;
  border: 1px solid color-mix(in srgb, var(--fg) 18%, transparent);
  border-radius: 4px;
  background: none;
  cursor: pointer;
  padding: 0;
}
input[type="color"]::-webkit-color-swatch-wrapper { padding: 0; }
input[type="color"]::-webkit-color-swatch { border: none; border-radius: 3px; }

/* Buttons */
.ctrl-btns {
  display: flex;
  gap: 0.75rem;
  margin-left: auto;
  align-items: center;
}
.btn-reset {
  font-family: 'DM Mono', monospace;
  font-size: 0.6rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  background: transparent;
  border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
  color: var(--accent);
  padding: 5px 14px;
  border-radius: 4px;
  cursor: pointer;
  transition:
    background 0.15s cubic-bezier(0.4, 0, 0.2, 1),
    border-color 0.15s cubic-bezier(0.4, 0, 0.2, 1),
    transform 0.15s cubic-bezier(0.4, 0, 0.2, 1);
}
.btn-reset:hover {
  background: color-mix(in srgb, var(--accent) 9%, transparent);
  border-color: var(--accent);
}
.btn-reset:active { transform: scale(0.97); transition-duration: 0.08s; }

/* ── prefers-reduced-motion (ui-ux-pro-max §1 CRITICAL) ── */
@media (prefers-reduced-motion: reduce) {
  :root         { transition: none; }
  .top-bar-pill { animation: none; opacity: 1; }
  .hero       { animation: none; opacity: 1; transform: none; }
  .eyebrow    { animation: none; opacity: 1; }
  .char       { animation: none; opacity: 1; transform: none; filter: none; }
  .strip      { opacity: 1; transform: none; filter: none; }
  .strip.visible { transition: border-left-color 0.1s, background 0.1s; }
  .controls-panel { animation: none; transform: none; }
  .sample-text { transition: none; }
}
</style>
</head>
<body>

<!-- Grain overlay (high-end-visual-design Editorial Luxury) -->
<div class="grain" aria-hidden="true">
  <svg width="100%" height="100%">
    <filter id="grain-filter">
      <feTurbulence type="fractalNoise" baseFrequency="0.75" numOctaves="4" stitchTiles="stitch"/>
      <feColorMatrix type="saturate" values="0"/>
    </filter>
    <rect width="100%" height="100%" filter="url(#grain-filter)"/>
  </svg>
</div>

<!-- Top bar: outer positioner → inner liquid glass pill -->
<div class="top-bar">
  <div class="top-bar-pill">
    <div class="fg-brand">fontgrep</div>
    <button class="close-btn" id="closeBtn">close ×</button>
  </div>
</div>

<!-- Hero: eyebrow divider + massive title -->
<section class="hero">
  <div class="eyebrow">
    <span class="eyebrow-rule"></span>
    <span class="eyebrow-text">${escapeHtml(displayLabel)}</span>
    <span class="eyebrow-rule"></span>
  </div>
  <h1 class="specimen-title" aria-label="${escapedFamilyName}">${charSpans}</h1>
</section>

<!-- Specimen strips: full-width, floating labels -->
<main class="specimens">
  ${strips}
</main>

<!-- Controls panel: two rows -->
<div class="controls-panel">
  <!-- Row 1: sample text input -->
  <div class="controls-row">
    <div class="ctrl-group ctrl-text" style="width:100%">
      <label class="ctrl-label" for="sampleText">Sample text</label>
      <input type="text" id="sampleText" value="The quick brown fox jumps over the lazy dog" autocomplete="off">
    </div>
  </div>
  <!-- Row 2: sliders + colors + reset -->
  <div class="controls-row">
    <div class="ctrl-group">
      <span class="ctrl-label">Size <span class="ctrl-val" id="sizeVal">64</span>px</span>
      <input type="range" id="sizeSlider" min="12" max="200" value="64">
    </div>
    <div class="ctrl-group">
      <span class="ctrl-label">Spacing <span class="ctrl-val" id="spacingVal">0</span>px</span>
      <input type="range" id="spacingSlider" min="-2" max="20" value="0" step="0.5">
    </div>
    <div class="ctrl-group">
      <span class="ctrl-label">Leading <span class="ctrl-val" id="leadingVal">1.2</span></span>
      <input type="range" id="leadingSlider" min="0.8" max="3.0" value="1.2" step="0.1">
    </div>
    <div class="ctrl-colors">
      <div class="ctrl-color-item">
        <span class="ctrl-label">Color</span>
        <input type="color" id="textColor" value="#f2ede6">
      </div>
    </div>
    <div class="ctrl-btns">
      <button class="btn-reset" id="resetBtn">Reset</button>
    </div>
  </div>
</div>

<script>
(function() {
  var root = document.documentElement;

  // ── Stagger strips in — starts after most title chars have landed ──
  var rowStart = ${rowStartMs};
  var strips = document.querySelectorAll('.strip');
  strips.forEach(function(strip, i) {
    setTimeout(function() { strip.classList.add('visible'); }, rowStart + i * 55);
  });

  // ── Color math ──
  var DARK_BG  = '#0d0c0b'; // warm near-black
  var LIGHT_BG = '#f5f2ee'; // warm near-white (editorial paper)

  function hexToRgb(hex) {
    return [parseInt(hex.slice(1,3),16)/255, parseInt(hex.slice(3,5),16)/255, parseInt(hex.slice(5,7),16)/255];
  }
  function rgbToHsl(r,g,b) {
    var max=Math.max(r,g,b), min=Math.min(r,g,b), h=0, s=0, l=(max+min)/2;
    if(max!==min){var d=max-min; s=l>0.5?d/(2-max-min):d/(max+min);
      if(max===r)h=((g-b)/d+(g<b?6:0))/6;
      else if(max===g)h=((b-r)/d+2)/6;
      else h=((r-g)/d+4)/6;}
    return [h,s,l];
  }
  function hslToHex(h,s,l){
    function h2r(p,q,t){if(t<0)t+=1;if(t>1)t-=1;if(t<1/6)return p+(q-p)*6*t;if(t<1/2)return q;if(t<2/3)return p+(q-p)*(2/3-t)*6;return p;}
    var q=l<0.5?l*(1+s):l+s-l*s, p=2*l-q;
    return '#'+[h+1/3,h,h-1/3].map(function(t){return Math.round(h2r(p,q,t)*255).toString(16).padStart(2,'0');}).join('');
  }
  // WCAG relative luminance (ITU-R BT.709)
  function getLuminance(hex) {
    var c=hexToRgb(hex);
    var r=c[0]<=0.04045?c[0]/12.92:Math.pow((c[0]+0.055)/1.055,2.4);
    var g=c[1]<=0.04045?c[1]/12.92:Math.pow((c[1]+0.055)/1.055,2.4);
    var b=c[2]<=0.04045?c[2]/12.92:Math.pow((c[2]+0.055)/1.055,2.4);
    return 0.2126*r+0.7152*g+0.0722*b;
  }
  // Light text → dark bg, dark text → light bg (phosphoricons.com pattern)
  function computeBg(fgHex) {
    return getLuminance(fgHex) > 0.18 ? DARK_BG : LIGHT_BG;
  }
  // Accent lightness adapts: darker on light bg for contrast
  function deriveAccent(fgHex, bgLum) {
    var rgb=hexToRgb(fgHex), hsl=rgbToHsl(rgb[0],rgb[1],rgb[2]), h=hsl[0], s=hsl[1];
    if(s<0.08){h=38/360;s=0.65;}else{s=Math.min(s*1.6,0.78);}
    return hslToHex(h,s,bgLum<0.5?0.62:0.44);
  }

  // ── Controls ──
  var sampleText    = document.getElementById('sampleText');
  var sizeSlider    = document.getElementById('sizeSlider');
  var sizeVal       = document.getElementById('sizeVal');
  var spacingSlider = document.getElementById('spacingSlider');
  var spacingVal    = document.getElementById('spacingVal');
  var leadingSlider = document.getElementById('leadingSlider');
  var leadingVal    = document.getElementById('leadingVal');
  var textColor     = document.getElementById('textColor');
  var resetBtn      = document.getElementById('resetBtn');
  var closeBtn      = document.getElementById('closeBtn');

  var DEFAULTS = {
    size:'64', spacing:'0', leading:'1.2',
    fg:'#f2ede6',
    sample:'The quick brown fox jumps over the lazy dog'
  };

  function setSampleText(v) {
    document.querySelectorAll('.sample-text').forEach(function(el){ el.textContent = v || DEFAULTS.sample; });
  }

  sampleText.addEventListener('input', function(){ setSampleText(this.value); });

  sizeSlider.addEventListener('input', function(){
    root.style.setProperty('--preview-size', this.value+'px');
    sizeVal.textContent = this.value;
  });
  spacingSlider.addEventListener('input', function(){
    root.style.setProperty('--preview-spacing', this.value);
    spacingVal.textContent = this.value;
  });
  leadingSlider.addEventListener('input', function(){
    root.style.setProperty('--preview-leading', this.value);
    leadingVal.textContent = parseFloat(this.value).toFixed(1);
  });

  textColor.addEventListener('input', function(){
    var fg = this.value;
    var newBg = computeBg(fg);
    root.style.setProperty('--fg', fg);
    root.style.setProperty('--bg', newBg); // @property transition fires, cascades to color-mix() consumers
    root.style.setProperty('--accent', deriveAccent(fg, getLuminance(newBg)));
  });

  resetBtn.addEventListener('click', function(){
    var defaultBg = computeBg(DEFAULTS.fg);
    sizeSlider.value=DEFAULTS.size; spacingSlider.value=DEFAULTS.spacing;
    leadingSlider.value=DEFAULTS.leading; textColor.value=DEFAULTS.fg;
    sampleText.value=DEFAULTS.sample;
    root.style.setProperty('--preview-size', DEFAULTS.size+'px');
    root.style.setProperty('--preview-spacing', DEFAULTS.spacing);
    root.style.setProperty('--preview-leading', DEFAULTS.leading);
    root.style.setProperty('--fg', DEFAULTS.fg);
    root.style.setProperty('--bg', defaultBg);
    root.style.setProperty('--accent', deriveAccent(DEFAULTS.fg, getLuminance(defaultBg)));
    sizeVal.textContent=DEFAULTS.size; spacingVal.textContent=DEFAULTS.spacing;
    leadingVal.textContent=DEFAULTS.leading;
    setSampleText(DEFAULTS.sample);
  });

  // ── Close: button + tab/window close ──
  function sendClose(){ navigator.sendBeacon('/close'); }

  closeBtn.addEventListener('click', function(){ sendClose(); window.close(); });
  window.addEventListener('beforeunload', sendClose);
})();
</script>
</body>
</html>`;
}

export async function startPreview(
  variants: FamilyVariant[],
  token: string,
  familyName: string,
  displayLabel: string,
): Promise<void> {
  const tempDir = await fs.mkdtemp(nodePath.join(os.tmpdir(), 'fontgrep-preview-'));

  console.log(chalk.dim('  fetching fonts for preview (temporary, auto-deleted on close)'));
  console.log();
  for (const v of variants) {
    await downloadFontPreview(v, tempDir, token);
  }

  const html = generateHtml(variants, familyName, displayLabel);
  const port = await findAvailablePort();

  let triggerClose!: () => void;
  const closePromise = new Promise<void>(resolve => { triggerClose = resolve; });

  const server = http.createServer(async (req, res) => {
    const url = req.url ?? '/';

    if (url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    if (url === '/close') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
      triggerClose();
      return;
    }

    if (url.startsWith('/fonts/')) {
      const filename = nodePath.basename(url.slice('/fonts/'.length));
      const safePath = nodePath.resolve(tempDir, filename);
      if (!safePath.startsWith(tempDir + nodePath.sep) && safePath !== tempDir) {
        res.writeHead(403); res.end(); return;
      }
      try {
        const data = await fs.readFile(safePath);
        const ext = nodePath.extname(filename).slice(1).toLowerCase();
        const mime = FONT_MIME[ext] ?? 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' });
        res.end(data);
      } catch { res.writeHead(404); res.end(); }
      return;
    }

    res.writeHead(404); res.end();
  });

  await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve));

  const url = `http://localhost:${port}`;
  console.log(`  ${chalk.cyan('↗')}  preview at ${chalk.white(url)}`);
  console.log();
  openBrowser(url);

  process.stdin.resume();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  process.stdout.write(chalk.dim('  press Enter to close preview...'));
  rl.once('line', triggerClose);
  rl.once('close', triggerClose);

  const cleanup = async () => {
    rl.close();
    process.stdin.pause();
    server.close();
    try { await fs.rm(tempDir, { recursive: true, force: true }); } catch { /* best effort */ }
    console.log();
    console.log(chalk.dim('  preview closed'));
  };

  const sigintHandler = () => { void cleanup().then(() => process.exit(0)); };
  process.once('SIGINT', sigintHandler);
  process.once('SIGTERM', sigintHandler);

  await closePromise;

  process.off('SIGINT', sigintHandler);
  process.off('SIGTERM', sigintHandler);
  await cleanup();
}
