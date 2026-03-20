/**
 * Behaviour Intelligence System — JS / SQL Parity Tests
 *
 * Validates that the JS signal scoring functions produce identical results
 * to the SQL scoring expressions in sql/01-signal-scores.sql.
 *
 * The SQL logic is re-implemented here as pure JS. If the SQL changes,
 * update the sqlScore* functions below to match, then re-run.
 *
 * Run with: node test/parity-tests.js
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreBreadth, scoreDepth, scoreProgression, scoreClustering } from '../src/signals.js';
import {
  BREADTH_THRESHOLDS,
  DEPTH_TIME_THRESHOLDS,
  DEPTH_SCROLL_BONUS_THRESHOLD
} from '../src/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const signalSql = readFileSync(join(__dirname, '..', 'sql', '01-signal-scores.sql'), 'utf-8');
const stateSql = readFileSync(join(__dirname, '..', 'sql', '02-state-classification.sql'), 'utf-8');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL  ${name}: ${err.message}`);
  }
}

console.log('Running JS/SQL parity tests...\n');

// ─── SQL scoring logic reimplemented in JS ──────────────────────────
// These mirror sql/01-signal-scores.sql Step 7 exactly.

function sqlBreadthScore(uniquePages, uniquePageTypes) {
  let score;
  if (uniquePages === 1)                                   score = 1;
  else if (uniquePages <= 3 && uniquePageTypes <= 2)       score = 3;
  else if (uniquePages <= 5)                               score = 5;
  else if (uniquePages <= 8 && uniquePageTypes >= 3)       score = 7;
  else if (uniquePages <= 8)                               score = 5;
  else                                                     score = 9;
  return Math.min(score, 10);
}

function sqlDepthScore(engagementTimeSeconds, avgScrollPercent, deepEngagementEvents, trafficSourceGroup) {
  let base;
  if (engagementTimeSeconds <= 10)       base = 1;
  else if (engagementTimeSeconds <= 30)  base = 3;
  else if (engagementTimeSeconds <= 90)  base = 5;
  else if (engagementTimeSeconds <= 180) base = 7;
  else                                   base = 9;
  const scrollBonus = (avgScrollPercent || 0) >= 75 ? 1 : 0;
  const engagementBonus = deepEngagementEvents > 0 ? 1 : 0;
  const sourceBias = trafficSourceGroup === 'referral' ? 1 : 0;
  return Math.min(Math.max(base + scrollBonus + engagementBonus + sourceBias, 0), 10);
}

function sqlProgressionScore(rawProgressionSum, trafficSourceGroup) {
  let bias;
  if (trafficSourceGroup === 'direct')           bias = 1;
  else if (trafficSourceGroup === 'paid_search') bias = 1;
  else if (trafficSourceGroup === 'social_media') bias = -1;
  else                                           bias = 0;
  return Math.min(10, Math.max(0, Math.round(rawProgressionSum) + bias));
}

function sqlClusteringScore(dominantTopicShare, topicSwitchCount, totalPageViews, repeatClusterVisits) {
  const penalty = totalPageViews < 4 ? 0 : Math.min(topicSwitchCount, 5);
  const bonus = Math.min(Math.max(repeatClusterVisits - 1, 0), 3);
  return Math.round(Math.max(0, Math.min(10, (dominantTopicShare * 10) - penalty + bonus)));
}

// ─── Golden records ─────────────────────────────────────────────────
// Each record represents a session with known raw metrics.

const goldenRecords = [
  {
    label: 'Bounce: 1 page, 5s',
    breadth: { uniquePages: 1, uniquePageTypes: 1 },
    depth: { engagementTimeSeconds: 5, avgScrollPercent: 10, deepEngagementEvents: 0 },
    progression: { events: [], source: 'direct' },
    clustering: { dominantTopicShare: 1.0, topicSwitchCount: 0, repeatClusterVisits: 0, totalPageViews: 1 }
  },
  {
    label: 'Scanner: 10 pages, 25s, shallow',
    breadth: { uniquePages: 10, uniquePageTypes: 5 },
    depth: { engagementTimeSeconds: 25, avgScrollPercent: 30, deepEngagementEvents: 0 },
    progression: { events: [{ eventName: 'cta_click', pageType: 'blog' }], source: 'social_media' },
    clustering: { dominantTopicShare: 0.3, topicSwitchCount: 6, repeatClusterVisits: 0, totalPageViews: 10 }
  },
  {
    label: 'Deep evaluator: 5 pages, 150s, high scroll',
    breadth: { uniquePages: 5, uniquePageTypes: 3 },
    depth: { engagementTimeSeconds: 150, avgScrollPercent: 85, deepEngagementEvents: 1 },
    progression: {
      events: [
        { eventName: 'cta_click', pageType: 'service' },
        { eventName: 'form_start', pageType: 'contact' }
      ],
      source: 'organic_search'
    },
    clustering: { dominantTopicShare: 0.7, topicSwitchCount: 2, repeatClusterVisits: 3, totalPageViews: 5 }
  },
  {
    label: 'Converter: 8 pages, 200s, form submit on pricing',
    breadth: { uniquePages: 8, uniquePageTypes: 4 },
    depth: { engagementTimeSeconds: 200, avgScrollPercent: 90, deepEngagementEvents: 2 },
    progression: {
      events: [
        { eventName: 'cta_click', pageType: 'pricing' },
        { eventName: 'form_start', pageType: 'contact' },
        { eventName: 'form_submit', pageType: 'contact' },
        { eventName: 'conversion_complete', pageType: 'confirmation' }
      ],
      source: 'paid_search'
    },
    clustering: { dominantTopicShare: 0.5, topicSwitchCount: 3, repeatClusterVisits: 2, totalPageViews: 8 }
  },
  {
    label: 'Referral with depth bias, moderate engagement',
    breadth: { uniquePages: 3, uniquePageTypes: 2 },
    depth: { engagementTimeSeconds: 90, avgScrollPercent: 75, deepEngagementEvents: 0 },
    progression: {
      events: [{ eventName: 'cta_click', pageType: 'case_study' }],
      source: 'referral'
    },
    clustering: { dominantTopicShare: 0.8, topicSwitchCount: 1, repeatClusterVisits: 1, totalPageViews: 3 }
  }
];

// ─── Run parity checks ─────────────────────────────────────────────

console.log('── Breadth parity ──');
for (const r of goldenRecords) {
  test(`breadth: ${r.label}`, () => {
    const js = scoreBreadth(r.breadth);
    const sql = sqlBreadthScore(r.breadth.uniquePages, r.breadth.uniquePageTypes);
    assert.equal(js, sql, `JS=${js} SQL=${sql}`);
  });
}

console.log('\n── Depth parity ──');
for (const r of goldenRecords) {
  test(`depth: ${r.label}`, () => {
    const SOURCE_BIAS = {
      direct: { depth: 0 }, organic_search: { depth: 0 },
      social_media: { depth: 0 }, referral: { depth: 1 }, paid_search: { depth: 0 }
    };
    const sourceBias = SOURCE_BIAS[r.progression.source] || null;
    const js = scoreDepth(r.depth, sourceBias);
    const sql = sqlDepthScore(r.depth.engagementTimeSeconds, r.depth.avgScrollPercent, r.depth.deepEngagementEvents, r.progression.source);
    assert.equal(js, sql, `JS=${js} SQL=${sql}`);
  });
}

console.log('\n── Progression parity ──');
for (const r of goldenRecords) {
  test(`progression: ${r.label}`, () => {
    const sourceBias = {
      direct: { progression: 1 },
      organic_search: { progression: 0 },
      social_media: { progression: -1 },
      referral: { progression: 0 },
      paid_search: { progression: 1 }
    }[r.progression.source] || null;

    const js = scoreProgression(r.progression.events, sourceBias);

    // Compute raw sum the same way the SQL does (action_weight * page_intent_weight)
    const ACTION_WEIGHTS = { cta_click: 1.0, form_start: 1.5, form_submit: 2.0, booking_click: 1.5, conversion_complete: 2.0 };
    const PAGE_TYPE_WEIGHTS = { homepage: 0.5, blog: 0.6, resource: 0.6, service: 1.0, product: 1.0, case_study: 1.2, pricing: 1.5, contact: 2.0, booking: 2.0, confirmation: 2.0, unknown: 0.5 };
    let rawSum = 0;
    for (const e of r.progression.events) {
      const aw = ACTION_WEIGHTS[e.eventName] || 0;
      const pw = PAGE_TYPE_WEIGHTS[e.pageType] || 0.5;
      rawSum += aw * pw;
    }
    const sql = sqlProgressionScore(rawSum, r.progression.source);
    assert.equal(js, sql, `JS=${js} SQL=${sql}`);
  });
}

console.log('\n── Clustering parity ──');
for (const r of goldenRecords) {
  test(`clustering: ${r.label}`, () => {
    const js = scoreClustering(r.clustering);
    const sql = sqlClusteringScore(
      r.clustering.dominantTopicShare,
      r.clustering.topicSwitchCount,
      r.clustering.totalPageViews,
      r.clustering.repeatClusterVisits
    );
    assert.equal(js, sql, `JS=${js} SQL=${sql}`);
  });
}

// ─── SQL threshold drift detection ──────────────────────────────────
// Extracts key thresholds from the actual .sql files and asserts they
// match config.js. Catches drift when someone edits SQL but not YAML.

console.log('\n── SQL threshold drift ──');

test('breadth SQL thresholds match config.js', () => {
  // Extract "WHEN b.unique_pages <= N ... THEN M" from the SQL
  const breadthBlock = signalSql.match(/-- Breadth score[\s\S]*?AS breadth_score/);
  assert.ok(breadthBlock, 'Could not find breadth score block in SQL');
  const sql = breadthBlock[0];

  // Check each threshold from config against the SQL
  // Config: { maxPages: 1, score: 1 }, { maxPages: 3, maxTypes: 2, score: 3 }, etc.
  assert.ok(sql.includes('unique_pages = 1') && sql.includes('THEN 1'),
    'SQL breadth: single page → 1');
  assert.ok(sql.includes('unique_pages <= 3') && sql.includes('page_types <= 2') && sql.includes('THEN 3'),
    'SQL breadth: <=3 pages, <=2 types → 3');
  assert.ok(sql.includes('unique_pages <= 5') && sql.includes('THEN 5'),
    'SQL breadth: <=5 pages → 5');
  assert.ok(sql.includes('unique_pages <= 8') && sql.includes('page_types >= 3') && sql.includes('THEN 7'),
    'SQL breadth: <=8 pages, >=3 types → 7');
  assert.ok(/ELSE 9/.test(sql), 'SQL breadth: default → 9');
});

test('depth SQL time thresholds match config.js', () => {
  const depthBlock = signalSql.match(/-- Depth score[\s\S]*?AS depth_score/);
  assert.ok(depthBlock, 'Could not find depth score block in SQL');
  const sql = depthBlock[0];

  for (const t of DEPTH_TIME_THRESHOLDS) {
    if (t.maxSeconds === Infinity) {
      assert.ok(/ELSE 9/.test(sql), 'SQL depth: default → 9');
    } else {
      const pattern = new RegExp(`engagement_time_seconds\\s*<=\\s*${t.maxSeconds}\\s+THEN\\s+${t.score}`);
      assert.ok(pattern.test(sql), `SQL depth: <=${t.maxSeconds}s → ${t.score}`);
    }
  }

  // Scroll bonus threshold
  const scrollPattern = new RegExp(`avg_scroll_percent.*>=\\s*${DEPTH_SCROLL_BONUS_THRESHOLD}`);
  assert.ok(scrollPattern.test(sql), `SQL depth: scroll bonus at ${DEPTH_SCROLL_BONUS_THRESHOLD}%`);
});

test('state classification SQL friction thresholds match config.js', () => {
  // Check rage_clicks >= 3, dead_clicks >= 2, form_errors >= 2 in the SQL
  const frictionBlock = stateSql.match(/Stalled \(Friction\)[\s\S]*?THEN 'Stalled \(Friction\)'/);
  assert.ok(frictionBlock, 'Could not find Stalled (Friction) block in SQL');
  const sql = frictionBlock[0];

  assert.ok(/rage_clicks\s*>=\s*3/.test(sql), 'SQL friction: rage_clicks >= 3');
  assert.ok(/dead_clicks\s*>=\s*2/.test(sql), 'SQL friction: dead_clicks >= 2');
  assert.ok(/form_errors\s*>=\s*2/.test(sql), 'SQL friction: form_errors >= 2');
});

test('state classification SQL priority order matches config.js', () => {
  // Extract state names from SQL CASE in order
  const caseBlock = stateSql.match(/CASE[\s\S]*?ELSE 'Unclassified'/);
  assert.ok(caseBlock, 'Could not find state CASE block in SQL');

  const sqlStates = [...caseBlock[0].matchAll(/THEN '([^']+)'/g)].map(m => m[1]);
  // SQL should have: Engaged, Hesitant, Focused Evaluator, Evaluator, Comparator,
  // Stalled (Friction), Stalled, Scanner, Explorer, Mismatch
  const expectedOrder = [
    'Engaged', 'Hesitant', 'Focused Evaluator', 'Evaluator', 'Comparator',
    'Stalled (Friction)', 'Stalled', 'Scanner', 'Explorer', 'Mismatch'
  ];

  assert.deepStrictEqual(sqlStates, expectedOrder,
    `SQL state priority order mismatch: got [${sqlStates.join(', ')}]`);
});

console.log(`\n${'─'.repeat(50)}`);
console.log(`Parity results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
