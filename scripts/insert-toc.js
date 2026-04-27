#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const TOC_START = '<!-- toc -->';
const TOC_END = '<!-- /toc -->';

const here = dirname(fileURLToPath(import.meta.url));
const readmePath = resolve(here, '..', 'README.md');

const source = await readFile(readmePath, 'utf8');

const inFence = (() => {
  const fences = [];
  let open = false;
  for (const [i, line] of source.split('\n').entries()) {
    if (/^```/.test(line)) {
      open = !open;
    }
    fences[i] = open;
  }
  return (i) => fences[i];
})();

const lines = source.split('\n');
/** @type {Array<{ level: number, text: string, slug: string }>} */
const headlines = [];
const slugCounts = new Map();
let firstHeadlineIdx = -1;

for (const [i, line] of lines.entries()) {
  if (inFence(i)) continue;
  const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
  if (!match) continue;
  const level = match[1].length;
  if (level === 1) continue;
  const text = match[2].replace(/\*/g, '\\*');
  const baseSlug = slugify(match[2]);
  const n = slugCounts.get(baseSlug) ?? 0;
  slugCounts.set(baseSlug, n + 1);
  const slug = n === 0 ? baseSlug : `${baseSlug}-${n}`;
  headlines.push({ level, text, slug });
  if (firstHeadlineIdx === -1) firstHeadlineIdx = i;
}

if (firstHeadlineIdx === -1 || headlines.length === 0) {
  console.error('No non-title headlines found in README.md; nothing to do.');
  process.exit(0);
}

const minLevel = Math.min(...headlines.map((h) => h.level));
const tocLines = headlines.map(({ level, text, slug }) => `${'  '.repeat(level - minLevel)}- [${text}](#${slug})`);
const tocBlock = [TOC_START, '', ...tocLines, '', TOC_END].join('\n');

const startIdx = lines.findIndex((l) => l.trim() === TOC_START);
const endIdx = lines.findIndex((l) => l.trim() === TOC_END);

let updated;
if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
  updated = [...lines.slice(0, startIdx), tocBlock, ...lines.slice(endIdx + 1)].join('\n');
} else {
  updated = [...lines.slice(0, firstHeadlineIdx), tocBlock, '', ...lines.slice(firstHeadlineIdx)].join('\n');
}

if (updated === source) {
  console.log('README.md TOC already up to date.');
} else {
  await writeFile(readmePath, updated);
  console.log(`Inserted TOC with ${headlines.length} entries.`);
}

/**
 * @param {string} text
 * @returns {string}
 */
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[`*_~]/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}
