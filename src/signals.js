/**
 * Behaviour Intelligence System — Signal Scoring Engine
 *
 * Calculates the four core signal scores (0–10) from raw session metrics.
 * Each scoring function is independent and testable in isolation.
 *
 * Supports two calibration modes:
 *   - Fixed-rule scoring (default, for early-stage / low data)
 *   - Percentile-based scoring (when historical data is available)
 */

import {
  BREADTH_THRESHOLDS,
  DEPTH_TIME_THRESHOLDS,
  DEPTH_SCROLL_BONUS_THRESHOLD,
  CLUSTERING_CONFIG,
  ACTION_WEIGHTS,
  PAGE_TYPE_WEIGHTS,
  ELEMENT_ROLE_WEIGHTS,
  SOURCE_BIAS
} from './config.js';

// ─── Breadth Score ──────────────────────────────────────────────────

/**
 * Calculate breadth score (0–10) from exploration metrics.
 *
 * @param {Object} metrics
 * @param {number} metrics.uniquePages      - Distinct page URLs viewed
 * @param {number} metrics.uniquePageTypes   - Distinct page types viewed
 * @returns {number} Score 0–10
 */
export function scoreBreadth(metrics) {
  if (!metrics) return 0;
  const { uniquePages = 0, uniquePageTypes = 0 } = metrics;

  // Walk thresholds in order; return first match
  for (const t of BREADTH_THRESHOLDS) {
    const pagesMatch = uniquePages <= (t.maxPages || Infinity);
    const typesMax = t.maxTypes !== undefined ? uniquePageTypes <= t.maxTypes : true;
    const typesMin = t.minTypes !== undefined ? uniquePageTypes >= t.minTypes : true;

    if (pagesMatch && typesMax && typesMin) {
      return Math.min(t.score, 10);
    }
  }

  // Fallback for very high exploration
  return 9;
}

// ─── Depth Score ────────────────────────────────────────────────────

/**
 * Calculate depth score (0–10) from engagement metrics.
 *
 * Base score from engagement time + bonus for deep scroll + bonus for
 * high-attention events (downloads, video plays).
 *
 * @param {Object} metrics
 * @param {number} metrics.engagementTimeSeconds - Total active engagement time
 * @param {number} metrics.avgScrollPercent      - Average scroll depth (0–100)
 * @param {number} metrics.deepEngagementEvents  - Count of downloads, video plays, etc.
 * @param {Object} [sourceBias]          - Optional source bias adjustments
 * @param {number} [sourceBias.depth]    - Bias to add (e.g. +1 for referral)
 * @returns {number} Score 0–10
 */
export function scoreDepth(metrics, sourceBias = null) {
  if (!metrics) return 0;
  const { engagementTimeSeconds = 0, avgScrollPercent = 0, deepEngagementEvents = 0 } = metrics;

  // Base score from engagement time
  let base = 1;
  for (const t of DEPTH_TIME_THRESHOLDS) {
    if (engagementTimeSeconds <= t.maxSeconds) {
      base = t.score;
      break;
    }
  }

  // Scroll bonus: +1 if average scroll ≥ threshold
  const scrollBonus = (avgScrollPercent || 0) >= DEPTH_SCROLL_BONUS_THRESHOLD ? 1 : 0;

  // Deep engagement bonus: +1 if any high-attention events occurred
  const engagementBonus = (deepEngagementEvents || 0) > 0 ? 1 : 0;

  // Apply source bias if provided (bounded ±1, matching progression bias approach)
  let depthBias = 0;
  if (sourceBias && Number.isFinite(sourceBias.depth)) {
    depthBias = Math.max(-1, Math.min(1, sourceBias.depth));
  }

  return Math.min(Math.max(base + scrollBonus + engagementBonus + depthBias, 0), 10);
}

// ─── Progression Score ──────────────────────────────────────────────

