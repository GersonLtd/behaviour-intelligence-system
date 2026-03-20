/**
 * Behaviour Intelligence System — Refinement Layers
 *
 * Optional layers applied after state classification:
 *   1. Content sub-types (proof-focused, trust-focused, price-focused, resource-seeking)
 *   2. Motivation signals (curiosity, value, risk, confusion, overload, urgency)
 *
 * Both layers are secondary metadata — they refine response content,
 * not state classification or confidence.
 */

import { SUBTYPE_DEFINITIONS, MOTIVATION_DEFINITIONS } from './config.js';

// ─── Content Sub-type Detection ─────────────────────────────────────

/**
 * Detect the content sub-type from session page engagement data.
 *
 * A sub-type is assigned when the majority of engagement depth falls
 * on a specific category of pages (proof, trust, price, resources).
 *
 * @param {Array<Object>} pageEngagements - Array of page-level engagement data:
 *   { pageType, engagementTimeSeconds, scrollPercent, eventCount }
 * @returns {string|null} Sub-type label or null if none qualifies
 */
export function detectSubType(pageEngagements) {
  if (!pageEngagements || pageEngagements.length === 0) return null;

  // Calculate total depth (engagement time as proxy)
  const totalDepth = pageEngagements.reduce(
    (sum, p) => sum + (p.engagementTimeSeconds || 0), 0
  );

  if (totalDepth === 0) return null;

  // Calculate share of depth for each sub-type's page types
  for (const [subTypeName, definition] of Object.entries(SUBTYPE_DEFINITIONS)) {
    const matchingPages = pageEngagements.filter(
      p => definition.pageTypes.includes(p.pageType)
    );

    const matchDepth = matchingPages.reduce(
      (sum, p) => sum + (p.engagementTimeSeconds || 0), 0
    );

    const depthShare = matchDepth / totalDepth;
    const threshold = definition.depthShareThreshold || 0.5;

    if (depthShare >= threshold) {
      return subTypeName;
    }
  }

  return null;
}

// ─── Motivation Signal Detection ────────────────────────────────────

/**
 * Detect the primary motivation signal from behavioural patterns.
 *
 * Motivation is only assigned when confidence is medium or high (≥ 4).
 * The caller must enforce this gate before calling this function.
 *
 * @param {Object} signals    - { breadth, depth, progression, clustering }
 * @param {string} state      - Current state classification
 * @param {string|null} subType - Content sub-type (if detected)
 * @param {Object} [extras]   - Additional metrics:
 *   { velocity, topicSwitchCount, formStarts, formSubmits, repeatClusterVisits }
 * @returns {string|null} Motivation signal label or null
 */
export function detectMotivation(signals, state, subType = null, extras = {}) {
  const { breadth, depth, progression, clustering } = signals;
  const {
    velocity,
    topicSwitchCount = 0,
    formStarts = 0,
    formSubmits = 0,
    repeatClusterVisits = 0
  } = extras;

  // Urgency-driven: fast to high-intent with minimal exploration
  if (velocity === 'high' && breadth <= 4 && progression >= 6) {
    return 'urgency-driven';
  }

  // Risk-sensitive: strong intent but hesitation at the final step
  if ((state === 'Hesitant' || state === 'Focused Evaluator')
      && formStarts > 0
      && formSubmits === 0
      && depth >= 5) {
    return 'risk-sensitive';
  }

  // Confusion-driven: loops and switching without progression
  if ((state === 'Stalled' || state === 'Scanner')
      && topicSwitchCount >= 4
      && progression <= 2) {
    return 'confusion-driven';
  }

  // Overload-sensitive: deep engagement but no progression
  if (depth >= 7 && progression <= 3 && repeatClusterVisits >= 2) {
    return 'overload-sensitive';
  }

  // Value-driven: deep proof/outcome engagement with progression.
  // Accept both proof-focused and trust-focused sub-types, as both
  // indicate a visitor seeking evidence before committing.
  if ((subType === 'proof-focused' || subType === 'trust-focused')
      && depth >= 5
      && progression >= 3) {
    return 'value-driven';
  }

  // Curiosity-driven: broad, low commitment
  if (breadth >= 6 && depth <= 4 && progression <= 2) {
    return 'curiosity-driven';
  }

  return null;
}

// ─── Combined Refinement ────────────────────────────────────────────

/**
 * Apply all refinement layers to a classification.
 *
 * Combines sub-type detection and motivation detection into a
 * single refinement result. Respects the confidence gate for motivation.
 *
 * @param {Object} params
 * @param {Object} params.signals            - { breadth, depth, progression, clustering }
 * @param {string} params.state              - Current state classification
 * @param {number} params.confidenceScore    - Confidence score 0–10
 * @param {Array}  params.pageEngagements    - Page-level engagement data
 * @param {Object} [params.extras]           - Additional metrics for motivation
 * @returns {Object} { subType, motivation }
 */
export function applyRefinements(params) {
  const { signals, state, confidenceScore, pageEngagements, extras } = params;

  // Sub-type (no confidence gate — informational only)
  const subType = detectSubType(pageEngagements);

  // Motivation (confidence-gated: requires ≥ 4)
  let motivation = null;
  if (confidenceScore >= 4) {
    motivation = detectMotivation(signals, state, subType, extras);
  }

  return { subType, motivation };
}
