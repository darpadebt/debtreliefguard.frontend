// sitemap-generator.js
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';

const SITE_URL = 'https://debtreliefguard.com';
const OUTPUT_FILE = path.resolve('./public/sitemap.xml');

const staticRoutes = [
  '/',
  '/faq/',
  '/terms/',
  '/contact/',
  '/privacy-policy/',
  '/scam-warning/',
  '/compare-us.html',
  '/how-it-works/',
  '/debt-relief-options/',
  '/credit-card-relief/',
  '/geo-blocked.html',
  '/savings-calculator.html',
  '/blog/'
];

// Load blog slugs from folder or API
async function getBlogSlugs() {
  const res = await fetch(`${SITE_URL}/api/blog-feed`);
  const posts = await res.json();
  return posts.map(post => `/blog/${post.slug}/`);
}

function generateSitemap(urls) {
  const now = new Date().toISOString().split('T')[0];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="https://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    url => `<url>
  <loc>${SITE_URL}${url}</loc>
  <lastmod>${now}</lastmod>
  <priority>${url === '/' ? '1.0' : '0.8'}</priority>
</url>`
  )
  .join('\n')}
</urlset>`;
}

async function buildSitemap() {
  const blogRoutes = await getBlogSlugs();
  const allRoutes = [...staticRoutes, ...blogRoutes];
  const xml = generateSitemap(allRoutes);
  fs.writeFileSync(OUTPUT_FILE, xml);
  console.log('✅ Sitemap generated.');

  // Optional: Ping search engines
  const sitemapURL = `${SITE_URL}/sitemap.xml`;
  try {
    await fetch(`https://www.google.com/ping?sitemap=${sitemapURL}`);
    await fetch(`https://www.bing.com/ping?sitemap=${sitemapURL}`);
    console.log('📡 Sitemap pinged to Google & Bing.');
  } catch (err) {
    console.warn('⚠️ Failed to ping search engines:', err.message);
  }
}

buildSitemap();
