/**
 * Behaviour Intelligence System — Action Resolver (unified)
 *
 * Maps classified states to operational actions with confidence gates,
 * motivation refinements, hybrid state guidance, and batch processing.
 *
 * This is the single action resolver used by the pipeline.
 */

import { ACTION_MAPPINGS, MOTIVATION_DEFINITIONS } from './config.js';
import { isActionPermitted, getConfidenceBand, isMotivationAllowed } from './confidence.js';

// ─── Prescriptive Templates ─────────────────────────────────────────
// Natural-language instruction templates keyed by state.
// Placeholders like {topSource} are interpolated at runtime from context.

const PRESCRIPTION_TEMPLATES = {
  'Mismatch':
    'Review traffic quality from {topSource}. {sessionCount} sessions showed no meaningful engagement.',
  'Scanner':
    'Add guided entry points on {topLandingPage}. {sessionCount} sessions showed wide browsing with no depth.',
  'Explorer':
    'Strengthen pathways from discovery content into relevant offers. {sessionCount} sessions explored without clustering.',
  'Comparator':
    'Clarify differentiation between competing options. {sessionCount} sessions compared without converting.',
  'Evaluator':
    'Add case studies and proof elements to evaluation pages. {sessionCount} sessions evaluated deeply but did not convert.',
  'Focused Evaluator':
    'Shorten the path to conversion. {sessionCount} high-intent sessions are close to acting.',
  'Hesitant':
    'Reduce form friction on {topBlockedPage}. {blockedCount} users started but did not complete conversion.',
  'Stalled':
    'Simplify navigation to reduce loops. {sessionCount} sessions showed moderate engagement but no forward movement.',
  'Stalled (Friction)':
    'Fix {topFrictionElement} on {topFrictionPage}. {frictionCount} users were blocked by UX failures.',
  'Returning Evaluator':
    'Reinforce differentiation and closing reassurance. {sessionCount} returning visitors have not yet converted.',
  'Engaged':
    'Support onboarding and post-conversion confidence. {sessionCount} users converted and are now validating.'
};

// ─── Band Utilities ─────────────────────────────────────────────────

const BAND_RANK = { low: 0, medium: 1, high: 2 };

function meetsMinimumBand(actualBand, minimumBand) {
  return (BAND_RANK[actualBand] || 0) >= (BAND_RANK[minimumBand] || 0);
}

function mapActionType(actionConfig) {
  if (actionConfig.automated) return 'automated';
  if (actionConfig.type === 'strategic') return 'reporting';
  return 'nudge';
}

// ─── Resolve Action ─────────────────────────────────────────────────

/**
 * Resolve state → action with confidence-aware gating, motivation
 * refinement, and hybrid state guidance.
 *
 * @param {Object} params
 * @param {string} params.state            - Assigned state
 * @param {string} params.confidenceBand   - 'low', 'medium', or 'high'
 * @param {number} params.confidenceScore  - Confidence score 0–10
 * @param {string|null} [params.motivation]      - Motivation signal
 * @param {boolean} [params.isHybrid]            - Whether classification is hybrid
 * @param {string|null} [params.secondaryState]  - Secondary state (if hybrid)
 * @returns {Object} Complete action plan
 */
export function resolveAction(params) {
  const {
    state,
    confidenceBand,
    confidenceScore,
    motivation = null,
    isHybrid = false,
    secondaryState = null
  } = params;

  const mapping = ACTION_MAPPINGS[state];
  if (!mapping) {
    return {
      state,
      action: 'No action mapping defined for this state',
      metric: null,
      owner: 'unknown',
      actionType: 'reporting',
      confidence: { score: confidenceScore, band: confidenceBand },
      permitted: false,
      automated: false,
      motivation: null,
      motivationRefinement: null,
      hybridWarning: null
    };
  }

  // ── Confidence gating ──
  const allowedByMinimum = meetsMinimumBand(confidenceBand, mapping.confidenceMinimum);
  const actionType = mapActionType(mapping);
  const allowedByBandPolicy = isActionPermitted(confidenceBand, actionType);
  const permitted = allowedByMinimum && allowedByBandPolicy;
  const automated = permitted && mapping.automated && confidenceBand === 'high';

  // ── Motivation refinement ──
  let motivationRefinement = null;
  if (motivation) {
    const motivationGate = isMotivationAllowed(confidenceScore);
    if (motivationGate.allowed) {
      const motivDef = MOTIVATION_DEFINITIONS[motivation];
      if (motivDef) {
        motivationRefinement = {
          motivation,
          actionModifier: motivDef.actionModifier,
          requiresReview: motivationGate.requiresReview
        };
      }
    }
  }

  // ── Hybrid state guidance ──
  let hybridWarning = null;
  if (isHybrid && secondaryState) {
    const secondaryMapping = ACTION_MAPPINGS[secondaryState];
    if (secondaryMapping) {
      hybridWarning = {
        secondaryState,
        secondaryAction: secondaryMapping.action,
        guidance: `Respond to primary state (${state}) but avoid actions ` +
          `that would be counterproductive for ${secondaryState}. ` +
          `Preferred approach: ${getHybridGuidance(state, secondaryState)}`
      };
    }
  }

  // Generate prescriptive instruction from template
  const prescription = generatePrescription(state, params.context || {});

  return {
    state,
    action: mapping.action,
    metric: mapping.metric,
    owner: mapping.type,
    actionType,
    confidence: { score: confidenceScore, band: confidenceBand },
    confidenceMinimum: mapping.confidenceMinimum,
    permitted,
    automated,
    motivation,
    motivationRefinement,
    isHybrid,
    secondaryState,
    hybridWarning,
    prescription
  };
}

