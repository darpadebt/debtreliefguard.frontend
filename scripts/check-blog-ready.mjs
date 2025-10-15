#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';
import process from 'process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

const problems = [];
const notices = [];

async function ensureExists(relPath, kind = 'file') {
  const abs = path.join(root, relPath);
  try {
    const stat = await fs.stat(abs);
    if (kind === 'file' && !stat.isFile()) {
      problems.push(`Expected ${relPath} to be a file.`);
    }
    if (kind === 'dir' && !stat.isDirectory()) {
      problems.push(`Expected ${relPath} to be a directory.`);
    }
  } catch (err) {
    problems.push(`Missing required ${kind} at ${relPath}.`);
  }
}

async function checkBlogsJson() {
  const rel = 'blogs.json';
  const abs = path.join(root, rel);
  try {
    const raw = await fs.readFile(abs, 'utf8');
    let data;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      problems.push(`${rel} is not valid JSON: ${(err && err.message) || err}`);
      return;
    }
    if (!Array.isArray(data)) {
      problems.push(`${rel} must contain an array of blog entries.`);
      return;
    }
    const requiredKeys = ['slug', 'title'];
    data.forEach((entry, idx) => {
      if (!entry || typeof entry !== 'object') {
        problems.push(`${rel}[${idx}] is not an object.`);
        return;
      }
      requiredKeys.forEach((key) => {
        if (!entry[key] || typeof entry[key] !== 'string') {
          problems.push(`${rel}[${idx}] is missing required string field "${key}".`);
        }
      });
      const hasDate = typeof entry.date_published === 'string' || typeof entry.published_at === 'string';
      if (!hasDate) {
        notices.push(`${rel}[${idx}] is missing a publish date; worker will default to now.`);
      }
      const hasLink = ['canonical_url', 'url', 'content_url'].some((key) => typeof entry[key] === 'string' && entry[key].trim());
      if (!hasLink) {
        problems.push(`${rel}[${idx}] is missing canonical/url/content_url so slug routing may fail.`);
      }
    });
  } catch (err) {
    problems.push(`Unable to read ${rel}: ${(err && err.message) || err}`);
  }
}

async function checkFileContains(rel, needles) {
  const abs = path.join(root, rel);
  try {
    const raw = await fs.readFile(abs, 'utf8');
    needles.forEach((needle) => {
      if (!raw.includes(needle)) {
        problems.push(`${rel} should include "${needle}".`);
      }
    });
  } catch (err) {
    problems.push(`Unable to read ${rel}: ${(err && err.message) || err}`);
  }
}

(async () => {
  await ensureExists('blog', 'dir');
  await ensureExists('images', 'dir');
  await ensureExists('blog.index.html', 'file');
  await ensureExists('blog.slug.index.html', 'file');
  await ensureExists('_headers', 'file');
  await ensureExists('_redirects', 'file');
  await checkBlogsJson();
  await checkFileContains('_headers', ['/blogs.json', '/blog/*']);
  await checkFileContains('_redirects', ['/blog/:slug', '/blog/:year-:month-:day-:rest.html']);

  if (problems.length) {
    console.error('✖ Blog repo readiness check failed:\n');
    problems.forEach((msg) => {
      console.error(`  - ${msg}`);
    });
    if (notices.length) {
      console.error('\nNotices:');
      notices.forEach((msg) => console.error(`  * ${msg}`));
    }
    process.exit(1);
  }

  console.log('✓ Blog repo structure looks ready for 033 worker commits.');
  if (notices.length) {
    console.log('\nNotices:');
    notices.forEach((msg) => console.log(`  * ${msg}`));
  }
})();
