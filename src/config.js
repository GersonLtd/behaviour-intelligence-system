/**
 * Behaviour Intelligence System — Configuration
 *
 * ⚠️  AUTO-GENERATED from state-rules.yml — do not edit manually.
 *     Run: node tools/generate-config.js
 *
 * Central configuration for all system parameters: weights, thresholds,
 * state definitions, and calibration settings.
 */

// ─── Page Type Weights ──────────────────────────────────────────────
// Multipliers that adjust signal value based on where the action occurs.
const PAGE_TYPE_WEIGHTS = {
  homepage:     0.5,
  blog:         0.6,
  resource:     0.6,
  service:      1.0,
  product:      1.0,
  case_study:   1.2,
  pricing:      1.5,
  contact:      2.0,
  booking:      2.0,
  confirmation: 2.0,
  unknown:      0.5
};

// ─── Action Strength Weights ────────────────────────────────────────
// How strongly each event type indicates intent.
const ACTION_WEIGHTS = {
  page_view:           0.2,
  scroll_75:           0.5,
  cta_click:           1.0,
  form_start:          1.5,
  form_submit:         2.0,
  booking_click:       1.5,
  conversion_complete: 2.0,
  resource_download:   0.8,
  video_start:         0.6
};

// ─── Traffic Source Bias ────────────────────────────────────────────
// Adjustments to baseline scores based on traffic source.
// Applied before behavioural signals take over.
const SOURCE_BIAS = {
  direct:         { progression: 1,  depth: 0 },
  organic_search: { progression: 0,  depth: 0 },
  social_media:   { progression: -1,  depth: 0 },
  referral:       { progression: 0,  depth: 1 },
  paid_search:    { progression: 1,  depth: 0 }
};

// ─── Element Role Weights ────────────────────────────────────────────
// Default weights for element-level micro-signals (CMS-first model).
// When an element carries a data-element-role but no explicit weight,
// this lookup provides the default. Overridden by explicit element_weight.
const ELEMENT_ROLE_WEIGHTS = {
  progression: 2.0,
  navigation:  0.3,
  depth:       0.5,
  tool_use:    0.8,
  social:      0.3
};

// ─── Breadth Score Thresholds (Fixed-Rule) ──────────────────────────
// Maps raw page/type counts to a 0–10 score.
const BREADTH_THRESHOLDS = [
  { maxPages: 1, maxTypes: Infinity, score: 1 },
  { maxPages: 3, maxTypes: 2, score: 3 },
  { maxPages: 5, maxTypes: Infinity, score: 5 },
  { maxPages: 8, minTypes: 3, score: 7 },
  { maxPages: Infinity, score: 9 }
];

// ─── Depth Score Thresholds (Fixed-Rule) ────────────────────────────
// Maps engagement time to base depth score. Bonuses added separately.
const DEPTH_TIME_THRESHOLDS = [
  { maxSeconds: 10, score: 1 },
  { maxSeconds: 30, score: 3 },
  { maxSeconds: 90, score: 5 },
  { maxSeconds: 180, score: 7 },
  { maxSeconds: Infinity, score: 9 }
];

const DEPTH_SCROLL_BONUS_THRESHOLD = 75;  // avg_scroll_percent >= this → +1

// ─── Clustering Configuration ───────────────────────────────────────
const CLUSTERING_CONFIG = {
  switchPenaltyCap: 5,         // max penalty from topic switches
  repeatBonusCap: 3,           // max bonus from repeat cluster returns
  minPagesForPenalty: 4        // signal floor: no switch penalty below this
};

// ─── Temporal Thresholds ────────────────────────────────────────────
const TEMPORAL_THRESHOLDS = {
  returningEvaluator: {
    sessionsIn7Days: 2,
    sessionsIn30Days: 3
  },
  reengagedProspect: {
    gapDays: 30,
    minClustering: 5,
    minProgression: 4
  },
  persistentHesitation: {
    minHesitantSessions: 2,
    withinDays: 14
  },
  chronicStall: {
    minStalledSessions: 3,
    withinDays: 30
  },
  recencyBands: {
    highlyRecent:       2,   // 0–2 days
    activeConsideration: 7,  // 3–7 days
    delayedReturn:      30,  // 8–30 days
    // 30+ = dormant
  }
};