/**
 * Calculate progression score (0–10) from intent-indicating actions.
 *
 * Each action is weighted by: action_strength × effective_weight.
 * Effective weight priority: elementWeight > ELEMENT_ROLE_WEIGHTS[elementRole] > pageWeight.
 * Page views and scrolls are excluded — they contribute to breadth/depth only.
 *
 * @param {Array<Object>} events - Array of event objects, each with:
 *   @param {string} events[].eventName    - e.g. 'cta_click', 'form_start'
 *   @param {string} events[].pageType     - e.g. 'pricing', 'service'
 *   @param {number} [events[].elementWeight] - Explicit element weight override (0.3–2.0)
 *   @param {string} [events[].elementRole]   - Element role for lookup (e.g. 'progression', 'depth')
 * @param {Object} [sourceBias]          - Optional source bias adjustments
 * @param {number} [sourceBias.progression] - Bias to add (e.g. +1 for direct)
 * @returns {number} Score 0–10
 */
export function scoreProgression(events, sourceBias = null) {
  if (!events || !Array.isArray(events)) return 0;
  let rawSum = 0;

  for (const event of events) {
    const actionWeight = ACTION_WEIGHTS[event.eventName] || 0;

    // Skip events that don't contribute to progression
    if (event.eventName === 'page_view' || event.eventName === 'scroll_75') {
      continue;
    }

    // Element weight overrides page weight when present (CMS-first element-level intelligence).
    // Priority: explicit element_weight > role-based lookup > page intent weight.
    const pageWeight = PAGE_TYPE_WEIGHTS[event.pageType] || PAGE_TYPE_WEIGHTS.unknown;
    let effectiveWeight;
    if (typeof event.elementWeight === 'number' && isFinite(event.elementWeight)) {
      effectiveWeight = event.elementWeight;
    } else if (event.elementRole && ELEMENT_ROLE_WEIGHTS[event.elementRole]) {
      effectiveWeight = ELEMENT_ROLE_WEIGHTS[event.elementRole];
    } else {
      effectiveWeight = pageWeight;
    }
    rawSum += actionWeight * effectiveWeight;
  }

  // Apply source bias if provided
  if (sourceBias && Number.isFinite(sourceBias.progression)) {
    // Keep source bias as a bounded prior so behaviour remains primary.
    const boundedBias = Math.max(-1, Math.min(1, sourceBias.progression));
    rawSum += boundedBias;
  }

  // Clamp to 0–10
  return Math.min(Math.max(Math.round(rawSum), 0), 10);
}

// ─── Clustering Score ───────────────────────────────────────────────

/**
 * Calculate clustering score (0–10) from topic coherence metrics.
 *
 * Formula: (dominantTopicShare × 10) - switchPenalty + repeatBonus
 *
 * Applies minimum signal floor: no switch penalty below 4 page views.
 *
 * @param {Object} metrics
 * @param {number} metrics.dominantTopicShare    - Proportion in top cluster (0–1)
 * @param {number} metrics.topicSwitchCount      - Times visitor switched topics
 * @param {number} metrics.repeatClusterVisits   - Returns to dominant cluster
 * @param {number} metrics.totalPageViews        - Total pages viewed in session
 * @returns {number} Score 0–10 (clamped)
 */
export function scoreClustering(metrics) {
  if (!metrics) return 0;
  const {
    dominantTopicShare = 0,
    topicSwitchCount = 0,
    repeatClusterVisits = 0,
    totalPageViews
  } = metrics;

  // Base: concentration score
  const concentrationScore = (dominantTopicShare || 0) * 10;

  // Penalty: topic switching (capped, with signal floor)
  const penaltyApplies = totalPageViews >= CLUSTERING_CONFIG.minPagesForPenalty;
  const switchPenalty = penaltyApplies
    ? Math.min(topicSwitchCount || 0, CLUSTERING_CONFIG.switchPenaltyCap)
    : 0;

  // Bonus: repeat cluster returns (capped)
  const repeatBonus = Math.min(
    Math.max((repeatClusterVisits || 0) - 1, 0),
    CLUSTERING_CONFIG.repeatBonusCap
  );

  const raw = concentrationScore - switchPenalty + repeatBonus;

  // Clamp to 0–10 (integer, consistent with all other signal scores)
  return Math.min(Math.max(Math.round(raw), 0), 10);
}

// ─── Convenience: Score All Signals ─────────────────────────────────

