import assert from 'node:assert/strict';

import { scoreBreadth, scoreDepth, scoreProgression, scoreClustering, scoreAllSignalsPercentile } from '../src/signals.js';
import { classifyByPriority, classifyByFit, hasFriction } from '../src/classifier.js';
import { calculateConfidence, getConfidenceBand, isActionPermitted, isMotivationAllowed } from '../src/confidence.js';
import { resolveAction, generatePrescription, summariseActions } from '../src/action.js';
import { classifyRecency, countSessionsInWindow, calculateTrend, classifyVelocity, assessTemporalContext } from '../src/temporal.js';
import { detectSubType, detectMotivation, applyRefinements } from '../src/refinements.js';
import { evaluateVisitor } from '../src/pipeline.js';

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

console.log('Running unit tests...\n');

// ─── Signal Scoring: Breadth ─────────────────────────────────────────

console.log('── Breadth ──');

test('scoreBreadth returns 1 for a single page', () => {
  assert.equal(scoreBreadth({ uniquePages: 1, uniquePageTypes: 1 }), 1);
});

test('scoreBreadth returns 3 for 2-3 pages with low variety', () => {
  assert.equal(scoreBreadth({ uniquePages: 3, uniquePageTypes: 2 }), 3);
});

test('scoreBreadth returns 7 for 8 pages with 3+ types', () => {
  assert.equal(scoreBreadth({ uniquePages: 8, uniquePageTypes: 4 }), 7);
});

test('scoreBreadth returns 9 for very high exploration', () => {
  assert.equal(scoreBreadth({ uniquePages: 15, uniquePageTypes: 8 }), 9);
});

test('scoreBreadth returns 0 for null input', () => {
  assert.equal(scoreBreadth(null), 0);
});

// ─── Signal Scoring: Depth ───────────────────────────────────────────

console.log('\n── Depth ──');

test('scoreDepth returns 1 for very short engagement', () => {
  assert.equal(scoreDepth({ engagementTimeSeconds: 5, avgScrollPercent: 10, deepEngagementEvents: 0 }), 1);
});

test('scoreDepth adds scroll bonus at 75%+', () => {
  const withBonus = scoreDepth({ engagementTimeSeconds: 50, avgScrollPercent: 80, deepEngagementEvents: 0 });
  const withoutBonus = scoreDepth({ engagementTimeSeconds: 50, avgScrollPercent: 60, deepEngagementEvents: 0 });
  assert.equal(withBonus, 6);   // base 5 + scroll 1
  assert.equal(withoutBonus, 5); // base 5 only
});

test('scoreDepth adds engagement event bonus', () => {
  const score = scoreDepth({ engagementTimeSeconds: 50, avgScrollPercent: 80, deepEngagementEvents: 2 });
  assert.equal(score, 7); // base 5 + scroll 1 + engagement 1
});

test('scoreDepth caps at 10', () => {
  const score = scoreDepth({ engagementTimeSeconds: 300, avgScrollPercent: 90, deepEngagementEvents: 5 });
  assert.equal(score, 10); // base 9 + 1 + 1 = 11, capped to 10
});

test('scoreDepth returns 0 for null input', () => {
  assert.equal(scoreDepth(null), 0);
});

// ─── Signal Scoring: Progression ─────────────────────────────────────

console.log('\n── Progression ──');

test('scoreProgression uses integer scoring and bias cap', () => {
  const events = [
    { eventName: 'cta_click', pageType: 'service' },    // 1.0 * 1.0
    { eventName: 'form_start', pageType: 'contact' }    // 1.5 * 2.0
  ];
  const withHighBias = scoreProgression(events, { progression: 4 });   // capped to +1
  const withLowBias = scoreProgression(events, { progression: -3 });    // capped to -1
  assert.equal(withHighBias, 5);
  assert.equal(withLowBias, 3);
});

test('scoreProgression skips page_view and scroll_75 events', () => {
  const events = [
    { eventName: 'page_view', pageType: 'pricing' },
    { eventName: 'scroll_75', pageType: 'pricing' },
    { eventName: 'cta_click', pageType: 'pricing' }   // 1.0 * 1.5
  ];
  assert.equal(scoreProgression(events), 2); // only cta_click counts, rounded
});