// ─── Confidence Scoring ─────────────────────────────────────────────
const CONFIDENCE_CONFIG = {
  bands: {
    low:    { min: 0, max: 3 },
    medium: { min: 4, max: 6 },
    high:   { min: 7, max: 10 }
  },
  // Minimum signal types required for reliable classification
  minSignalsForClassification: 3,
  // Hybrid state threshold: primary must account for ≥ this %
  hybridThresholdPercent: 70,
  // Hybrid ambiguity penalty (applied when primary is below threshold)
  hybridPenalty: -1
  // Contradiction penalties are implemented directly in confidence.js
  // (depth >= 7 + progression <= 2 + breadth >= 5 = -1;
  //  breadth >= 8 + depth <= 2 = -1)
};

// ─── State Definitions ──────────────────────────────────────────────
// Priority order (index = priority, lower = higher priority).
// Each state includes its signal criteria for classification.
const STATE_DEFINITIONS = [
  {
    name: 'Engaged',
    priority: 1,
    criteria: {
      progression: { min: 8 }
    },
    description: 'Conversion completed. Post-action phase.',
    lifecyclePhase: 'retention'
  },
  {
    name: 'Hesitant',
    priority: 2,
    criteria: {
      progression: { min: 6 },
      depth: { min: 4 },
      conversionComplete: false
    },
    description: 'High-intent action started but not completed.',
    lifecyclePhase: 'evaluation'
  },
  {
    name: 'Returning Evaluator',
    priority: 3,
    criteria: {
      temporal: true,
      conversionComplete: false
    },
    description: 'Multi-session with increasing signals, no conversion.',
    lifecyclePhase: 'retention'
  },
  {
    name: 'Focused Evaluator',
    priority: 4,
    criteria: {
      breadth: { min: 2, max: 4 },
      depth: { min: 7 },
      clustering: { min: 7 },
      progression: { min: 6 }
    },
    description: 'Narrow, deep, high-progression behaviour.',
    lifecyclePhase: 'evaluation'
  },
  {
    name: 'Evaluator',
    priority: 5,
    criteria: {
      depth: { min: 6 },
      clustering: { min: 5 },
      progression: { min: 4, max: 6 }
    },
    description: 'Serious evaluation with depth and clustering.',
    lifecyclePhase: 'evaluation'
  },
  {
    name: 'Comparator',
    priority: 6,
    criteria: {
      breadth: { min: 4, max: 7 },
      depth: { min: 3, max: 5 },
      clustering: { min: 5 },
      progression: { min: 3, max: 5 }
    },
    description: 'Evaluating across competing options.',
    lifecyclePhase: 'evaluation'
  },
  {
    name: 'Stalled',
    priority: 7,
    criteria: {
      breadth: { min: 3, max: 6 },
      depth: { min: 4, max: 6 },
      progression: { max: 3 }
    },
    description: 'Moderate engagement with low progression and loops.',
    lifecyclePhase: 'evaluation'
  },
  {
    name: 'Scanner',
    priority: 8,
    criteria: {
      breadth: { min: 6 },
      depth: { max: 3 },
      clustering: { max: 3 }
    },
    description: 'Wide but shallow exploration.',
    lifecyclePhase: 'acquisition'
  },
  {
    name: 'Explorer',
    priority: 9,
    criteria: {
      breadth: { min: 4, max: 7 },
      depth: { min: 3, max: 6 }
    },
    description: 'Moderate exploration with emerging structure.',
    lifecyclePhase: 'acquisition'
  },
  {
    name: 'Mismatch',
    priority: 10,
    criteria: {
      breadth: { max: 2 },
      depth: { max: 2 },
      progression: { max: 0 }
    },
    description: 'Immediate exit or no meaningful engagement.',
    lifecyclePhase: 'acquisition'
  }
];