/**
 * Calculate all four core signal scores from a session's raw data.
 *
 * @param {Object} sessionData
 * @param {Object} sessionData.breadthMetrics   - { uniquePages, uniquePageTypes, uniqueTopics }
 * @param {Object} sessionData.depthMetrics     - { engagementTimeSeconds, avgScrollPercent, deepEngagementEvents }
 * @param {Array}  sessionData.events           - Array of { eventName, pageType }
 * @param {Object} sessionData.clusteringMetrics - { dominantTopicShare, topicSwitchCount, repeatClusterVisits, totalPageViews }
 * @param {string} [sessionData.trafficSource]  - e.g. 'direct', 'organic_search'
 * @returns {Object} { breadth, depth, progression, clustering }
 */
export function scoreAllSignals(sessionData) {
  const { breadthMetrics, depthMetrics, events, clusteringMetrics, trafficSource } = sessionData;

  // Resolve source bias
  const sourceBias = trafficSource
    ? SOURCE_BIAS[trafficSource] || null
    : null;

  return {
    breadth:     scoreBreadth(breadthMetrics),
    depth:       scoreDepth(depthMetrics, sourceBias),
    progression: scoreProgression(events, sourceBias),
    clustering:  scoreClustering(clusteringMetrics)
  };
}

// ─── Percentile-Based Scoring ───────────────────────────────────────

/**
 * Score all signals using percentile-based normalisation.
 *
 * Instead of fixed thresholds, ranks the visitor's raw values against
 * historical data. Use this once 3+ months of data exists.
 *
 * Each raw metric is mapped to a 0–10 score based on its percentile
 * position within the provided historical distribution.
 *
 * @param {Object} rawMetrics - Current session's raw metrics:
 *   { uniquePages, uniquePageTypes, engagementTimeSeconds, avgScrollPercent,
 *     deepEngagementEvents, rawProgressionSum, dominantTopicShare,
 *     topicSwitchCount, repeatClusterVisits, totalPageViews }
 * @param {Object} historicalPercentiles - Pre-computed percentile boundaries
 *   for each metric, e.g.:
 *   { uniquePages: { p10: 1, p25: 2, p50: 4, p75: 7, p90: 10, p95: 14 }, ... }
 * @returns {Object} { breadth, depth, progression, clustering }
 */
export function scoreAllSignalsPercentile(rawMetrics, historicalPercentiles) {
  return {
    breadth: percentileToScore(
      rawMetrics.uniquePages,
      historicalPercentiles.uniquePages
    ),
    depth: percentileToScore(
      rawMetrics.engagementTimeSeconds,
      historicalPercentiles.engagementTimeSeconds
    ),
    progression: percentileToScore(
      rawMetrics.rawProgressionSum,
      historicalPercentiles.rawProgressionSum
    ),
    clustering: percentileToScore(
      rawMetrics.dominantTopicShare * 10, // normalise to 0–10 scale
      historicalPercentiles.dominantTopicShare
    )
  };
}

/**
 * Map a raw value to a 0–10 score based on its percentile position.
 *
 * Uses linear interpolation between percentile breakpoints for full 0–10
 * resolution, rather than discrete buckets. This provides meaningfully
 * better discrimination than the fixed-rule path once calibration data
 * is available.
 *
 * @param {number} value         - The raw metric value
 * @param {Object} percentiles   - { p10, p25, p50, p75, p90, p95 }
 * @returns {number} Score 0–10 (integer)
 */
function percentileToScore(value, percentiles) {
  if (!percentiles) return 5; // fallback: mid-range

  // Breakpoints: percentile boundary → score anchor
  const breakpoints = [
    { boundary: percentiles.p10, score: 1 },
    { boundary: percentiles.p25, score: 3 },
    { boundary: percentiles.p50, score: 5 },
    { boundary: percentiles.p75, score: 7 },
    { boundary: percentiles.p90, score: 9 }
  ];

  // Below lowest breakpoint
  if (value <= breakpoints[0].boundary) return breakpoints[0].score;

  // Interpolate between adjacent breakpoints
  for (let i = 1; i < breakpoints.length; i++) {
    if (value <= breakpoints[i].boundary) {
      const lo = breakpoints[i - 1];
      const hi = breakpoints[i];
      const range = hi.boundary - lo.boundary;
      if (range === 0) return hi.score;
      const t = (value - lo.boundary) / range;
      return Math.round(lo.score + t * (hi.score - lo.score));
    }
  }

  // Above p90
  return 10;
}
