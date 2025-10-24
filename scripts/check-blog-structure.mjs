#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const REQUIRED_HEADER_SNIPPETS = [
  '/blogs.json',
  '/blog.index.html',
  '/blog/*.html',
  '/blog/*'
];

const REQUIRED_REDIRECT_SNIPPETS = [
  '/blog/:year-:month-:day-:rest.html',
  '/content/blog/:splat'
];

const errors = [];
const warnings = [];
const heroAssetChecks = [];
const heroHtmlChecks = [];

async function readText(relPath) {
  const fullPath = path.join(repoRoot, relPath);
  try {
    return await fs.readFile(fullPath, 'utf8');
  } catch (err) {
    errors.push(`Missing required file: ${relPath}`);
    return '';
  }
}

async function ensureHeaders() {
  const text = await readText('_headers');
  if (!text) return;
  for (const snippet of REQUIRED_HEADER_SNIPPETS) {
    if (!text.includes(snippet)) {
      errors.push(`_headers is missing required rule for "${snippet}".`);
    }
  }
}

async function ensureRedirects() {
  const text = await readText('_redirects');
  if (!text) return;
  for (const snippet of REQUIRED_REDIRECT_SNIPPETS) {
    if (!text.includes(snippet)) {
      errors.push(`_redirects is missing expected pattern "${snippet}".`);
    }
  }
}

function validateSlug(slug) {
  return typeof slug === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}

function isHttpUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value.trim());
}

function isSitePath(value) {
  return typeof value === 'string' && value.trim().startsWith('/');
}

function cleanSitePath(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.replace(/^[/.]+/, '').replace(/\\+/g, '/');
}

function getIsoDate(entry) {
  const raw = entry?.date_published || entry?.published_at;
  if (!raw) return '';
  const str = String(raw).trim();
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}