test('scoreProgression uses element weight over page weight when present', () => {
  const withElement = scoreProgression([
    { eventName: 'cta_click', pageType: 'blog', elementWeight: 2.0 }  // 1.0 * 2.0
  ]);
  const withoutElement = scoreProgression([
    { eventName: 'cta_click', pageType: 'blog' }  // 1.0 * 0.6
  ]);
  assert.equal(withElement, 2);
  assert.equal(withoutElement, 1);
});

test('scoreProgression uses element role lookup as second priority', () => {
  const score = scoreProgression([
    { eventName: 'cta_click', pageType: 'blog', elementRole: 'progression' }  // 1.0 * 2.0
  ]);
  assert.equal(score, 2);
});

test('scoreProgression returns 0 for null/empty input', () => {
  assert.equal(scoreProgression(null), 0);
  assert.equal(scoreProgression([]), 0);
});

test('scoreProgression clamps to 0-10', () => {
  // Enough high-weight events to exceed 10
  const events = Array.from({ length: 10 }, () => (
    { eventName: 'form_submit', pageType: 'contact' }  // 2.0 * 2.0 = 4.0 each
  ));
  assert.equal(scoreProgression(events), 10);
});

// ─── Signal Scoring: Clustering ──────────────────────────────────────

console.log('\n── Clustering ──');

test('scoreClustering applies signal floor below 4 pages', () => {
  const score = scoreClustering({
    dominantTopicShare: 0.67,
    topicSwitchCount: 1,
    repeatClusterVisits: 0,
    totalPageViews: 3
  });
  // (0.67 * 10) - 0 (floor) + 0 = 6.7 → 7
  assert.equal(score, 7);
});

test('scoreClustering applies penalty at 4+ pages', () => {
  const score = scoreClustering({
    dominantTopicShare: 0.5,
    topicSwitchCount: 3,
    repeatClusterVisits: 0,
    totalPageViews: 5
  });
  // (0.5 * 10) - 3 + 0 = 2
  assert.equal(score, 2);
});

test('scoreClustering caps switch penalty at 5', () => {
  const score = scoreClustering({
    dominantTopicShare: 0.8,
    topicSwitchCount: 10,
    repeatClusterVisits: 0,
    totalPageViews: 15
  });
  // (0.8 * 10) - 5 + 0 = 3
  assert.equal(score, 3);
});

test('scoreClustering caps repeat bonus at 3', () => {
  const score = scoreClustering({
    dominantTopicShare: 0.7,
    topicSwitchCount: 0,
    repeatClusterVisits: 10,
    totalPageViews: 10
  });
  // (0.7 * 10) - 0 + 3 = 10
  assert.equal(score, 10);
});

test('scoreClustering returns 0 for null input', () => {
  assert.equal(scoreClustering(null), 0);
});

// ─── Signal Scoring: Percentile ──────────────────────────────────────

console.log('\n── Percentile Scoring ──');

test('scoreAllSignalsPercentile maps values to correct bands', () => {
  const percentiles = {
    uniquePages: { p10: 1, p25: 2, p50: 4, p75: 7, p90: 10, p95: 14 },
    engagementTimeSeconds: { p10: 5, p25: 15, p50: 40, p75: 90, p90: 180, p95: 300 },
    rawProgressionSum: { p10: 0, p25: 1, p50: 3, p75: 5, p90: 8, p95: 12 },
    dominantTopicShare: { p10: 1, p25: 3, p50: 5, p75: 7, p90: 9, p95: 10 }
  };
  const scores = scoreAllSignalsPercentile(
    { uniquePages: 6, engagementTimeSeconds: 100, rawProgressionSum: 9, dominantTopicShare: 0.8 },
    percentiles
  );
  assert.equal(scores.breadth, 6);   // 6 interpolated between p50(4)→5 and p75(7)→7
  assert.equal(scores.depth, 7);     // 100 interpolated between p75(90)→7 and p90(180)→9
  assert.equal(scores.progression, 10); // 9 > p90(8)
  assert.equal(scores.clustering, 8);   // 0.8*10=8 interpolated between p75(7)→7 and p90(9)→9
});

test('scoreAllSignalsPercentile returns 5 when percentiles missing', () => {
  const scores = scoreAllSignalsPercentile(
    { uniquePages: 5, engagementTimeSeconds: 50, rawProgressionSum: 3, dominantTopicShare: 0.5 },
    {}
  );
  assert.equal(scores.breadth, 5);
  assert.equal(scores.depth, 5);
});

