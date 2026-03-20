#!/usr/bin/env node

/**
 * Generate src/config.js from state-rules.yml
 *
 * Makes state-rules.yml the single source of truth for all thresholds,
 * weights, and state definitions. Run this after editing the YAML:
 *
 *   node tools/generate-config.js
 *
 * No external dependencies — uses simple line-by-line YAML parsing
 * (sufficient for the flat/regular structure of state-rules.yml).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const YAML_PATH = join(__dirname, '..', 'state-rules.yml');
const CONFIG_PATH = join(__dirname, '..', 'src', 'config.js');

const yaml = readFileSync(YAML_PATH, 'utf-8');
const lines = yaml.split('\n');

// ─── YAML Helpers ────────────────────────────────────────────────────

/** Get indent level (number of leading spaces). */
function indent(line) {
  const m = line.match(/^(\s*)/);
  return m ? m[1].length : 0;
}

/** Extract a flat key: numeric-value map from a top-level section. */
function extractFlatMap(sectionName) {
  const entries = {};
  let inSection = false;
  for (const line of lines) {
    if (/^\S/.test(line) && !line.startsWith('#')) {
      if (line.startsWith(sectionName + ':')) { inSection = true; continue; }
      if (inSection) break;
    }
    if (inSection) {
      const m = line.match(/^\s{2}(\w[\w-]*):\s+([0-9.-]+)/);
      if (m) entries[m[1]] = parseFloat(m[2]);
    }
  }
  return entries;
}

/** Extract source_bias (nested: key: { progression: N, depth: N }). */
function extractSourceBias() {
  const bias = {};
  let inSection = false;
  for (const line of lines) {
    if (/^source_bias:/.test(line)) { inSection = true; continue; }
    if (inSection && /^\S/.test(line) && !line.startsWith('#')) break;
    if (inSection) {
      const m = line.match(/^\s{2}([\w-]+):\s*\{\s*progression:\s*([0-9-]+),\s*depth:\s*([0-9-]+)\s*\}/);
      if (m) {
        bias[m[1]] = { progression: parseInt(m[2], 10), depth: parseInt(m[3], 10) };
      }
    }
  }
  return bias;
}

/** Extract breadth thresholds from signals.breadth.fixed_rule_thresholds. */
function extractBreadthThresholds() {
  const thresholds = [];
  let inBreadth = false;
  let inThresholds = false;
  for (const line of lines) {
    if (/^\s{2}breadth:/.test(line) && indent(line) === 2) { inBreadth = true; continue; }
    if (inBreadth && indent(line) === 2 && !line.startsWith('#') && line.trim()) { inBreadth = false; inThresholds = false; continue; }
    if (inBreadth && /fixed_rule_thresholds:/.test(line)) { inThresholds = true; continue; }
    if (inBreadth && inThresholds) {
      // - { max_pages: 1, score: 1 }
      const def = line.match(/default:\s*true.*score:\s*(\d+)/);
      if (def) {
        thresholds.push({ maxPages: Infinity, score: parseInt(def[1], 10) });
        continue;
      }
      const parts = {};
      const mp = line.match(/max_pages:\s*(\d+)/);
      if (mp) parts.maxPages = parseInt(mp[1], 10);
      const mt = line.match(/max_types:\s*(\d+)/);
      if (mt) parts.maxTypes = parseInt(mt[1], 10);
      const mint = line.match(/min_types:\s*(\d+)/);
      if (mint) parts.minTypes = parseInt(mint[1], 10);
      const sc = line.match(/score:\s*(\d+)/);
      if (sc) parts.score = parseInt(sc[1], 10);
      if (parts.maxPages !== undefined && parts.score !== undefined) {
        if (parts.maxTypes === undefined && parts.minTypes === undefined) {
          parts.maxTypes = Infinity;
        }
        thresholds.push(parts);
      }
    }
  }
  return thresholds;
}