function deriveBlogHtmlCandidates(entry) {
  const results = [];
  const seen = new Set();
  const isoDate = getIsoDate(entry);
  const slugValue = typeof entry?.slug === 'string' ? entry.slug.trim() : '';

  const push = (raw) => {
    if (typeof raw !== 'string') return;
    let value = raw.trim();
    if (!value) return;
    if (isHttpUrl(value)) {
      try {
        const parsed = new URL(value);
        value = parsed.pathname || '';
      } catch {
        return;
      }
    }
    if (!value) return;
    value = value.replace(/[?#].*$/, '');
    if (!value) return;
    if (value.startsWith('/')) value = value.slice(1);
    value = value.replace(/^content\//i, '');
    value = value.replace(/^blog\//i, 'blog/');
    if (!value.toLowerCase().startsWith('blog/')) return;
    value = value.replace(/\/index\.html$/i, '.html');
    if (/^blog\/[\w-]+$/i.test(value) && !/\.html$/i.test(value)) {
      value = `${value}.html`;
    }
    if (/^blog\/\d{4}-\d{2}-\d{2}-[\w-]+$/i.test(value) && !/\.html$/i.test(value)) {
      value = `${value}.html`;
    }
    if (!/\.html$/i.test(value)) return;
    if (!seen.has(value)) {
      seen.add(value);
      results.push(value);
    }
  };

  push(entry?.content_url);
  push(entry?.url);
  push(entry?.canonical_url);

  if (slugValue) {
    const slugNoExt = slugValue.replace(/\.html$/i, '');
    if (/^20\d{2}-\d{2}-\d{2}-/.test(slugNoExt)) {
      push(`blog/${slugNoExt}.html`);
    } else if (isoDate) {
      const tail = slugNoExt.replace(/^20\d{2}-\d{2}-\d{2}-/, '') || slugNoExt;
      push(`blog/${isoDate}-${tail}.html`);
    }
  }

  return results;
}

async function ensureHeroAssets() {
  for (const check of heroAssetChecks) {
    const rel = cleanSitePath(check.path);
    if (!rel) continue;
    const full = path.join(repoRoot, rel);
    try {
      await fs.access(full);
    } catch {
      errors.push(`${check.prefix} references hero image "${check.path}" but the file does not exist.`);
    }
  }
}

async function ensureHeroInHtml() {
  for (const check of heroHtmlChecks) {
    if (!check || !check.hero || !check.hero.startsWith('/')) continue;
    const candidates = Array.isArray(check.htmlCandidates) ? check.htmlCandidates : [];
    if (!candidates.length) {
      warnings.push(`${check.prefix} could not be mapped to a blog HTML file for hero validation.`);
      continue;
    }

    let fileRead = null;
    for (const rel of candidates) {
      const full = path.join(repoRoot, rel);
      try {
        const text = await fs.readFile(full, 'utf8');
        fileRead = { rel, text };
        break;
      } catch {
        continue;
      }
    }

    if (!fileRead) {
      warnings.push(`${check.prefix} has no existing HTML file among expected candidates: ${candidates.join(', ')}.`);
      continue;
    }

    if (!fileRead.text.includes(check.hero)) {
      errors.push(`${check.prefix} HTML (${fileRead.rel}) does not include hero image "${check.hero}".`);
    }
  }
}

function validateContentUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  const v = value.trim();
  if (isHttpUrl(v)) return true;
  return /^\/blog\//.test(v);
}

async function ensureBlogsJson() {
  const relPath = 'blogs.json';
  const fullPath = path.join(repoRoot, relPath);
  let raw = '';
  try {
    raw = await fs.readFile(fullPath, 'utf8');
  } catch (err) {
    errors.push('Missing blogs.json file.');
    return;
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    errors.push('blogs.json is not valid JSON.');
    return;
  }

  if (!Array.isArray(data)) {
    errors.push('blogs.json must export an array of blog entries.');
    return;
  }

  const pending = [];

  data.forEach((entry, index) => {
    const prefix = `blogs.json[${index}]`;
    if (!entry || typeof entry !== 'object') {
      errors.push(`${prefix} must be an object.`);
      return;
    }

    if (!validateSlug(entry.slug)) {
      errors.push(`${prefix}.slug is missing or not kebab-case.`);
    }

    if (!entry.title || typeof entry.title !== 'string') {
      errors.push(`${prefix}.title is required.`);
    }

    const site = (entry.site || '').toString().toLowerCase();
    if (site && site !== 'debtreliefguard') {
      warnings.push(`${prefix}.site is "${entry.site}" — entries for other sites should live in their own repo.`);
    }

    const published = entry.date_published || entry.published_at;
    if (!published || Number.isNaN(new Date(published).getTime())) {
      warnings.push(`${prefix} is missing a parseable published date.`);
    }

    const hasHero = isSitePath(entry.thumbnail) || isSitePath(entry.image) || isHttpUrl(entry.thumbnail) || isHttpUrl(entry.image);
    if (!hasHero) {
      warnings.push(`${prefix} is missing a thumbnail/image. 033 will backfill with a placeholder.`);
    }

    const heroCandidates = [];
    if (typeof entry.thumbnail === 'string' && entry.thumbnail.trim()) heroCandidates.push(entry.thumbnail.trim());
    if (typeof entry.image === 'string' && entry.image.trim()) heroCandidates.push(entry.image.trim());
    const localHero = heroCandidates.find((value) => isSitePath(value) && !isHttpUrl(value));
    if (localHero) {
      heroAssetChecks.push({ prefix, path: localHero });
      const htmlCandidates = deriveBlogHtmlCandidates(entry);
      heroHtmlChecks.push({ prefix, hero: localHero, htmlCandidates });
    }

    if (entry.content_url && !validateContentUrl(entry.content_url)) {
      warnings.push(`${prefix}.content_url should point to /blog/... or a full URL.`);
    }

    if (entry.url && !validateContentUrl(entry.url)) {
      warnings.push(`${prefix}.url should point to /blog/... or a full URL.`);
    }
  });
}

async function ensureBlogDirectory() {
  const rel = 'blog';
  const full = path.join(repoRoot, rel);
  try {
    const stat = await fs.stat(full);
    if (!stat.isDirectory()) {
      errors.push('blog must be a directory.');
      return;
    }
    const files = await fs.readdir(full);
    const htmlFiles = files.filter((f) => f.endsWith('.html'));
    if (!htmlFiles.length) {
      warnings.push('blog directory does not contain any HTML files yet.')
    }
  } catch (err) {
    errors.push('Missing blog directory. 033 writes dated HTML files there.');
  }
}

async function main() {
  await Promise.all([
    ensureHeaders(),
    ensureRedirects(),
    ensureBlogsJson(),
    ensureBlogDirectory()
  ]);

  await ensureHeroAssets();
  await ensureHeroInHtml();

  const uniqueErrors = [...new Set(errors)];
  const uniqueWarnings = [...new Set(warnings)];

  if (uniqueWarnings.length) {
    console.log('Warnings:');
    uniqueWarnings.forEach((msg) => console.log(`  • ${msg}`));
    console.log('');
  }

  if (uniqueErrors.length) {
    console.error('033 blog readiness check failed:');
    uniqueErrors.forEach((msg) => console.error(`  • ${msg}`));
    process.exitCode = 1;
  } else {
    console.log('033 blog readiness check passed. Front-end is ready for worker commits.');
  }
}

main().catch((err) => {
  console.error('Unexpected error running blog readiness check:');
  console.error(err);
  process.exitCode = 1;
});