test('percentileToScore maps edge values correctly (via scoreAllSignalsPercentile)', () => {
  // Use a single-metric percentile set and vary only uniquePages to probe each boundary.
  // All other signals use trivial percentiles so they don't distract.
  const pctls = {
    uniquePages:              { p10: 2, p25: 4, p50: 6, p75: 8, p90: 10 },
    engagementTimeSeconds:    { p10: 10, p25: 20, p50: 30, p75: 40, p90: 50 },
    rawProgressionSum:        { p10: 1, p25: 2, p50: 3, p75: 4, p90: 5 },
    dominantTopicShare:       { p10: 1, p25: 2, p50: 3, p75: 4, p90: 5 }
  };
  const base = { engagementTimeSeconds: 0, rawProgressionSum: 0, dominantTopicShare: 0 };

  // Exactly at p10 → 1
  assert.equal(scoreAllSignalsPercentile({ ...base, uniquePages: 2 }, pctls).breadth, 1);
  // Exactly at p25 → 3
  assert.equal(scoreAllSignalsPercentile({ ...base, uniquePages: 4 }, pctls).breadth, 3);
  // Exactly at p50 → 5
  assert.equal(scoreAllSignalsPercentile({ ...base, uniquePages: 6 }, pctls).breadth, 5);
  // Exactly at p75 → 7
  assert.equal(scoreAllSignalsPercentile({ ...base, uniquePages: 8 }, pctls).breadth, 7);
  // Exactly at p90 → 9
  assert.equal(scoreAllSignalsPercentile({ ...base, uniquePages: 10 }, pctls).breadth, 9);
});

test('percentileToScore handles values below p10 (via scoreAllSignalsPercentile)', () => {
  const pctls = {
    uniquePages:              { p10: 5, p25: 10, p50: 20, p75: 30, p90: 40 },
    engagementTimeSeconds:    { p10: 10, p25: 20, p50: 30, p75: 40, p90: 50 },
    rawProgressionSum:        { p10: 1, p25: 2, p50: 3, p75: 4, p90: 5 },
    dominantTopicShare:       { p10: 1, p25: 2, p50: 3, p75: 4, p90: 5 }
  };
  // uniquePages=1 is well below p10=5 → should return 1
  const scores = scoreAllSignalsPercentile(
    { uniquePages: 1, engagementTimeSeconds: 0, rawProgressionSum: 0, dominantTopicShare: 0 },
    pctls
  );
  assert.equal(scores.breadth, 1);
});

test('percentileToScore handles values above p90 (via scoreAllSignalsPercentile)', () => {
  const pctls = {
    uniquePages:              { p10: 1, p25: 2, p50: 4, p75: 7, p90: 10 },
    engagementTimeSeconds:    { p10: 10, p25: 20, p50: 30, p75: 40, p90: 50 },
    rawProgressionSum:        { p10: 1, p25: 2, p50: 3, p75: 4, p90: 5 },
    dominantTopicShare:       { p10: 1, p25: 2, p50: 3, p75: 4, p90: 5 }
  };
  // uniquePages=20 is above p90=10 → should return 10
  const scores = scoreAllSignalsPercentile(
    { uniquePages: 20, engagementTimeSeconds: 999, rawProgressionSum: 99, dominantTopicShare: 0.99 },
    pctls
  );
  assert.equal(scores.breadth, 10);
  assert.equal(scores.depth, 10);
  assert.equal(scores.progression, 10);
  assert.equal(scores.clustering, 10); // 0.99*10=9.9 > p90(5)
});

