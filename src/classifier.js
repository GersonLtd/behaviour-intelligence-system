/**
 * Behaviour Intelligence System — State Classification Engine
 *
 * Assigns visitors to behavioural states using signal scores and temporal
 * context. Evaluates states in strict priority order (highest first).
 *
 * Supports hybrid classification when primary state accounts for < 70%
 * of the signal weight.
 */

import { STATE_DEFINITIONS, CONFIDENCE_CONFIG } from './config.js';

// ─── Core Classifier ────────────────────────────────────────────────

/**
 * Classify a visitor into a behavioural state.
 *
 * Evaluates state criteria top-down by priority. Returns the first
 * matching state. If no state fully matches, returns the closest fit
 * with low confidence flagged.
 *
 * @param {Object} signals - { breadth, depth, progression, clustering } (each 0–10)
 * @param {Object} temporal - Temporal context from the temporal module
 * @param {Object} [frictionSignals] - Optional friction data for Stalled sub-typing
 * @returns {Object} Classification result
 */
export function classifyByFit(signals, temporal = {}, frictionSignals = null) {
  // Track fit scores for hybrid detection
  const fitScores = [];

  // Evaluate each state in priority order
  for (const stateDef of STATE_DEFINITIONS) {
    const fit = evaluateStateFit(stateDef, signals, temporal);
    fitScores.push({ state: stateDef.name, fit, definition: stateDef });
  }

  // Sort by fit score (descending)
  fitScores.sort((a, b) => b.fit - a.fit);

  const primary = fitScores[0];
  const secondary = fitScores[1];

  // Check if classification is hybrid
  const totalFit = primary.fit + secondary.fit;
  const primaryPercent = totalFit > 0 ? (primary.fit / totalFit) * 100 : 100;
  const isHybrid = primaryPercent < CONFIDENCE_CONFIG.hybridThresholdPercent && secondary.fit > 0;

  // Handle Stalled (Friction) sub-type
  let finalState = primary.state;
  if (finalState === 'Stalled' && frictionSignals && hasFriction(frictionSignals)) {
    finalState = 'Stalled (Friction)';
  }

  return {
    state: finalState,
    lifecyclePhase: primary.definition.lifecyclePhase,
    isHybrid,
    primaryFitPercent: Math.round(primaryPercent),
    secondaryState: isHybrid ? secondary.state : null,
    secondaryFitPercent: isHybrid ? Math.round(100 - primaryPercent) : null,
    // Raw fit scores for debugging / calibration
    fitScores: fitScores.map(f => ({ state: f.state, fit: Math.round(f.fit * 100) / 100 }))
  };
}

// ─── State Fit Evaluation ───────────────────────────────────────────

/**
 * Evaluate how well a visitor's signals match a state definition.
 *
 * Returns a fit score (0–1) where 1 = perfect match. Each criterion
 * contributes equally to the total. Criteria that are met score 1;
 * partial matches score proportionally.
 *
 * @param {Object} stateDef  - State definition from config
 * @param {Object} signals   - { breadth, depth, progression, clustering }
 * @param {Object} temporal  - Temporal context
 * @returns {number} Fit score 0–1
 */
function evaluateStateFit(stateDef, signals, temporal) {
  const criteria = stateDef.criteria;
  const checks = [];

  // Evaluate each signal criterion
  for (const [signal, bounds] of Object.entries(criteria)) {
    // Skip non-signal criteria
    if (signal === 'temporal' || signal === 'conversionComplete') continue;

    const value = signals[signal];
    if (value === undefined) continue;

    checks.push(evaluateBounds(value, bounds));
  }

  // Handle temporal criterion
  if (criteria.temporal) {
    const temporalMatch = temporal.temporalState === stateDef.name;
    checks.push(temporalMatch ? 1 : 0);
  }

  // Handle conversion criterion
  if (criteria.conversionComplete === false) {
    const noConversion = !temporal.conversionComplete;
    checks.push(noConversion ? 1 : 0);
  }

  // Average of all checks (0–1), with specificity bonus.
  // States with more signal criteria get a small bonus (up to +0.1) to prevent
  // low-criteria states (e.g. Hesitant with 2 signals) from structurally
  // dominating higher-criteria states (e.g. Comparator with 4 signals)
  // through simpler averaging.
  if (checks.length === 0) return 0;
  const avgFit = checks.reduce((sum, c) => sum + c, 0) / checks.length;
  const signalCriteriaCount = checks.length - (criteria.temporal ? 1 : 0) - (criteria.conversionComplete === false ? 1 : 0);
  const specificityBonus = Math.min(signalCriteriaCount * 0.025, 0.1);
  return avgFit + specificityBonus;
}

/**
 * Evaluate how well a value fits within defined bounds.
 *
 * Returns 1 if fully within bounds, 0–1 for partial match based on
 * how close the value is to the acceptable range.
 *
 * @param {number} value  - The signal score
 * @param {Object} bounds - { min?, max? }
 * @returns {number} Fit 0–1
 */
function evaluateBounds(value, bounds) {
  const min = bounds.min !== undefined ? bounds.min : -Infinity;
  const max = bounds.max !== undefined ? bounds.max : Infinity;

  // Perfect match
  if (value >= min && value <= max) return 1;

  // Partial match: how far outside the range?
  if (value < min) {
    const distance = min - value;
    return Math.max(0, 1 - (distance / 5)); // graceful falloff over 5 points
  }
  // value > max (only remaining case for finite values)
  const distance = value - max;
  return Math.max(0, 1 - (distance / 5));
}