// ─── Prescriptive Output ────────────────────────────────────────────

/**
 * Generate a natural-language prescriptive instruction from a template.
 *
 * Templates use {placeholder} syntax. Context provides the values.
 * Missing placeholders are left as-is (visible in output as a prompt
 * to supply the data).
 *
 * @param {string} state   - The assigned state
 * @param {Object} context - Aggregate data for interpolation:
 *   { topSource?, topLandingPage?, topBlockedPage?, topFrictionElement?,
 *     topFrictionPage?, sessionCount?, blockedCount?, frictionCount? }
 * @returns {string|null} Prescriptive instruction or null if no template
 */
export function generatePrescription(state, context = {}) {
  const template = PRESCRIPTION_TEMPLATES[state];
  if (!template) return null;

  return template.replace(/\{(\w+)\}/g, (match, key) => {
    return context[key] !== undefined ? String(context[key]) : match;
  });
}

// ─── Hybrid State Guidance ──────────────────────────────────────────

function getHybridGuidance(primary, secondary) {
  const guidanceMap = {
    'Explorer|Evaluator': 'Guide toward deeper evaluation content rather than immediately pushing for conversion',
    'Explorer|Comparator': 'Surface comparison content and differentiators alongside discovery content',
    'Scanner|Explorer': 'Provide guided entry points rather than broad navigation changes',
    'Evaluator|Hesitant': 'Strengthen proof and reassurance within evaluation content rather than adding form pressure',
    'Comparator|Evaluator': 'Include depth content within comparison views rather than forcing narrow focus',
    'Stalled|Explorer': 'Simplify navigation while maintaining discovery pathways',
    'Evaluator|Focused Evaluator': 'Continue deepening engagement without narrowing prematurely'
  };

  const key = `${primary}|${secondary}`;
  const reverseKey = `${secondary}|${primary}`;
  return guidanceMap[key]
    || guidanceMap[reverseKey]
    || `Balance actions for ${primary} without conflicting with ${secondary}`;
}

// ─── Batch Processing ───────────────────────────────────────────────

/**
 * Resolve actions for multiple classified visitors.
 *
 * @param {Array<Object>} items - Array of resolveAction param objects
 * @returns {Array<Object>} Array of action plans
 */
export function resolveActions(items) {
  return items.map(item => resolveAction(item));
}

// ─── Action Summary ─────────────────────────────────────────────────

/**
 * Generate an aggregate action summary from action plans.
 *
 * Groups by state, counts, and ranks by volume and confidence.
 * Useful for strategic dashboards and prioritisation.
 *
 * @param {Array<Object>} actionPlans - Output from resolveActions
 * @returns {Array<Object>} Summary sorted by count descending
 */
export function summariseActions(actionPlans) {
  const summary = {};

  for (const plan of actionPlans) {
    if (!summary[plan.state]) {
      summary[plan.state] = {
        state: plan.state,
        action: plan.action,
        metric: plan.metric,
        owner: plan.owner,
        count: 0,
        permittedCount: 0,
        automatedCount: 0,
        avgConfidence: 0,
        motivations: {}
      };
    }

    const entry = summary[plan.state];
    entry.count++;
    if (plan.permitted) entry.permittedCount++;
    if (plan.automated) entry.automatedCount++;
    entry.avgConfidence += plan.confidence.score;

    if (plan.motivation) {
      entry.motivations[plan.motivation] = (entry.motivations[plan.motivation] || 0) + 1;
    }
  }

  for (const entry of Object.values(summary)) {
    entry.avgConfidence = Math.round((entry.avgConfidence / entry.count) * 10) / 10;
  }

  return Object.values(summary).sort((a, b) => b.count - a.count);
}