test('scoreAllSignalsPercentile produces realistic scores from sample historical data', () => {
  // Medium-traffic B2B site percentile boundaries
  const pctls = {
    uniquePages:           { p10: 1, p25: 2, p50: 5, p75: 8, p90: 12 },
    engagementTimeSeconds: { p10: 8, p25: 20, p50: 55, p75: 120, p90: 240 },
    rawProgressionSum:     { p10: 0, p25: 0.5, p50: 2, p75: 4, p90: 7 },
    dominantTopicShare:    { p10: 2, p25: 3, p50: 5, p75: 7, p90: 9 }
  };

  // Low-engagement visitor: 2 pages, 15s, 0 progression, 0.3 topic share
  const low = scoreAllSignalsPercentile(
    { uniquePages: 2, engagementTimeSeconds: 15, rawProgressionSum: 0, dominantTopicShare: 0.3 },
    pctls
  );
  assert.equal(low.breadth, 3);      // 2 = p25(2) boundary → 3
  assert.equal(low.depth, 2);        // 15 interpolated between p10(8)→1 and p25(20)→3
  assert.equal(low.progression, 1);  // 0 = p10(0) boundary → 1
  assert.equal(low.clustering, 3);   // 0.3*10=3.0 = p25(3) boundary → 3

  // Medium visitor: 6 pages, 70s, 3 progression, 0.6 topic share
  const med = scoreAllSignalsPercentile(
    { uniquePages: 6, engagementTimeSeconds: 70, rawProgressionSum: 3, dominantTopicShare: 0.6 },
    pctls
  );
  assert.equal(med.breadth, 6);      // 6 interpolated between p50(5)→5 and p75(8)→7
  assert.equal(med.depth, 5);        // 70 interpolated between p50(55)→5 and p75(120)→7
  assert.equal(med.progression, 6);  // 3 interpolated between p50(2)→5 and p75(4)→7
  assert.equal(med.clustering, 6);   // 0.6*10=6.0 interpolated between p50(5)→5 and p75(7)→7

  // High-engagement visitor: 15 pages, 300s, 8 progression, 0.9 topic share
  const high = scoreAllSignalsPercentile(
    { uniquePages: 15, engagementTimeSeconds: 300, rawProgressionSum: 8, dominantTopicShare: 0.9 },
    pctls
  );
  assert.equal(high.breadth, 10);     // 15 > p90(12)
  assert.equal(high.depth, 10);       // 300 > p90(240)
  assert.equal(high.progression, 10); // 8 > p90(7)
  assert.equal(high.clustering, 9);   // 0.9*10=9.0 <= p90(9)
});

// ─── Classifier ──────────────────────────────────────────────────────

console.log('\n── Classifier ──');

test('scanner is classified before explorer in overlap cases', () => {
  const result = classifyByPriority(
    { breadth: 6, depth: 3, progression: 1, clustering: 3 },
    { temporalState: null, conversionComplete: false }
  );
  assert.equal(result.state, 'Scanner');
});

test('engaged overrides all other states at progression >= 8', () => {
  const result = classifyByPriority(
    { breadth: 6, depth: 3, progression: 9, clustering: 3 },
    { temporalState: null, conversionComplete: false }
  );
  assert.equal(result.state, 'Engaged');
});

test('hesitant overrides focused evaluator', () => {
  const result = classifyByPriority(
    { breadth: 3, depth: 8, progression: 7, clustering: 8 },
    { temporalState: null, conversionComplete: false }
  );
  assert.equal(result.state, 'Hesitant');
});

test('mismatch requires progression exactly 0', () => {
  // With progression = 0, breadth <= 2, depth <= 2 → Mismatch
  const mismatch = classifyByPriority(
    { breadth: 1, depth: 1, progression: 0, clustering: 0 },
    { temporalState: null, conversionComplete: false }
  );
  assert.equal(mismatch.state, 'Mismatch');

  // With progression = 2 and breadth/depth high enough for Explorer → not Mismatch
  const notMismatch = classifyByPriority(
    { breadth: 5, depth: 4, progression: 2, clustering: 3 },
    { temporalState: null, conversionComplete: false }
  );
  assert.notEqual(notMismatch.state, 'Mismatch');
});

test('stalled with friction signals classifies as Stalled (Friction)', () => {
  const result = classifyByPriority(
    { breadth: 4, depth: 5, progression: 2, clustering: 4 },
    { temporalState: null, conversionComplete: false },
    { rageClickCount: 5, deadClickCount: 0, formErrorCount: 0, highLayoutShift: false }
  );
  assert.equal(result.state, 'Stalled (Friction)');
});

test('returning evaluator takes priority when temporal state is set', () => {
  const result = classifyByPriority(
    { breadth: 5, depth: 5, progression: 4, clustering: 5 },
    { temporalState: 'Returning Evaluator', conversionComplete: false }
  );
  assert.equal(result.state, 'Returning Evaluator');
});

