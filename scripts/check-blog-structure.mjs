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