/** Extract depth time thresholds and scroll bonus. */
function extractDepthThresholds() {
  const thresholds = [];
  let scrollBonus = 75;
  let inDepth = false;
  let inThresholds = false;
  let inBonuses = false;
  for (const line of lines) {
    if (/^\s{2}depth:/.test(line) && indent(line) === 2) { inDepth = true; continue; }
    if (inDepth && indent(line) === 2 && !line.startsWith('#') && line.trim()) { inDepth = false; inThresholds = false; inBonuses = false; continue; }
    if (inDepth && /fixed_rule_thresholds:/.test(line)) { inThresholds = true; inBonuses = false; continue; }
    if (inDepth && /bonuses:/.test(line)) { inBonuses = true; inThresholds = false; continue; }
    if (inDepth && inThresholds) {
      const def = line.match(/default:\s*true.*score:\s*(\d+)/);
      if (def) {
        thresholds.push({ maxSeconds: Infinity, score: parseInt(def[1], 10) });
        continue;
      }
      const ms = line.match(/max_seconds:\s*(\d+)/);
      const sc = line.match(/score:\s*(\d+)/);
      if (ms && sc) {
        thresholds.push({ maxSeconds: parseInt(ms[1], 10), score: parseInt(sc[1], 10) });
      }
    }
    if (inDepth && inBonuses) {
      const m = line.match(/avg_scroll_percent\s*>=\s*(\d+)/);
      if (m) scrollBonus = parseInt(m[1], 10);
    }
  }
  return { thresholds, scrollBonus };
}

/** Extract clustering config. */
function extractClusteringConfig() {
  const config = {};
  let inSwitch = false;
  let inRepeat = false;
  for (const line of lines) {
    if (/switch_penalty:/.test(line)) { inSwitch = true; inRepeat = false; continue; }
    if (/repeat_bonus:/.test(line)) { inRepeat = true; inSwitch = false; continue; }
    if (inSwitch) {
      const cap = line.match(/cap:\s*(\d+)/);
      if (cap) { config.switchPenaltyCap = parseInt(cap[1], 10); }
      const mp = line.match(/min_pages_for_penalty:\s*(\d+)/);
      if (mp) { config.minPagesForPenalty = parseInt(mp[1], 10); inSwitch = false; }
    }
    if (inRepeat) {
      const cap = line.match(/cap:\s*(\d+)/);
      if (cap) { config.repeatBonusCap = parseInt(cap[1], 10); inRepeat = false; }
    }
  }
  return config;
}