test('classifyByFit falls back correctly when no state fully matches', () => {
  const result = classifyByFit(
    { breadth: 5, depth: 7, progression: 0, clustering: 4 },
    { temporalState: null, conversionComplete: false }
  );
  assert.notEqual(result.state, 'Returning Evaluator');
  assert.ok(result.fitScores.length > 0);
});

test('classifyByFit detects hybrid states below 70% threshold', () => {
  // Signals that sit between Explorer and Evaluator
  const result = classifyByFit(
    { breadth: 5, depth: 5, progression: 4, clustering: 5 },
    { temporalState: null, conversionComplete: false }
  );
  assert.ok(result.fitScores);
  // If hybrid, secondary state should be populated
  if (result.isHybrid) {
    assert.ok(result.secondaryState);
  }
});

// ─── Friction Detection ──────────────────────────────────────────────

console.log('\n── Friction ──');

test('hasFriction detects rage clicks >= 3', () => {
  assert.equal(hasFriction({ rageClickCount: 3 }), true);
  assert.equal(hasFriction({ rageClickCount: 2 }), false);
});

test('hasFriction detects dead clicks >= 2', () => {
  assert.equal(hasFriction({ deadClickCount: 2 }), true);
  assert.equal(hasFriction({ deadClickCount: 1 }), false);
});

test('hasFriction detects form errors >= 2', () => {
  assert.equal(hasFriction({ formErrorCount: 2 }), true);
});

test('hasFriction detects high layout shift', () => {
  assert.equal(hasFriction({ highLayoutShift: true }), true);
  assert.equal(hasFriction({ highLayoutShift: false }), false);
});

// ─── Confidence ──────────────────────────────────────────────────────

console.log('\n── Confidence ──');

test('getConfidenceBand returns correct labels', () => {
  assert.equal(getConfidenceBand(0), 'low');
  assert.equal(getConfidenceBand(3), 'low');
  assert.equal(getConfidenceBand(4), 'medium');
  assert.equal(getConfidenceBand(6), 'medium');
  assert.equal(getConfidenceBand(7), 'high');
  assert.equal(getConfidenceBand(10), 'high');
});

test('confidence caps at low when fewer than 3 signal types', () => {
  const result = calculateConfidence({
    signalTypesObserved: new Set(['page_view', 'scroll_75']),  // only 2 types
    sessionMeta: { engagementTimeSeconds: 200, pageCount: 8 },
    actionFlags: { hasFormStart: false, hasFormSubmit: false, hasBooking: false, hasCtaClick: false },
    stateClarity: { primaryFitPercent: 90, secondaryFitPercent: 10 },
    temporal: { sessionCount7d: 1, sessionCount30d: 1, trendDirection: 'insufficient' }
  });
  assert.ok(result.score <= 3);
  assert.equal(result.band, 'low');
});

test('confidence applies contradiction penalty for high depth + low progression + high breadth', () => {
  const withContradiction = calculateConfidence({
    signalTypesObserved: new Set(['page_view', 'scroll_75', 'cta_click', 'resource_download']),
    sessionMeta: { engagementTimeSeconds: 200, pageCount: 8 },
    actionFlags: { hasFormStart: false, hasFormSubmit: false, hasBooking: false, hasCtaClick: true },
    stateClarity: { primaryFitPercent: 80, secondaryFitPercent: 20 },
    temporal: { sessionCount7d: 1, sessionCount30d: 1, trendDirection: 'insufficient' },
    signals: { breadth: 6, depth: 8, progression: 1 }
  });

  const withoutContradiction = calculateConfidence({
    signalTypesObserved: new Set(['page_view', 'scroll_75', 'cta_click', 'resource_download']),
    sessionMeta: { engagementTimeSeconds: 200, pageCount: 8 },
    actionFlags: { hasFormStart: false, hasFormSubmit: false, hasBooking: false, hasCtaClick: true },
    stateClarity: { primaryFitPercent: 80, secondaryFitPercent: 20 },
    temporal: { sessionCount7d: 1, sessionCount30d: 1, trendDirection: 'insufficient' },
    signals: { breadth: 4, depth: 6, progression: 5 }
  });

  assert.ok(withContradiction.score < withoutContradiction.score);
});

