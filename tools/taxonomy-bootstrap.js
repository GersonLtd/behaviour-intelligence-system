#!/usr/bin/env node

/**
 * Taxonomy Bootstrap Tool
 *
 * Generates a draft taxonomy register from a sitemap.xml or list of URLs.
 * Infers page_type from URL path patterns and assigns default intent_weight
 * from PAGE_TYPE_WEIGHTS. Outputs CSV or JSON for review.
 *
 * Best results on hierarchical URL structures (e.g. /blog/seo-tips,
 * /services/consulting). Sites with flat URLs (e.g. /b2b-consulting-london)
 * will produce mostly "Unknown" page types — expect heavy manual review.
 *
 * Usage:
 *   node tools/taxonomy-bootstrap.js https://example.com/sitemap.xml
 *   node tools/taxonomy-bootstrap.js https://example.com/sitemap.xml --format=json
 *   node tools/taxonomy-bootstrap.js --urls urls.txt
 *   node tools/taxonomy-bootstrap.js --urls urls.txt --format=csv --output=taxonomy-draft.csv
 */

import { PAGE_TYPE_WEIGHTS } from '../src/config.js';
import { readFileSync } from 'node:fs';
import { writeFileSync } from 'node:fs';

// ─── URL pattern rules ─────────────────────────────────────────────────────
// Order matters: first match wins. More specific patterns go first.

const PATH_RULES = [
  // Exact matches
  { pattern: /^\/$/, pageType: 'homepage' },

  // Pricing / plans
  { pattern: /\/(pricing|plans|packages|rates)(\/|$)/i, pageType: 'pricing' },

  // Contact / booking
  { pattern: /\/(contact|get-in-touch|enquiry|enquire|reach-out)(\/|$)/i, pageType: 'contact' },
  { pattern: /\/(book|booking|schedule|appointment|demo|consultation)(\/|$)/i, pageType: 'booking' },

  // Case studies / proof
  { pattern: /\/(case-stud|customer-stor|success-stor|testimonial|review)/i, pageType: 'case_study' },

  // Blog / news / articles
  { pattern: /\/(blog|news|articles?|insights?|journal|posts?)(\/|$)/i, pageType: 'blog' },

  // Resources / downloads
  { pattern: /\/(resources?|downloads?|guides?|whitepapers?|ebooks?|webinars?|library)(\/|$)/i, pageType: 'resource' },

  // Services / solutions
  { pattern: /\/(services?|solutions?|consulting|advisory|offerings?|what-we-do)(\/|$)/i, pageType: 'service' },

  // Products
  { pattern: /\/(products?|features?|platform|tools?|apps?)(\/|$)/i, pageType: 'product' },

  // Confirmation / thank you
  { pattern: /\/(thank-?you|confirmation|confirmed|success)(\/|$)/i, pageType: 'confirmation' },

  // About / team (informational, not service)
  { pattern: /\/(about|team|careers?|jobs|company|who-we-are|our-story)(\/|$)/i, pageType: 'homepage' },
];

// ─── Topic inference ────────────────────────────────────────────────────────
// Extracts a topic guess from the URL path. This is necessarily fuzzy.

function inferTopic(urlPath, pageType) {
  const segments = urlPath.split('/').filter(Boolean);

  // Skip the first segment if it matches the page type category
  // e.g. /blog/seo-strategy → topic is "seo-strategy", not "blog"
  const categorySegments = [
    'blog', 'news', 'articles', 'insights', 'services', 'solutions',
    'products', 'features', 'case-studies', 'customers', 'resources',
    'downloads', 'guides', 'about', 'team',
  ];

  // Skip common locale prefixes (ISO 639-1 codes and regional variants)
  // e.g. /en/blog/seo-tips → skip "en", topic is "seo-tips"
  const localePattern = /^[a-z]{2}(-[a-z]{2})?$/;

  let topicSegment = null;
  for (const seg of segments) {
    const lower = seg.toLowerCase();
    if (localePattern.test(lower)) continue;
    if (!categorySegments.includes(lower)) {
      topicSegment = seg;
      break;
    }
  }

  if (!topicSegment) {
    // Single-segment URLs like /pricing, /contact
    if (segments.length === 1) return segments[0];
    return 'General';
  }

  // Clean up: replace hyphens/underscores with spaces, then re-slug
  return topicSegment
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// ─── Core classification ────────────────────────────────────────────────────

function classifyUrl(urlString) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    return null;
  }

  const path = parsed.pathname.replace(/\/+$/, '') || '/';

  // Match against rules
  let pageType = 'unknown';
  for (const rule of PATH_RULES) {
    if (rule.pattern.test(path)) {
      pageType = rule.pageType;
      break;
    }
  }

  const topic = inferTopic(path, pageType);
  const intentWeight = PAGE_TYPE_WEIGHTS[pageType] ?? PAGE_TYPE_WEIGHTS.unknown;

  return {
    url: urlString,
    path,
    page_type: pageType,
    page_topic: topic,
    intent_weight: intentWeight,
    needs_review: pageType === 'unknown',
  };
}

// ─── Sitemap fetching ───────────────────────────────────────────────────────

