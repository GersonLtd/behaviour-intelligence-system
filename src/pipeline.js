/**
 * Behaviour Intelligence System — End-to-End Pipeline
 *
 * Single entry point that orchestrates the full classification flow:
 *   1. Score signals from raw session data
 *   2. Assess temporal context from user history
 *   3. Classify the visitor into a state
 *   4. Calculate confidence (with contradiction penalties)
 *   5. Apply refinements (sub-type + motivation)
 *   6. Resolve recommended action (with confidence gates)
 *
 * All modules are imported from their canonical locations.
 * There is one primary entry point: evaluateVisitor().
 * classifyVisitor() is a backward-compatible convenience wrapper.
 */

import { scoreAllSignals } from './signals.js';
import { assessTemporalContext } from './temporal.js';
import { classifyByPriority } from './classifier.js';
import { calculateConfidence } from './confidence.js';
import { applyRefinements } from './refinements.js';
import { resolveAction } from './action.js';

// ─── Helpers ────────────────────────────────────────────────────────

function toSignalTypeSet(events = []) {
  return new Set(events.map(e => e.eventName).filter(Boolean));
}

function toActionFlags(events = []) {
  const names = new Set(events.map(e => e.eventName));
  return {
    hasFormStart: names.has('form_start'),
    hasFormSubmit: names.has('form_submit'),
    hasBooking: names.has('booking_click'),
    hasCtaClick: names.has('cta_click')
  };
}

function countEvents(events, name) {
  if (!events) return 0;
  return events.filter(e => e.eventName === name).length;
}

// ─── Primary Entry Point ────────────────────────────────────────────

/**
 * Evaluate a visitor session end-to-end.
 *
 * @param {Object} input
 * @param {Object} input.sessionData         - Raw session data for signal scoring:
 *   { breadthMetrics, depthMetrics, events, clusteringMetrics, trafficSource,
 *     pageEngagements?, frictionSignals?, sessionDate?, timeToFirstHighIntentMs? }
 * @param {Array<Object>} [input.userHistory]  - Prior sessions for temporal analysis
 * @param {Object} [input.frictionSignals]     - Optional friction signal overrides
 * @param {Date} [input.referenceDate]         - Evaluation date (default: now)
 * @returns {Object} Complete evaluation result
 */
export function evaluateVisitor(input) {
  const {
    sessionData,
    userHistory = [],
    frictionSignals = null,
    referenceDate = new Date()
  } = input;

  // ── Step 1: Score signals ──
  const signals = scoreAllSignals(sessionData);

  // ── Step 2: Temporal assessment ──
  // Wrapped in try/catch so that malformed user history (e.g. bad dates)
  // degrades gracefully to single-session defaults instead of crashing
  // the entire pipeline.
  let temporal;
  try {
    const currentSession = {
      sessionDate: sessionData.sessionDate || referenceDate.toISOString(),
      breadth: signals.breadth,
      depth: signals.depth,
      progression: signals.progression,
      clustering: signals.clustering,
      conversionComplete: signals.progression >= 8,
      timeToFirstHighIntentMs: sessionData.timeToFirstHighIntentMs
    };

    temporal = assessTemporalContext(
      [...userHistory, currentSession],
      referenceDate
    );
  } catch {
    temporal = {
      temporalState: null,
      recencyBand: 'dormant',
      sessionCount7d: 1,
      sessionCount30d: 1,
      trend: 'insufficient',
      velocity: 'low',
      daysSinceLastSession: 0,
      conversionComplete: false,
      trendDirection: 'insufficient'
    };
  }

  // ── Step 3: Classify state ──
  const friction = frictionSignals || sessionData.frictionSignals || null;
  const classification = classifyByPriority(signals, temporal, friction);

  // ── Step 4: Calculate confidence (with signals for contradiction penalties) ──
  const confidence = calculateConfidence({
    signalTypesObserved: toSignalTypeSet(sessionData.events),
    sessionMeta: {
      engagementTimeSeconds: sessionData.depthMetrics?.engagementTimeSeconds || 0,
      pageCount: sessionData.breadthMetrics?.uniquePages || 0
    },
    actionFlags: toActionFlags(sessionData.events),
    stateClarity: {
      primaryFitPercent: classification.primaryFitPercent || 100,
      secondaryFitPercent: classification.secondaryFitPercent || 0
    },
    temporal: {
      sessionCount7d: temporal.sessionCount7d,
      sessionCount30d: temporal.sessionCount30d,
      trendDirection: temporal.trendDirection
    },
    signals  // passed for contradiction penalty evaluation
  });

  // ── Step 5: Apply refinements (sub-type + motivation) ──
  const refinements = applyRefinements({
    signals,
    state: classification.state,
    confidenceScore: confidence.score,
    pageEngagements: sessionData.pageEngagements || [],
    extras: {
      velocity: temporal.velocity,
      topicSwitchCount: sessionData.clusteringMetrics?.topicSwitchCount || 0,
      formStarts: countEvents(sessionData.events, 'form_start'),
      formSubmits: countEvents(sessionData.events, 'form_submit'),
      repeatClusterVisits: sessionData.clusteringMetrics?.repeatClusterVisits || 0
    }
  });

  // ── Step 6: Resolve action (with prescription context) ──
  // Build context for prescriptive template interpolation from session data.
  // Aggregate values (topSource, sessionCount across all users) are not
  // available at the single-visitor level — those are supplied by the caller
  // or by the SQL dashboard view. We populate what we can.
  const prescriptionContext = {
    sessionCount: 1,
    blockedCount: countEvents(sessionData.events, 'form_start')
      - countEvents(sessionData.events, 'form_submit'),
    trafficSource: sessionData.trafficSource || 'unknown',
    ...(input.prescriptionContext || {})  // caller can supply aggregate context
  };

  const action = resolveAction({
    state: classification.state,
    confidenceBand: confidence.band,
    confidenceScore: confidence.score,
    motivation: refinements.motivation,
    isHybrid: classification.isHybrid,
    secondaryState: classification.secondaryState,
    context: prescriptionContext
  });

  // ── Assemble result ──
  return {
    signals,
    temporal: {
      state: temporal.temporalState,
      recency: temporal.recencyBand,
      trend: temporal.trend,
      velocity: temporal.velocity,
      sessionCount7d: temporal.sessionCount7d,
      sessionCount30d: temporal.sessionCount30d
    },
    classification: {
      state: classification.state,
      lifecyclePhase: classification.lifecyclePhase,
      isHybrid: classification.isHybrid,
      secondaryState: classification.secondaryState
    },
    confidence: {
      score: confidence.score,
      band: confidence.band,
      factors: confidence.factors
    },
    refinements: {
      subType: refinements.subType,
      motivation: refinements.motivation
    },
    action
  };
}

// ─── Backward-Compatible Wrapper ────────────────────────────────────

/**
 * Convenience API matching the README quick-start example.
 *
 * @param {Object} sessionData   - Raw session data
 * @param {Array} [userHistory]  - Prior sessions
 * @param {Object} [options]     - { frictionSignals?, referenceDate? }
 * @returns {Object}
 */
export function classifyVisitor(sessionData, userHistory = [], options = {}) {
  return evaluateVisitor({
    sessionData,
    userHistory,
    frictionSignals: options.frictionSignals || sessionData.frictionSignals || null,
    referenceDate: options.referenceDate || new Date()
  });
}