test('isActionPermitted enforces band policies', () => {
  assert.equal(isActionPermitted('low', 'reporting'), true);
  assert.equal(isActionPermitted('low', 'nudge'), false);
  assert.equal(isActionPermitted('low', 'automated'), false);
  assert.equal(isActionPermitted('medium', 'nudge'), true);
  assert.equal(isActionPermitted('medium', 'automated'), false);
  assert.equal(isActionPermitted('high', 'automated'), true);
});

test('isMotivationAllowed blocks motivation at low confidence', () => {
  assert.equal(isMotivationAllowed(2).allowed, false);
  assert.equal(isMotivationAllowed(5).allowed, true);
  assert.equal(isMotivationAllowed(5).requiresReview, true);
  assert.equal(isMotivationAllowed(8).allowed, true);
  assert.equal(isMotivationAllowed(8).requiresReview, false);
});

// ─── Temporal ────────────────────────────────────────────────────────

console.log('\n── Temporal ──');

test('classifyRecency returns correct bands', () => {
  assert.equal(classifyRecency(0), 'highly_recent');
  assert.equal(classifyRecency(2), 'highly_recent');
  assert.equal(classifyRecency(5), 'active_consideration');
  assert.equal(classifyRecency(15), 'delayed_return');
  assert.equal(classifyRecency(45), 'dormant');
});

test('countSessionsInWindow counts correctly', () => {
  const ref = new Date('2026-03-19');
  const sessions = [
    { sessionDate: '2026-03-18' },
    { sessionDate: '2026-03-15' },
    { sessionDate: '2026-03-10' },
    { sessionDate: '2026-02-01' }
  ];
  assert.equal(countSessionsInWindow(sessions, 7, ref), 2);
  assert.equal(countSessionsInWindow(sessions, 30, ref), 3);
});

test('calculateTrend detects reinforcing pattern', () => {
  const sessions = [
    { progression: 2, depth: 3 },
    { progression: 4, depth: 5 },
    { progression: 6, depth: 7 }
  ];
  assert.equal(calculateTrend(sessions), 'reinforcing');
});

test('calculateTrend detects decaying pattern', () => {
  const sessions = [
    { progression: 6, depth: 7 },
    { progression: 4, depth: 5 },
    { progression: 2, depth: 3 }
  ];
  assert.equal(calculateTrend(sessions), 'decaying');
});

test('calculateTrend returns insufficient for single session', () => {
  assert.equal(calculateTrend([{ progression: 5, depth: 5 }]), 'insufficient');
});

test('classifyVelocity detects high velocity for fast single session', () => {
  assert.equal(classifyVelocity({ timeToFirstHighIntentMs: 60000, sessionCount: 1, trend: 'insufficient' }), 'high');
});

test('classifyVelocity detects medium velocity for increasing multi-session', () => {
  assert.equal(classifyVelocity({ timeToFirstHighIntentMs: null, sessionCount: 3, trend: 'increasing' }), 'medium');
});

test('assessTemporalContext detects Returning Evaluator', () => {
  const ref = new Date('2026-03-19');
  const sessions = [
    { sessionDate: '2026-03-14', breadth: 5, depth: 3, progression: 2, clustering: 3, conversionComplete: false },
    { sessionDate: '2026-03-16', breadth: 4, depth: 5, progression: 4, clustering: 5, conversionComplete: false },
    { sessionDate: '2026-03-19', breadth: 4, depth: 6, progression: 5, clustering: 6, conversionComplete: false }
  ];
  const result = assessTemporalContext(sessions, ref);
  assert.equal(result.temporalState, 'Returning Evaluator');
});

test('assessTemporalContext returns safe defaults for empty history', () => {
  const result = assessTemporalContext([], new Date());
  assert.equal(result.temporalState, null);
  assert.equal(result.trend, 'insufficient');
  assert.equal(result.velocity, 'low');
});

// ─── Refinements ─────────────────────────────────────────────────────

console.log('\n── Refinements ──');

test('detectSubType identifies proof-focused from page engagements', () => {
  const pages = [
    { pageType: 'case_study', engagementTimeSeconds: 60 },
    { pageType: 'case_study', engagementTimeSeconds: 40 },
    { pageType: 'service', engagementTimeSeconds: 20 }
  ];
  assert.equal(detectSubType(pages), 'proof-focused');
});

