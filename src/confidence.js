/**
 * Behaviour Intelligence System — Confidence Scoring Engine
 *
 * Calculates confidence scores (0–10) based on five factors.
 * Confidence determines what actions the system is permitted to take.
 *
 * Factors:
 *   1. Signal count (distinct event types observed)
 *   2. Signal strength (passive vs active actions)
 *   3. State clarity (gap between primary and secondary state fit)
 *   4. Session depth (time and page count)
 *   5. Temporal consistency (multi-session reinforcement)
 */

import { CONFIDENCE_CONFIG } from './config.js';

// ─── Main Confidence Calculator ─────────────────────────────────────

/**
 * Calculate the confidence score for a state classification.
 *
 * @param {Object} params
 * @param {Set|Array} params.signalTypesObserved - Distinct event type names
 * @param {Object}    params.sessionMeta         - { engagementTimeSeconds, pageCount }
 * @param {Object}    params.actionFlags         - { hasFormStart, hasFormSubmit, hasBooking, hasCtaClick }
 * @param {Object}    params.stateClarity        - { primaryFitPercent, secondaryFitPercent }
 * @param {Object}    params.temporal            - { sessionCount7d, sessionCount30d, trendDirection }
 * @param {Object}    [params.signals]           - { breadth, depth, progression } for contradiction penalties
 * @returns {Object}  { score, band, factors }
 */
export function calculateConfidence(params) {
  const {
    signalTypesObserved,
    sessionMeta,
    actionFlags,
    stateClarity,
    temporal
  } = params;

  const factors = {};

  // ── Minimum signal enforcement ──
  // Source requirement: "Require at least 3 signals before assigning
  // any state above low confidence." (Section 14, Constraints)
  const signalCount = Array.isArray(signalTypesObserved)
    ? signalTypesObserved.length
    : (signalTypesObserved ? signalTypesObserved.size : 0);

  // If fewer than 3 signal types, cap confidence at low (max 3)
  const insufficientSignals = signalCount < CONFIDENCE_CONFIG.minSignalsForClassification;

  // ── Factor 1: Signal count ──
  if (signalCount >= 5)      factors.signalCount = 2;
  else if (signalCount >= 3) factors.signalCount = 1;
  else                       factors.signalCount = 0;

  // ── Factor 2: Signal strength ──
  if (actionFlags.hasFormStart || actionFlags.hasBooking || actionFlags.hasFormSubmit) {
    factors.signalStrength = 2;  // active high-intent actions
  } else if (actionFlags.hasCtaClick) {
    factors.signalStrength = 1;  // mix of passive and active
  } else {
    factors.signalStrength = 0;  // only passive (views, scrolls)
  }

  // ── Factor 3: State clarity ──
  const gap = (stateClarity.primaryFitPercent || 100) - (stateClarity.secondaryFitPercent || 0);
  if (gap >= 40)      factors.stateClarity = 2;  // dominant, no close competitor
  else if (gap >= 20) factors.stateClarity = 1;  // clearly leads
  else                 factors.stateClarity = 0;  // within 20%, ambiguous

  // ── Factor 4: Session depth ──
  const time = sessionMeta.engagementTimeSeconds || 0;
  const pages = sessionMeta.pageCount || 0;

  if (time >= 120 && pages >= 5)       factors.sessionDepth = 2;  // >= 2min, 5+ pages
  else if (time >= 30 && pages >= 3)  factors.sessionDepth = 1;  // 30s–2min, 3–5 pages
  else                                factors.sessionDepth = 0;  // < 30s or ≤ 2 pages

  // ── Factor 5: Temporal consistency ──
  const sessions7d = temporal.sessionCount7d || 1;
  const sessions30d = temporal.sessionCount30d || 1;
  const trend = temporal.trendDirection || 'unknown';

  if ((sessions7d >= 3 || sessions30d >= 3) && trend === 'reinforcing') {
    factors.temporalConsistency = 2;  // 3+ sessions, reinforcing
  } else if (sessions7d >= 2 && (trend === 'consistent' || trend === 'reinforcing')) {
    factors.temporalConsistency = 1;  // 2 sessions, consistent direction
  } else {
    factors.temporalConsistency = 0;  // single session or no history
  }

  // ── Contradiction penalties (Codex recommendation #4) ──
  // Reduces confidence when signals contradict each other.
  factors.contradictionPenalty = 0;

  if (params.signals) {
    const { breadth, depth, progression } = params.signals;

    // High depth + low progression + high breadth = likely confusion, not evaluation
    if (depth >= 7 && progression <= 2 && breadth >= 5) {
      factors.contradictionPenalty -= 1;
    }

    // Very wide + very shallow = likely lost user, not intentional exploration
    if (breadth >= 8 && depth <= 2) {
      factors.contradictionPenalty -= 1;
    }
  }

  // ── Total ──
  const rawScore =
    factors.signalCount +
    factors.signalStrength +
    factors.stateClarity +
    factors.sessionDepth +
    factors.temporalConsistency +
    factors.contradictionPenalty;

  // Apply hybrid ambiguity penalty when the primary fit is below threshold.
  factors.hybridPenalty = 0;
  const primaryFit = stateClarity.primaryFitPercent || 100;
  if (primaryFit < CONFIDENCE_CONFIG.hybridThresholdPercent) {
    factors.hybridPenalty = -(CONFIDENCE_CONFIG.hybridPenalty || 1);
  }

  const scoreAfterHybrid = rawScore + factors.hybridPenalty;

  // Apply minimum signal cap: if < 3 signal types, cap at low confidence (max 3)
  const cappedScore = insufficientSignals
    ? Math.min(scoreAfterHybrid, CONFIDENCE_CONFIG.bands.low.max)
    : scoreAfterHybrid;

  const score = Math.min(Math.max(cappedScore, 0), 10);

  return {
    score,
    band: getConfidenceBand(score),
    factors
  };
}

// ─── Confidence Band ────────────────────────────────────────────────

/**
 * Map a confidence score to its band label.
 *
 * @param {number} score - Confidence score 0–10
 * @returns {string} 'low' | 'medium' | 'high'
 */
export function getConfidenceBand(score) {
  const { bands } = CONFIDENCE_CONFIG;

  if (score <= bands.low.max)    return 'low';
  if (score <= bands.medium.max) return 'medium';
  return 'high';
}

// ─── Permission Check ───────────────────────────────────────────────

/**
 * Check if a given action type is permitted at the current confidence level.
 *
 * @param {string} confidenceBand   - 'low', 'medium', or 'high'
 * @param {string} actionType       - 'reporting', 'nudge', 'automated'
 * @returns {boolean}
 */
export function isActionPermitted(confidenceBand, actionType) {
  const permissions = {
    low:    ['reporting'],
    medium: ['reporting', 'nudge', 'analyst_review'],
    high:   ['reporting', 'nudge', 'analyst_review', 'automated', 'personalisation', 'crm_workflow']
  };

  return (permissions[confidenceBand] || []).includes(actionType);
}

// ─── Motivation Gate ────────────────────────────────────────────────

/**
 * Check if motivation assignment is permitted at the current confidence level.
 *
 * @param {number} confidenceScore - Confidence score 0–10
 * @returns {Object} { allowed, requiresReview }
 */
export function isMotivationAllowed(confidenceScore) {
  const band = getConfidenceBand(confidenceScore);

  if (band === 'low') {
    return { allowed: false, requiresReview: false };
  }
  if (band === 'medium') {
    return { allowed: true, requiresReview: true };  // analyst review required
  }
  return { allowed: true, requiresReview: false };    // can drive automated variants
}
