/**
 * Behaviour Intelligence System — Interactive Classifier
 *
 * Standalone module for testing how signal scores map to states.
 * Can be used as a browser widget or a Node.js utility.
 *
 * Uses the real classification engine (classifyByPriority with
 * classifyByFit fallback), confidence scoring, and action resolution
 * — the same pipeline that runs in production.
 */

import { classifyByPriority } from './classifier.js';
import { calculateConfidence } from './confidence.js';
import { resolveAction } from './action.js';
import { ACTION_MAPPINGS } from './config.js';

// ─── Classify from Scores ───────────────────────────────────────────

/**
 * Classify a visitor from four signal scores.
 *
 * Runs the full priority classifier, confidence scoring, and action
 * resolution. Temporal context defaults to empty (single-session mode).
 *
 * @param {number} breadth     - Breadth score 0–10
 * @param {number} depth       - Depth score 0–10
 * @param {number} progression - Progression score 0–10
 * @param {number} clustering  - Clustering score 0–10
 * @param {Object} [options]   - Optional overrides
 * @param {Object} [options.temporal]         - Temporal context
 * @param {Object} [options.frictionSignals]  - Friction data for Stalled sub-typing
 * @returns {Object} { state, action, confidence, confidenceScore, isHybrid, secondaryState, lifecyclePhase }
 */
export function classifyFromScores(breadth, depth, progression, clustering, options = {}) {
  const signals = { breadth, depth, progression, clustering };
  const temporal = options.temporal || {};
  const frictionSignals = options.frictionSignals || null;

  // Run the real classifier
  const classification = classifyByPriority(signals, temporal, frictionSignals);

  // Build confidence params from signal scores.
  // Since we only have scores (not raw session data), we use proxies.
  const signalTypesObserved = [
    breadth > 0 && 'page_view',
    depth > 0 && 'scroll',
    progression > 0 && 'cta_click',
    clustering > 0 && 'topic_cluster',
    progression >= 4 && 'form_start',
    progression >= 8 && 'conversion_complete'
  ].filter(Boolean);

  const confidenceScore = calculateConfidence({
    signalTypesObserved,
    actionFlags: {
      hasCtaClick: progression > 0,
      hasFormStart: progression >= 4,
      hasFormSubmit: progression >= 6,
      hasBooking: false
    },
    stateClarity: {
      primaryFitPercent: classification.primaryFitPercent,
      secondaryFitPercent: classification.secondaryFitPercent || 0
    },
    sessionMeta: {
      engagementTimeSeconds: depth * 20,  // rough proxy from depth score
      pageCount: breadth
    },
    signals,
    temporal
  });

  const confidenceBand = confidenceScore.band;
  const confidenceValue = confidenceScore.score;

  // Resolve action
  const actionResult = resolveAction({
    state: classification.state,
    confidenceBand,
    confidenceScore: confidenceValue,
    isHybrid: classification.isHybrid,
    secondaryState: classification.secondaryState,
    primaryFitPercent: classification.primaryFitPercent
  });

  // Look up the action text
  const mapping = ACTION_MAPPINGS[classification.state] || {};

  return {
    state: classification.state,
    action: mapping.action || 'No action defined',
    confidence: confidenceBand.charAt(0).toUpperCase() + confidenceBand.slice(1),
    confidenceScore: confidenceValue,
    isHybrid: classification.isHybrid,
    secondaryState: classification.secondaryState,
    primaryFitPercent: classification.primaryFitPercent,
    lifecyclePhase: classification.lifecyclePhase,
    actionPermitted: actionResult.permitted,
    automationEnabled: actionResult.automationEnabled || false
  };
}

// ─── CLI Usage ──────────────────────────────────────────────────────

/**
 * If run directly from command line:
 *   node src/interactive-classifier.js <breadth> <depth> <progression> <clustering>
 */
const isMainModule = typeof process !== 'undefined'
  && process.argv[1]
  && process.argv[1].includes('interactive-classifier');

if (isMainModule) {
  const args = process.argv.slice(2).map(Number);

  if (args.length !== 4 || args.some(isNaN)) {
    console.log('Usage: node src/interactive-classifier.js <breadth> <depth> <progression> <clustering>');
    console.log('Example: node src/interactive-classifier.js 5 7 4 6');
    process.exit(1);
  }

  const [b, d, p, c] = args;
  const result = classifyFromScores(b, d, p, c);

  console.log(`\nSignals:    Breadth=${b}  Depth=${d}  Progression=${p}  Clustering=${c}`);
  console.log(`State:      ${result.state}`);
  console.log(`Phase:      ${result.lifecyclePhase}`);
  console.log(`Confidence: ${result.confidence} (${result.confidenceScore}/10)`);
  if (result.isHybrid) {
    console.log(`Hybrid:     ${result.primaryFitPercent}% primary, secondary: ${result.secondaryState}`);
  }
  console.log(`Action:     ${result.action}`);
  console.log(`Permitted:  ${result.actionPermitted}`);
}