// ─── Action Mappings ────────────────────────────────────────────────
// Machine-readable action mappings used by the action resolver (src/action.js).
const ACTION_MAPPINGS = {
  'Mismatch': {
    action: 'Review traffic source quality and landing page relevance',
    metric: 'Reduction in Mismatch share; increase in sessions beyond first page',
    type: 'strategic',
    confidenceMinimum: 'low',
    automated: false
  },
  'Scanner': {
    action: 'Add guided entry and clearer value proposition above the fold',
    metric: 'Increase in deeper-session rate and evaluator-state share',
    type: 'ux_product',
    confidenceMinimum: 'medium',
    automated: false
  },
  'Explorer': {
    action: 'Strengthen pathways from discovery content into relevant offers',
    metric: 'Increase in clustered navigation and progression score',
    type: 'ux_product',
    confidenceMinimum: 'medium',
    automated: false
  },
  'Comparator': {
    action: 'Clarify differentiation, side-by-side proof, concise summaries',
    metric: 'Increase in focused evaluator or conversion rate',
    type: 'ux_product',
    confidenceMinimum: 'medium',
    automated: false
  },
  'Evaluator': {
    action: 'Add case studies, implementation details, FAQs, proof elements',
    metric: 'Increase in high-intent page views and conversion starts',
    type: 'content',
    confidenceMinimum: 'medium',
    automated: false
  },
  'Focused Evaluator': {
    action: 'Reduce distractions, shorten path to contact / purchase',
    metric: 'Increase in conversion completion rate',
    type: 'ux_product',
    confidenceMinimum: 'medium',
    automated: true
  },
  'Hesitant': {
    action: 'Reduce fields, clarify next step, add reassurance',
    metric: 'Form completion rate and drop-off reduction',
    type: 'ux_product_crm',
    confidenceMinimum: 'medium',
    automated: true
  },
  'Stalled': {
    action: 'Simplify navigation, reduce loops, add recommendation pathways',
    metric: 'Increase in forward progression, reduction in loops',
    type: 'ux_product',
    confidenceMinimum: 'medium',
    automated: false
  },
  'Stalled (Friction)': {
    action: 'Fix broken interactions: rage-clicks, dead-clicks, form errors, CLS',
    metric: 'Reduction in friction events; progression from blocked pages',
    type: 'ux_engineering',
    confidenceMinimum: 'medium',
    automated: false
  },
  'Returning Evaluator': {
    action: 'Reinforce differentiation and closing reassurance',
    metric: 'Increase in conversion among repeat visitors',
    type: 'content_crm',
    confidenceMinimum: 'high',
    automated: true
  },
  'Engaged': {
    action: 'Support onboarding, confirmation, post-conversion confidence',
    metric: 'Faster onboarding, reduced post-conversion abandonment',
    type: 'crm_product',
    confidenceMinimum: 'high',
    automated: true
  }
};

// ─── Motivation Definitions ─────────────────────────────────────────
const MOTIVATION_DEFINITIONS = {
  'curiosity-driven': {
    pattern: 'Broad exploration, low commitment, limited progression',
    actionModifier: 'Improve guided entry and value framing'
  },
  'value-driven': {
    pattern: 'Deep engagement with proof/outcome content',
    actionModifier: 'Surface outcomes, case studies, implementation detail'
  },
  'risk-sensitive': {
    pattern: 'Strong intent signals with hesitation before completion',
    actionModifier: 'Add reassurance (guarantees, proof, process clarity)'
  },
  'confusion-driven': {
    pattern: 'Repeated loops, switching, low forward movement',
    actionModifier: 'Simplify UX and next-step guidance'
  },
  'overload-sensitive': {
    pattern: 'Deep dwell and repeated review without progression',
    actionModifier: 'Reduce options and shorten decision path'
  },
  'urgency-driven': {
    pattern: 'Fast movement to high-intent with minimal exploration',
    actionModifier: 'Remove distractions, shorten conversion path'
  }
};

// ─── Sub-type Definitions ───────────────────────────────────────────
const SUBTYPE_DEFINITIONS = {
  'proof-focused': {
    pageTypes: ['case_study', 'testimonial', 'results'],
    depthShareThreshold: 0.5
  },
  'trust-focused': {
    pageTypes: ['about', 'team', 'credentials', 'reviews'],
    depthShareThreshold: 0.5
  },
  'price-focused': {
    pageTypes: ['pricing', 'comparison', 'plans'],
    depthShareThreshold: 0.4
  },
  'resource-seeking': {
    pageTypes: ['download', 'guide', 'tool', 'documentation'],
    depthShareThreshold: 0.5
  }
};

export {
  PAGE_TYPE_WEIGHTS,
  ACTION_WEIGHTS,
  ELEMENT_ROLE_WEIGHTS,
  SOURCE_BIAS,
  BREADTH_THRESHOLDS,
  DEPTH_TIME_THRESHOLDS,
  DEPTH_SCROLL_BONUS_THRESHOLD,
  CLUSTERING_CONFIG,
  TEMPORAL_THRESHOLDS,
  CONFIDENCE_CONFIG,
  STATE_DEFINITIONS,
  ACTION_MAPPINGS,
  MOTIVATION_DEFINITIONS,
  SUBTYPE_DEFINITIONS
};