/** Extract temporal thresholds. */
function extractTemporalThresholds() {
  // Returning Evaluator (sourced from temporal_requirements under the state definition)
  let sessionsIn7Days, sessionsIn30Days;
  // Re-engaged prospect
  let gapDays, minClusteringRE, minProgressionRE;
  // Persistent hesitation
  let minHesitantSessions, hesitantWithinDays;
  // Chronic stall
  let minStalledSessions, stalledWithinDays;
  // Recency bands
  const recency = {};

  // First pass: extract sessions_7d/30d from temporal_requirements under states
  let inTemporalReqs = false;
  for (const line of lines) {
    if (/temporal_requirements:/.test(line)) { inTemporalReqs = true; continue; }
    if (inTemporalReqs && /^\s{4}\S/.test(line) && !/sessions_|trend/.test(line)) { inTemporalReqs = false; continue; }
    if (inTemporalReqs) {
      const s7 = line.match(/sessions_7d:\s*\{\s*min:\s*(\d+)/);
      if (s7) sessionsIn7Days = parseInt(s7[1], 10);
      const s30 = line.match(/sessions_30d:\s*\{\s*min:\s*(\d+)/);
      if (s30) sessionsIn30Days = parseInt(s30[1], 10);
    }
  }

  // Parse temporal_states and recency_bands using a simple sub-section
  // tracker. Each indent-2 key within temporal_states is a sub-section.
  let topSection = null;   // 'temporal_states' or 'recency_bands'
  let subSection = null;   // 're_engaged_prospect', 'persistent_hesitation', etc.

  for (const line of lines) {
    // Top-level section detection
    if (/^temporal_states:/.test(line)) { topSection = 'temporal_states'; subSection = null; continue; }
    if (/^recency_bands:/.test(line)) { topSection = 'recency_bands'; subSection = null; continue; }
    if (/^\S/.test(line) && !line.startsWith('#') && topSection) {
      topSection = null; subSection = null; continue;
    }
    if (!topSection) continue;

    // Sub-section detection (indent-2 keys within temporal_states)
    if (topSection === 'temporal_states') {
      const subMatch = line.match(/^\s{2}(\w+):\s*$/);
      if (subMatch) { subSection = subMatch[1]; continue; }

      if (subSection === 're_engaged_prospect') {
        const gd = line.match(/gap_days:\s*(\d+)/);
        if (gd) gapDays = parseInt(gd[1], 10);
        const mc = line.match(/min_clustering:\s*(\d+)/);
        if (mc) minClusteringRE = parseInt(mc[1], 10);
        const mp = line.match(/min_progression:\s*(\d+)/);
        if (mp) minProgressionRE = parseInt(mp[1], 10);
      }
      if (subSection === 'persistent_hesitation') {
        const mh = line.match(/min_hesitant_sessions:\s*(\d+)/);
        if (mh) minHesitantSessions = parseInt(mh[1], 10);
        const wd = line.match(/within_days:\s*(\d+)/);
        if (wd) hesitantWithinDays = parseInt(wd[1], 10);
      }
      if (subSection === 'chronic_stall') {
        const ms = line.match(/min_stalled_sessions:\s*(\d+)/);
        if (ms) minStalledSessions = parseInt(ms[1], 10);
        const wd = line.match(/within_days:\s*(\d+)/);
        if (wd) stalledWithinDays = parseInt(wd[1], 10);
      }
    }

    if (topSection === 'recency_bands') {
      const hr = line.match(/highly_recent:\s*\{\s*max_days:\s*(\d+)/);
      if (hr) recency.highlyRecent = parseInt(hr[1], 10);
      const ac = line.match(/active_consideration:\s*\{\s*max_days:\s*(\d+)/);
      if (ac) recency.activeConsideration = parseInt(ac[1], 10);
      const dr = line.match(/delayed_return:\s*\{\s*max_days:\s*(\d+)/);
      if (dr) recency.delayedReturn = parseInt(dr[1], 10);
    }
  }

  return {
    returningEvaluator: { sessionsIn7Days, sessionsIn30Days },
    reengagedProspect: { gapDays, minClustering: minClusteringRE, minProgression: minProgressionRE },
    persistentHesitation: { minHesitantSessions, withinDays: hesitantWithinDays },
    chronicStall: { minStalledSessions, withinDays: stalledWithinDays },
    recencyBands: recency
  };
}

/** Extract confidence config. */
function extractConfidenceConfig() {
  const bands = {};
  let hybridThreshold = 70;
  let hybridPenalty = 1;
  let inConfidence = false;
  let inBands = false;

  for (const line of lines) {
    if (/^confidence:/.test(line)) { inConfidence = true; continue; }
    if (inConfidence && /^\S/.test(line) && !line.startsWith('#')) { inConfidence = false; continue; }
    if (inConfidence && /^\s{2}bands:/.test(line)) { inBands = true; continue; }
    if (inBands && /^\s{2}\S/.test(line) && !/bands/.test(line)) { inBands = false; }
    if (inBands) {
      const m = line.match(/(\w+):\s*\{\s*min:\s*(\d+),\s*max:\s*(\d+)\s*\}/);
      if (m) bands[m[1]] = { min: parseInt(m[2], 10), max: parseInt(m[3], 10) };
    }
    if (inConfidence) {
      const ht = line.match(/hybrid_threshold_percent:\s*(\d+)/);
      if (ht) hybridThreshold = parseInt(ht[1], 10);
      const hp = line.match(/hybrid_penalty:\s*(-?\d+)/);
      if (hp) hybridPenalty = parseInt(hp[1], 10);
    }
  }

  return { bands, hybridThresholdPercent: hybridThreshold, hybridPenalty };
}

/** Extract state definitions. */
function extractStates() {
  const states = [];
  let inStates = false;
  let current = null;
  let inCriteria = false;
  let inSubSection = false; // temporal_requirements, sub_types, etc.

  for (const line of lines) {
    if (/^states:/.test(line)) { inStates = true; continue; }
    if (inStates && /^\S/.test(line) && !line.startsWith('#')) { inStates = false; }
    if (!inStates) continue;

    const nameMatch = line.match(/^\s{2}-\s*name:\s*(.+)/);
    if (nameMatch) {
      if (current) states.push(current);
      current = { name: nameMatch[1].trim().replace(/^["']|["']$/g, ''), criteria: {} };
      inCriteria = false;
      inSubSection = false;
      continue;
    }
    if (!current) continue;

    const prio = line.match(/^\s+priority:\s*(\d+)/);
    if (prio) { current.priority = parseInt(prio[1], 10); inCriteria = false; inSubSection = false; continue; }

    const phase = line.match(/^\s+lifecycle_phase:\s*(\w+)/);
    if (phase) { current.lifecyclePhase = phase[1]; inCriteria = false; inSubSection = false; continue; }

    const desc = line.match(/^\s+description:\s*"(.+)"/);
    if (desc) { current.description = desc[1]; inCriteria = false; inSubSection = false; continue; }

    // Track whether we're inside "criteria:" vs other sub-sections
    if (/^\s{4}criteria:\s*$/.test(line)) { inCriteria = true; inSubSection = false; continue; }
    if (/^\s{4}(temporal_requirements|sub_types):\s*$/.test(line)) { inSubSection = true; inCriteria = false; continue; }

    // Only parse criteria lines when we're inside the criteria block
    if (!inCriteria) continue;

    // Criteria lines like: breadth: { min: 2, max: 4 }
    const crit = line.match(/^\s{6}(\w+):\s*\{\s*(.+)\}/);
    if (crit) {
      const key = crit[1];
      const vals = {};
      const minM = crit[2].match(/min:\s*(\d+)/);
      if (minM) vals.min = parseInt(minM[1], 10);
      const maxM = crit[2].match(/max:\s*(\d+)/);
      if (maxM) vals.max = parseInt(maxM[1], 10);
      current.criteria[key] = vals;
      continue;
    }

    // Simple criteria: temporal: true or conversion_complete: false
    const simpleCrit = line.match(/^\s{6}(\w+):\s*(true|false)/);
    if (simpleCrit) {
      current.criteria[simpleCrit[1] === 'conversion_complete' ? 'conversionComplete' : simpleCrit[1]] =
        simpleCrit[2] === 'true';
    }
  }
  if (current) states.push(current);
  return states;
}

/** Extract action mappings. */
function extractActions() {
  const actions = {};
  let inActions = false;
  let currentState = null;

  for (const line of lines) {
    if (/^actions:/.test(line)) { inActions = true; continue; }
    if (inActions && /^\S/.test(line) && !line.startsWith('#')) { inActions = false; }
    if (!inActions) continue;

    // State name (2-indent key)
    const stateMatch = line.match(/^\s{2}(["']?.+?["']?):\s*$/);
    if (stateMatch) {
      currentState = stateMatch[1].replace(/^["']|["']$/g, '');
      actions[currentState] = {};
      continue;
    }
    if (!currentState) continue;

    const actionM = line.match(/^\s{4}action:\s*"(.+)"/);
    if (actionM) { actions[currentState].action = actionM[1]; continue; }
    const metricM = line.match(/^\s{4}metric:\s*"(.+)"/);
    if (metricM) { actions[currentState].metric = metricM[1]; continue; }
    const typeM = line.match(/^\s{4}type:\s*(\S+)/);
    if (typeM) { actions[currentState].type = typeM[1]; continue; }
    const confM = line.match(/^\s{4}confidence_minimum:\s*(\w+)/);
    if (confM) { actions[currentState].confidenceMinimum = confM[1]; continue; }
    const autoM = line.match(/^\s{4}automated:\s*(true|false)/);
    if (autoM) { actions[currentState].automated = autoM[1] === 'true'; continue; }
  }
  return actions;
}

/** Extract motivation definitions. */
function extractMotivations() {
  const motivations = {};
  let inSection = false;
  let inCategories = false;
  let currentKey = null;

  for (const line of lines) {
    if (/^motivation:/.test(line)) { inSection = true; continue; }
    if (inSection && /^\S/.test(line) && !line.startsWith('#')) { inSection = false; inCategories = false; }
    if (!inSection) continue;

    if (/^\s{2}categories:/.test(line)) { inCategories = true; continue; }
    if (!inCategories) continue;

    const keyM = line.match(/^\s{4}([\w-]+):\s*$/);
    if (keyM) { currentKey = keyM[1]; motivations[currentKey] = {}; continue; }
    if (!currentKey) continue;

    const patternM = line.match(/^\s{6}pattern:\s*"(.+)"/);
    if (patternM) { motivations[currentKey].pattern = patternM[1]; continue; }
    const modM = line.match(/^\s{6}action_modifier:\s*"(.+)"/);
    if (modM) { motivations[currentKey].actionModifier = modM[1]; continue; }
  }
  return motivations;
}

/** Extract sub-type definitions. */
function extractSubTypes() {
  const subTypes = {};
  let inSection = false;
  let currentKey = null;

  for (const line of lines) {
    if (/^sub_types:/.test(line)) { inSection = true; continue; }
    if (inSection && /^\S/.test(line) && !line.startsWith('#')) { inSection = false; }
    if (!inSection) continue;

    const keyM = line.match(/^\s{2}([\w-]+):\s*$/);
    if (keyM) { currentKey = keyM[1]; subTypes[currentKey] = {}; continue; }
    if (!currentKey) continue;

    const ptM = line.match(/^\s{4}page_types:\s*\[(.+)\]/);
    if (ptM) {
      subTypes[currentKey].pageTypes = ptM[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
      continue;
    }
    const dtM = line.match(/^\s{4}depth_share_threshold:\s*([0-9.]+)/);
    if (dtM) { subTypes[currentKey].depthShareThreshold = parseFloat(dtM[1]); continue; }
  }
  return subTypes;
}

// ─── Extract everything ──────────────────────────────────────────────

const pageTypeWeights = extractFlatMap('page_type_weights');
const actionWeights = extractFlatMap('action_weights');
const elementWeights = extractFlatMap('element_weights');
const sourceBias = extractSourceBias();
const breadthThresholds = extractBreadthThresholds();
const { thresholds: depthThresholds, scrollBonus } = extractDepthThresholds();
const clusteringConfig = extractClusteringConfig();
const temporalThresholds = extractTemporalThresholds();
const confidenceConfig = extractConfidenceConfig();
const stateDefinitions = extractStates();
const actionMappings = extractActions();
const motivations = extractMotivations();
const subTypes = extractSubTypes();

// ─── Generate config.js ──────────────────────────────────────────────

function toJS(obj, indentLevel = 0) {
  return JSON.stringify(obj, (_, v) => v === Infinity ? '__INFINITY__' : v, 2)
    .replace(/"__INFINITY__"/g, 'Infinity')
    .replace(/^/gm, '  '.repeat(indentLevel));
}

/** Format a number preserving .0 for values that had it in the YAML. */
function fmtNum(v) {
  // If the number is a whole number but originally had a decimal, keep .0
  // We always output with one decimal place for weights to match the original style
  if (Number.isInteger(v) && v !== 0) return v.toFixed(1);
  return String(v);
}

/** Format a flat object as aligned key: value pairs. */
function formatFlatObj(obj, indent = '  ') {
  const maxKeyLen = Math.max(...Object.keys(obj).map(k => k.length));
  return Object.entries(obj)
    .map(([k, v]) => `${indent}${k}:${' '.repeat(maxKeyLen - k.length + 1)}${fmtNum(v)}`)
    .join(',\n');
}

/** Format source bias with nested objects. */
function formatSourceBias(obj) {
  const maxKeyLen = Math.max(...Object.keys(obj).map(k => k.length));
  return Object.entries(obj)
    .map(([k, v]) => `  ${k}:${' '.repeat(maxKeyLen - k.length + 1)}{ progression: ${v.progression},  depth: ${v.depth} }`)
    .join(',\n');
}

const breadthJS = breadthThresholds.map(t => {
  const parts = [`maxPages: ${t.maxPages === Infinity ? 'Infinity' : t.maxPages}`];
  if (t.maxTypes !== undefined) parts.push(`maxTypes: ${t.maxTypes === Infinity ? 'Infinity' : t.maxTypes}`);
  if (t.minTypes !== undefined) parts.push(`minTypes: ${t.minTypes}`);
  parts.push(`score: ${t.score}`);
  return `  { ${parts.join(', ')} }`;
}).join(',\n');

const depthJS = depthThresholds.map(t =>
  `  { maxSeconds: ${t.maxSeconds === Infinity ? 'Infinity' : t.maxSeconds}, score: ${t.score} }`
).join(',\n');

const statesJS = stateDefinitions.map(s => {
  const criteriaEntries = Object.entries(s.criteria).map(([k, v]) => {
    if (typeof v === 'boolean') return `      ${k}: ${v}`;
    const parts = [];
    if (v.min !== undefined) parts.push(`min: ${v.min}`);
    if (v.max !== undefined) parts.push(`max: ${v.max}`);
    return `      ${k}: { ${parts.join(', ')} }`;
  }).join(',\n');

  return `  {
    name: '${s.name}',
    priority: ${s.priority},
    criteria: {
${criteriaEntries}
    },
    description: '${s.description}',
    lifecyclePhase: '${s.lifecyclePhase}'
  }`;
}).join(',\n');

const actionsJS = Object.entries(actionMappings).map(([state, cfg]) => {
  return `  '${state}': {
    action: '${cfg.action}',
    metric: '${cfg.metric}',
    type: '${cfg.type}',
    confidenceMinimum: '${cfg.confidenceMinimum}',
    automated: ${cfg.automated}
  }`;
}).join(',\n');

const motivationsJS = Object.entries(motivations).map(([key, cfg]) => {
  return `  '${key}': {
    pattern: '${cfg.pattern}',
    actionModifier: '${cfg.actionModifier}'
  }`;
}).join(',\n');

const subTypesJS = Object.entries(subTypes).map(([key, cfg]) => {
  return `  '${key}': {
    pageTypes: [${cfg.pageTypes.map(p => `'${p}'`).join(', ')}],
    depthShareThreshold: ${cfg.depthShareThreshold}
  }`;
}).join(',\n');

const output = `/**
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
${formatFlatObj(pageTypeWeights)}
};

// ─── Action Strength Weights ────────────────────────────────────────
// How strongly each event type indicates intent.
const ACTION_WEIGHTS = {
${formatFlatObj(actionWeights)}
};

// ─── Traffic Source Bias ────────────────────────────────────────────
// Adjustments to baseline scores based on traffic source.
// Applied before behavioural signals take over.
const SOURCE_BIAS = {
${formatSourceBias(sourceBias)}
};

// ─── Element Role Weights ────────────────────────────────────────────
// Default weights for element-level micro-signals (CMS-first model).
// When an element carries a data-element-role but no explicit weight,
// this lookup provides the default. Overridden by explicit element_weight.
const ELEMENT_ROLE_WEIGHTS = {
${formatFlatObj(elementWeights)}
};

// ─── Breadth Score Thresholds (Fixed-Rule) ──────────────────────────
// Maps raw page/type counts to a 0–10 score.
const BREADTH_THRESHOLDS = [
${breadthJS}
];

// ─── Depth Score Thresholds (Fixed-Rule) ────────────────────────────
// Maps engagement time to base depth score. Bonuses added separately.
const DEPTH_TIME_THRESHOLDS = [
${depthJS}
];

const DEPTH_SCROLL_BONUS_THRESHOLD = ${scrollBonus};  // avg_scroll_percent >= this → +1

// ─── Clustering Configuration ───────────────────────────────────────
const CLUSTERING_CONFIG = {
  switchPenaltyCap: ${clusteringConfig.switchPenaltyCap},         // max penalty from topic switches
  repeatBonusCap: ${clusteringConfig.repeatBonusCap},           // max bonus from repeat cluster returns
  minPagesForPenalty: ${clusteringConfig.minPagesForPenalty}        // signal floor: no switch penalty below this
};

// ─── Temporal Thresholds ────────────────────────────────────────────
const TEMPORAL_THRESHOLDS = {
  returningEvaluator: {
    sessionsIn7Days: ${temporalThresholds.returningEvaluator.sessionsIn7Days},
    sessionsIn30Days: ${temporalThresholds.returningEvaluator.sessionsIn30Days}
  },
  reengagedProspect: {
    gapDays: ${temporalThresholds.reengagedProspect.gapDays},
    minClustering: ${temporalThresholds.reengagedProspect.minClustering},
    minProgression: ${temporalThresholds.reengagedProspect.minProgression}
  },
  persistentHesitation: {
    minHesitantSessions: ${temporalThresholds.persistentHesitation.minHesitantSessions},
    withinDays: ${temporalThresholds.persistentHesitation.withinDays}
  },
  chronicStall: {
    minStalledSessions: ${temporalThresholds.chronicStall.minStalledSessions},
    withinDays: ${temporalThresholds.chronicStall.withinDays}
  },
  recencyBands: {
    highlyRecent:       ${temporalThresholds.recencyBands.highlyRecent},   // 0–${temporalThresholds.recencyBands.highlyRecent} days
    activeConsideration: ${temporalThresholds.recencyBands.activeConsideration},  // ${temporalThresholds.recencyBands.highlyRecent + 1}–${temporalThresholds.recencyBands.activeConsideration} days
    delayedReturn:      ${temporalThresholds.recencyBands.delayedReturn},  // ${temporalThresholds.recencyBands.activeConsideration + 1}–${temporalThresholds.recencyBands.delayedReturn} days
    // ${temporalThresholds.recencyBands.delayedReturn}+ = dormant
  }
};

// ─── Confidence Scoring ─────────────────────────────────────────────
const CONFIDENCE_CONFIG = {
  bands: {
    low:    { min: ${confidenceConfig.bands.low.min}, max: ${confidenceConfig.bands.low.max} },
    medium: { min: ${confidenceConfig.bands.medium.min}, max: ${confidenceConfig.bands.medium.max} },
    high:   { min: ${confidenceConfig.bands.high.min}, max: ${confidenceConfig.bands.high.max} }
  },
  // Minimum signal types required for reliable classification
  minSignalsForClassification: 3,
  // Hybrid state threshold: primary must account for ≥ this %
  hybridThresholdPercent: ${confidenceConfig.hybridThresholdPercent},
  // Hybrid ambiguity penalty (applied when primary is below threshold)
  hybridPenalty: ${confidenceConfig.hybridPenalty}
  // Contradiction penalties are implemented directly in confidence.js
  // (depth >= 7 + progression <= 2 + breadth >= 5 = -1;
  //  breadth >= 8 + depth <= 2 = -1)
};

// ─── State Definitions ──────────────────────────────────────────────
// Priority order (index = priority, lower = higher priority).
// Each state includes its signal criteria for classification.
const STATE_DEFINITIONS = [
${statesJS}
];

// ─── Action Mappings ────────────────────────────────────────────────
// Machine-readable action mappings used by the action resolver (src/action.js).
const ACTION_MAPPINGS = {
${actionsJS}
};

// ─── Motivation Definitions ─────────────────────────────────────────
const MOTIVATION_DEFINITIONS = {
${motivationsJS}
};

// ─── Sub-type Definitions ───────────────────────────────────────────
const SUBTYPE_DEFINITIONS = {
${subTypesJS}
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
`;

writeFileSync(CONFIG_PATH, output, 'utf-8');
console.log('Generated src/config.js from state-rules.yml');