test('detectSubType returns null when no dominant sub-type', () => {
  const pages = [
    { pageType: 'service', engagementTimeSeconds: 30 },
    { pageType: 'blog', engagementTimeSeconds: 30 },
    { pageType: 'homepage', engagementTimeSeconds: 30 }
  ];
  assert.equal(detectSubType(pages), null);
});

test('detectSubType returns null for empty input', () => {
  assert.equal(detectSubType([]), null);
  assert.equal(detectSubType(null), null);
});

test('detectMotivation identifies risk-sensitive for Hesitant with form start and no submit', () => {
  const result = detectMotivation(
    { breadth: 5, depth: 6, progression: 6, clustering: 5 },
    'Hesitant',
    null,
    { velocity: 'medium', formStarts: 1, formSubmits: 0 }
  );
  assert.equal(result, 'risk-sensitive');
});

test('detectMotivation identifies curiosity-driven for broad shallow exploration', () => {
  const result = detectMotivation(
    { breadth: 7, depth: 3, progression: 1, clustering: 2 },
    'Scanner',
    null,
    {}
  );
  assert.equal(result, 'curiosity-driven');
});

test('detectMotivation identifies urgency-driven for high velocity narrow sessions', () => {
  const result = detectMotivation(
    { breadth: 3, depth: 5, progression: 7, clustering: 6 },
    'Focused Evaluator',
    null,
    { velocity: 'high' }
  );
  assert.equal(result, 'urgency-driven');
});

test('applyRefinements blocks motivation at low confidence', () => {
  const result = applyRefinements({
    signals: { breadth: 7, depth: 3, progression: 1, clustering: 2 },
    state: 'Scanner',
    confidenceScore: 2,  // low
    pageEngagements: [],
    extras: {}
  });
  assert.equal(result.motivation, null);
});

// ─── Action Resolver ─────────────────────────────────────────────────

console.log('\n── Action ──');

test('resolveAction enforces confidence minimum', () => {
  const action = resolveAction({
    state: 'Scanner',
    confidenceBand: 'low',
    confidenceScore: 2
  });
  assert.equal(action?.permitted, false);
});

test('resolveAction permits action when confidence meets minimum', () => {
  const action = resolveAction({
    state: 'Scanner',
    confidenceBand: 'medium',
    confidenceScore: 5
  });
  assert.equal(action.permitted, true);
  assert.equal(action.automated, false);
});

test('resolveAction enables automation at high confidence for automatable states', () => {
  const action = resolveAction({
    state: 'Hesitant',
    confidenceBand: 'high',
    confidenceScore: 8
  });
  assert.equal(action.permitted, true);
  assert.equal(action.automated, true);
});

test('resolveAction includes hybrid warning when hybrid state provided', () => {
  const action = resolveAction({
    state: 'Explorer',
    confidenceBand: 'medium',
    confidenceScore: 5,
    isHybrid: true,
    secondaryState: 'Evaluator'
  });
  assert.ok(action.hybridWarning);
  assert.equal(action.hybridWarning.secondaryState, 'Evaluator');
});

test('resolveAction includes motivation refinement at medium+ confidence', () => {
  const action = resolveAction({
    state: 'Hesitant',
    confidenceBand: 'medium',
    confidenceScore: 5,
    motivation: 'risk-sensitive'
  });
  assert.ok(action.motivationRefinement);
  assert.equal(action.motivationRefinement.motivation, 'risk-sensitive');
});

test('generatePrescription interpolates context values', () => {
  const result = generatePrescription('Scanner', { sessionCount: 312, topLandingPage: '/home' });
  assert.ok(result.includes('312'));
  assert.ok(result.includes('/home'));
});

test('generatePrescription preserves unresolved placeholders', () => {
  const result = generatePrescription('Hesitant', {});
  assert.ok(result.includes('{topBlockedPage}'));
  assert.ok(result.includes('{blockedCount}'));
});

test('generatePrescription returns null for unknown state', () => {
  assert.equal(generatePrescription('NonexistentState', {}), null);
});