async function fetchSitemap(sitemapUrl) {
  const response = await fetch(sitemapUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch sitemap: ${response.status} ${response.statusText}`);
  }

  const xml = await response.text();

  // Simple XML parsing — extract <loc> tags. No dependency needed.
  const urls = [];
  const locRegex = /<loc>\s*(.*?)\s*<\/loc>/gi;
  let match;
  while ((match = locRegex.exec(xml)) !== null) {
    urls.push(match[1].trim());
  }

  // Check for sitemap index (contains <sitemap> tags with nested sitemaps)
  const sitemapRegex = /<sitemap>[\s\S]*?<loc>\s*(.*?)\s*<\/loc>[\s\S]*?<\/sitemap>/gi;
  const nestedSitemaps = [];
  let sitemapMatch;
  while ((sitemapMatch = sitemapRegex.exec(xml)) !== null) {
    nestedSitemaps.push(sitemapMatch[1].trim());
  }

  if (nestedSitemaps.length > 0 && urls.length === nestedSitemaps.length) {
    // This is a sitemap index — fetch each child sitemap
    console.error(`  Sitemap index detected with ${nestedSitemaps.length} child sitemaps`);
    const allUrls = [];
    for (const childUrl of nestedSitemaps) {
      console.error(`  Fetching ${childUrl}...`);
      const childUrls = await fetchSitemap(childUrl);
      allUrls.push(...childUrls);
    }
    return allUrls;
  }

  return urls;
}

function loadUrlsFromFile(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  return content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
}

// ─── Output formatting ─────────────────────────────────────────────────────

function csvEscape(value) {
  const str = String(value);
  return '"' + str.replace(/"/g, '""') + '"';
}

function toCsv(results) {
  const header = 'url,path,page_type,page_topic,intent_weight,needs_review';
  const rows = results.map(r =>
    `${csvEscape(r.url)},${csvEscape(r.path)},${csvEscape(r.page_type)},${csvEscape(r.page_topic)},${r.intent_weight},${r.needs_review}`
  );
  return [header, ...rows].join('\n');
}

function toJson(results) {
  return JSON.stringify(results, null, 2);
}

// ─── CLI ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help')) {
    console.log(`
Taxonomy Bootstrap Tool

Generates a draft taxonomy register from a sitemap or URL list.

Usage:
  node tools/taxonomy-bootstrap.js <sitemap-url>              Fetch sitemap and classify
  node tools/taxonomy-bootstrap.js --urls <file>              Classify URLs from a text file

Options:
  --format=csv|json    Output format (default: csv)
  --output=<file>      Write to file instead of stdout
  --help               Show this help

Examples:
  node tools/taxonomy-bootstrap.js https://example.com/sitemap.xml
  node tools/taxonomy-bootstrap.js https://example.com/sitemap.xml --format=json --output=taxonomy-draft.json
  node tools/taxonomy-bootstrap.js --urls urls.txt --output=taxonomy-draft.csv
`);
    process.exit(0);
  }

  // Parse options
  let format = 'csv';
  let outputFile = null;
  let urlsFile = null;
  let sitemapUrl = null;

  for (const arg of args) {
    if (arg.startsWith('--format=')) {
      format = arg.split('=')[1];
    } else if (arg.startsWith('--output=')) {
      outputFile = arg.split('=')[1];
    } else if (arg === '--urls') {
      // Next arg is the file
      const idx = args.indexOf(arg);
      urlsFile = args[idx + 1];
    } else if (arg.startsWith('http')) {
      sitemapUrl = arg;
    }
  }

  // Fetch URLs
  let urls;
  if (urlsFile) {
    console.error(`Loading URLs from ${urlsFile}...`);
    urls = loadUrlsFromFile(urlsFile);
  } else if (sitemapUrl) {
    console.error(`Fetching sitemap from ${sitemapUrl}...`);
    urls = await fetchSitemap(sitemapUrl);
  } else {
    console.error('Error: provide a sitemap URL or --urls <file>');
    process.exit(1);
  }

  console.error(`  Found ${urls.length} URLs`);

  // Classify
  const results = urls
    .map(classifyUrl)
    .filter(Boolean);

  // Sort: unknowns first (need review), then by page_type, then by path
  results.sort((a, b) => {
    if (a.needs_review !== b.needs_review) return a.needs_review ? -1 : 1;
    if (a.page_type !== b.page_type) return a.page_type.localeCompare(b.page_type);
    return a.path.localeCompare(b.path);
  });

  // Stats
  const total = results.length;
  const unknown = results.filter(r => r.needs_review).length;
  const coverage = total > 0 ? ((total - unknown) / total * 100).toFixed(1) : 0;

  console.error('');
  console.error(`  Results: ${total} URLs classified`);
  console.error(`  Auto-classified: ${total - unknown} (${coverage}%)`);
  console.error(`  Needs review: ${unknown}`);
  console.error('');

  const byType = {};
  for (const r of results) {
    byType[r.page_type] = (byType[r.page_type] || 0) + 1;
  }
  console.error('  Breakdown:');
  for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    console.error(`    ${type}: ${count}`);
  }
  const unknownCount = byType['unknown'] || 0;
  const unknownPercent = results.length > 0 ? Math.round((unknownCount / results.length) * 100) : 0;
  if (unknownPercent >= 40) {
    console.error(`  ⚠  ${unknownPercent}% of URLs classified as "unknown". This site likely`);
    console.error(`     uses flat URLs. Review the output and manually assign page types.`);
  }
  console.error('');

  // Output
  const output = format === 'json' ? toJson(results) : toCsv(results);

  if (outputFile) {
    writeFileSync(outputFile, output, 'utf-8');
    console.error(`  Written to ${outputFile}`);
  } else {
    console.log(output);
  }
}

main().catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