// ─── Priority-Based Classification ──────────────────────────────────

/**
 * Classify using strict priority order (the primary classification method).
 *
 * Evaluates each state top-down by priority. Returns the first state
 * whose criteria are fully met. Falls back to fit-based classification
 * if no state fully matches.
 *
 * @param {Object} signals   - { breadth, depth, progression, clustering }
 * @param {Object} temporal  - Temporal context
 * @param {Object} [frictionSignals] - Optional friction data
 * @returns {Object} Classification result
 */
export function classifyByPriority(signals, temporal = {}, frictionSignals = null) {
  const { breadth: b, depth: d, progression: p, clustering: c } = signals;

  // Priority 1: Engaged — conversion completed
  if (p >= 8) {
    return buildResult('Engaged', signals, temporal);
  }

  // Priority 2: Hesitant — high intent, no completion.
  // Intentionally overrides Focused Evaluator (source: Section 7, Step 4).
  // A visitor who started a high-intent action but didn't complete it is
  // more immediately actionable than one who is deeply engaged.
  if (p >= 6 && d >= 4 && !temporal.conversionComplete) {
    return buildResult('Hesitant', signals, temporal);
  }

  // Priority 3: Returning Evaluator — temporal criteria
  if (temporal.temporalState === 'Returning Evaluator' && !temporal.conversionComplete) {
    return buildResult('Returning Evaluator', signals, temporal);
  }

  // Priority 4: Focused Evaluator — narrow, deep, high progression
  if (b >= 2 && b <= 4 && d >= 7 && c >= 7 && p >= 6) {
    return buildResult('Focused Evaluator', signals, temporal);
  }

  // Priority 5: Evaluator — deep + clustered + progressing
  if (d >= 6 && c >= 5 && p >= 4 && p <= 6) {
    return buildResult('Evaluator', signals, temporal);
  }

  // Priority 6: Comparator — multi-pathway evaluation (depth 3–5)
  if (b >= 4 && b <= 7 && d >= 3 && d <= 5 && c >= 5 && p >= 3 && p <= 5) {
    return buildResult('Comparator', signals, temporal);
  }

  // Priority 7: Stalled — moderate engagement, no progression
  if (b >= 3 && b <= 6 && d >= 4 && d <= 6 && p <= 3) {
    const state = (frictionSignals && hasFriction(frictionSignals))
      ? 'Stalled (Friction)'
      : 'Stalled';
    return buildResult(state, signals, temporal);
  }

  // Priority 8: Scanner — wide, shallow, scattered (before Explorer to avoid overlap)
  if (b >= 6 && d <= 3 && c <= 3) {
    return buildResult('Scanner', signals, temporal);
  }

  // Priority 9: Explorer — moderate exploration
  if (b >= 4 && b <= 7 && d >= 3 && d <= 6) {
    return buildResult('Explorer', signals, temporal);
  }

  // Priority 10: Mismatch — minimal engagement
  if (b <= 2 && d <= 2 && p === 0) {
    return buildResult('Mismatch', signals, temporal);
  }

  // Fallback: use fit-based classification.
  // This is a normal operational path, not an error. The priority rules above
  // intentionally cover only clear-cut cases. Ambiguous signal combinations
  // (e.g. moderate scores across all dimensions) are handled here via
  // continuous fit scoring with hybrid state detection.
  return classifyByFit(signals, temporal, frictionSignals);
}

// ─── Friction Detection ─────────────────────────────────────────────

/**
 * Determine if friction signals indicate a UX problem.
 *
 * These thresholds are defined in state-rules.yml and generated into
 * config.js via: node tools/generate-config.js
 * The SQL equivalents in sql/02-state-classification.sql are validated
 * by the test suite to stay in sync.
 *
 * @param {Object} frictionSignals
 * @param {number} [frictionSignals.rageClickCount]    - Rapid repeated clicks
 * @param {number} [frictionSignals.deadClickCount]    - Clicks on non-interactive elements
 * @param {number} [frictionSignals.formErrorCount]    - Form validation errors
 * @param {boolean} [frictionSignals.highLayoutShift]  - CLS > 0.25
 * @returns {boolean}
 */
export function hasFriction(frictionSignals) {
  return (
    (frictionSignals.rageClickCount || 0) >= 3 ||
    (frictionSignals.deadClickCount || 0) >= 2 ||
    (frictionSignals.formErrorCount || 0) >= 2 ||
    frictionSignals.highLayoutShift === true
  );
}

// ─── Result Builder ─────────────────────────────────────────────────

/**
 * Build a classification result object.
 *
 * @param {string} state    - The assigned state name
 * @param {Object} signals  - Signal scores
 * @param {Object} temporal - Temporal context
 * @returns {Object} Structured classification result
 */
function buildResult(state, signals, temporal) {
  const definition = STATE_DEFINITIONS.find(s => s.name === state)
    || STATE_DEFINITIONS.find(s => state.startsWith(s.name))  // handle "Stalled (Friction)"
    || { lifecyclePhase: 'unknown' };

  return {
    state,
    lifecyclePhase: definition.lifecyclePhase,
    isHybrid: false,
    primaryFitPercent: 100,
    secondaryState: null,
    secondaryFitPercent: null,
    signals: { ...signals },
    temporal: temporal.temporalState || null
  };
}