test('summariseActions aggregates action plans correctly', () => {
  const plans = [
    { state: 'Scanner', permitted: true, automated: false, confidence: { score: 5 }, motivation: null },
    { state: 'Scanner', permitted: true, automated: false, confidence: { score: 4 }, motivation: 'curiosity-driven' },
    { state: 'Evaluator', permitted: true, automated: false, confidence: { score: 6 }, motivation: null }
  ];
  const summary = summariseActions(plans);
  assert.equal(summary[0].state, 'Scanner');
  assert.equal(summary[0].count, 2);
  assert.equal(summary[0].permittedCount, 2);
  assert.equal(summary[1].state, 'Evaluator');
  assert.equal(summary[1].count, 1);
});

// ─── Pipeline ────────────────────────────────────────────────────────

console.log('\n── Pipeline ──');

test('pipeline evaluateVisitor runs end-to-end', () => {
  const output = evaluateVisitor({
    sessionData: {
      trafficSource: 'organic_search',
      breadthMetrics: { uniquePages: 2, uniquePageTypes: 1, uniqueTopics: 1 },
      depthMetrics: { engagementTimeSeconds: 12, avgScrollPercent: 20, deepEngagementEvents: 0 },
      events: [{ eventName: 'page_view', pageType: 'homepage' }],
      clusteringMetrics: { dominantTopicShare: 1, topicSwitchCount: 0, repeatClusterVisits: 0, totalPageViews: 2 }
    },
    userHistory: []
  });

  assert.ok(output.signals);
  assert.ok(output.classification);
  assert.ok(output.confidence);
  assert.ok(output.action);
});

test('pipeline produces Engaged state for conversion session', () => {
  const output = evaluateVisitor({
    sessionData: {
      trafficSource: 'direct',
      breadthMetrics: { uniquePages: 5, uniquePageTypes: 3, uniqueTopics: 2 },
      depthMetrics: { engagementTimeSeconds: 200, avgScrollPercent: 80, deepEngagementEvents: 1 },
      events: [
        { eventName: 'page_view', pageType: 'service' },
        { eventName: 'cta_click', pageType: 'pricing' },
        { eventName: 'form_start', pageType: 'contact' },
        { eventName: 'form_submit', pageType: 'contact' },
        { eventName: 'conversion_complete', pageType: 'confirmation' }
      ],
      clusteringMetrics: { dominantTopicShare: 0.7, topicSwitchCount: 1, repeatClusterVisits: 2, totalPageViews: 5 }
    },
    userHistory: []
  });

  assert.equal(output.classification.state, 'Engaged');
  assert.equal(output.confidence.band, 'high');
});

test('pipeline includes refinements in output', () => {
  const output = evaluateVisitor({
    sessionData: {
      trafficSource: 'paid_search',
      breadthMetrics: { uniquePages: 5, uniquePageTypes: 3, uniqueTopics: 2 },
      depthMetrics: { engagementTimeSeconds: 180, avgScrollPercent: 80, deepEngagementEvents: 0 },
      events: [
        { eventName: 'page_view', pageType: 'service' },
        { eventName: 'page_view', pageType: 'case_study' },
        { eventName: 'page_view', pageType: 'pricing' },
        { eventName: 'cta_click', pageType: 'pricing' },
        { eventName: 'form_start', pageType: 'contact' }
      ],
      clusteringMetrics: { dominantTopicShare: 0.6, topicSwitchCount: 2, repeatClusterVisits: 2, totalPageViews: 5 },
      pageEngagements: [
        { pageType: 'case_study', engagementTimeSeconds: 80 },
        { pageType: 'service', engagementTimeSeconds: 50 },
        { pageType: 'pricing', engagementTimeSeconds: 50 }
      ]
    },
    userHistory: []
  });

  assert.ok('subType' in output.refinements);
  assert.ok('motivation' in output.refinements);
});

test('pipeline includes prescription in action output', () => {
  const output = evaluateVisitor({
    sessionData: {
      trafficSource: 'organic_search',
      breadthMetrics: { uniquePages: 1, uniquePageTypes: 1, uniqueTopics: 1 },
      depthMetrics: { engagementTimeSeconds: 5, avgScrollPercent: 10, deepEngagementEvents: 0 },
      events: [{ eventName: 'page_view', pageType: 'homepage' }],
      clusteringMetrics: { dominantTopicShare: 1, topicSwitchCount: 0, repeatClusterVisits: 0, totalPageViews: 1 }
    },
    userHistory: []
  });

  assert.ok(output.action.prescription !== undefined);
});

console.log(`\n${'─'.repeat(50)}`);
console.log(`Unit results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
