/**
 * Validate state-rules.yml against src/config.js
 *
 * Ensures the human-readable YAML reference stays in sync with the runtime
 * config that the application actually consumes. Uses simple line-by-line
 * parsing — no external YAML library required.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  PAGE_TYPE_WEIGHTS,
  ACTION_WEIGHTS,
  CLUSTERING_CONFIG,
  CONFIDENCE_CONFIG,
  STATE_DEFINITIONS
} from '../src/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const yamlPath = join(__dirname, '..', 'state-rules.yml');
const yaml = readFileSync(yamlPath, 'utf-8');
const lines = yaml.split('\n');

// ─── Test harness ──────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err.message}`);
  }
}

// ─── Helpers ───────────────────────────────────────────────────────

/**
 * Extract a simple "key: value" from the YAML after a section header.
 * Looks for lines like "  homepage: 0.5" within a named section.
 */
function extractSection(sectionName) {
  const entries = {};
  let inSection = false;
  for (const line of lines) {
    // Match top-level section header (no leading whitespace)
    if (/^\S/.test(line) && !line.startsWith('#')) {
      if (line.startsWith(sectionName + ':')) {
        inSection = true;
        continue;
      } else if (inSection) {
        break; // left the section
      }
    }
    if (inSection) {
      // Match "  key: value" (simple scalar)
      const m = line.match(/^\s{2}(\w+):\s+([0-9.-]+)/);
      if (m) {
        entries[m[1]] = parseFloat(m[2]);
      }
    }
  }
  return entries;
}

/**
 * Extract state names from the YAML states section.
 * Matches lines like "  - name: Engaged" or "  - name: Returning Evaluator"
 */
function extractStateNames() {
  const names = [];
  for (const line of lines) {
    const m = line.match(/^  - name:\s+(.+)/);
    if (m) {
      names.push(m[1].trim().replace(/^["']|["']$/g, ''));
    }
  }
  return names;
}

/**
 * Extract confidence band boundaries from the YAML.
 * Matches lines like "    low:    { min: 0, max: 3 }"
 */
function extractConfidenceBands() {
  const bands = {};
  let inConfidence = false;
  let inBands = false;
  for (const line of lines) {
    if (/^confidence:/.test(line)) { inConfidence = true; continue; }
    if (inConfidence && /^\S/.test(line) && !line.startsWith('#')) { inConfidence = false; inBands = false; continue; }
    if (inConfidence && /^\s{2}bands:/.test(line)) { inBands = true; continue; }
    if (inBands && /^\s{2}\S/.test(line) && !/^\s{2}bands:/.test(line)) { inBands = false; continue; }
    if (inBands) {
      const m = line.match(/^\s+(\w+):\s*\{\s*min:\s*(\d+),\s*max:\s*(\d+)\s*\}/);
      if (m) {
        bands[m[1]] = { min: parseInt(m[2], 10), max: parseInt(m[3], 10) };
      }
    }
  }
  return bands;
}

/**
 * Extract clustering config values from the YAML.
 */
function extractClusteringConfig() {
  let inClustering = false;
  const config = {};
  for (const line of lines) {
    if (/^\s{2}clustering:/.test(line) || /^\s{4}clustering:/.test(line)) {
      // Could be the signal section — check if it's the right one
    }
    // switch_penalty cap
    const switchCap = line.match(/^\s+switch_penalty:/);
    if (switchCap) { inClustering = true; continue; }
    if (inClustering) {
      const capMatch = line.match(/^\s+cap:\s*(\d+)/);
      if (capMatch && config.switchPenaltyCap === undefined) {
        config.switchPenaltyCap = parseInt(capMatch[1], 10);
        continue;
      }
      const minPages = line.match(/^\s+min_pages_for_penalty:\s*(\d+)/);
      if (minPages) {
        config.minPagesForPenalty = parseInt(minPages[1], 10);
        inClustering = false;
        continue;
      }
    }
    const repeatCap = line.match(/^\s+repeat_bonus:/);
    if (repeatCap) { inClustering = true; continue; }
    if (inClustering) {
      const capMatch = line.match(/^\s+cap:\s*(\d+)/);
      if (capMatch && config.repeatBonusCap === undefined) {
        config.repeatBonusCap = parseInt(capMatch[1], 10);
        inClustering = false;
        continue;
      }
    }
  }
  return config;
}

// ─── Tests ─────────────────────────────────────────────────────────

// 1. All 10 state names exist in both files
test('All 10 state names exist in both files', () => {
  const yamlNames = extractStateNames();
  const configNames = STATE_DEFINITIONS.map(s => s.name);
  assert.equal(yamlNames.length, 10, `Expected 10 YAML states, got ${yamlNames.length}`);
  assert.equal(configNames.length, 10, `Expected 10 config states, got ${configNames.length}`);
  for (const name of configNames) {
    assert.ok(yamlNames.includes(name), `State "${name}" missing from state-rules.yml`);
  }
  for (const name of yamlNames) {
    assert.ok(configNames.includes(name), `State "${name}" missing from config.js`);
  }
});

// 2. Page type weights match (homepage, pricing, contact at minimum)
test('Page type weights match (homepage, pricing, contact)', () => {
  const yamlWeights = extractSection('page_type_weights');
  for (const key of ['homepage', 'pricing', 'contact']) {
    assert.ok(key in yamlWeights, `"${key}" missing from YAML page_type_weights`);
    assert.ok(key in PAGE_TYPE_WEIGHTS, `"${key}" missing from config PAGE_TYPE_WEIGHTS`);
    assert.equal(yamlWeights[key], PAGE_TYPE_WEIGHTS[key],
      `page_type_weights.${key}: YAML=${yamlWeights[key]}, config=${PAGE_TYPE_WEIGHTS[key]}`);
  }
});

// 3. Action weights match (cta_click, form_start, form_submit at minimum)
test('Action weights match (cta_click, form_start, form_submit)', () => {
  const yamlWeights = extractSection('action_weights');
  for (const key of ['cta_click', 'form_start', 'form_submit']) {
    assert.ok(key in yamlWeights, `"${key}" missing from YAML action_weights`);
    assert.ok(key in ACTION_WEIGHTS, `"${key}" missing from config ACTION_WEIGHTS`);
    assert.equal(yamlWeights[key], ACTION_WEIGHTS[key],
      `action_weights.${key}: YAML=${yamlWeights[key]}, config=${ACTION_WEIGHTS[key]}`);
  }
});

// 4. Confidence band boundaries match
test('Confidence band boundaries match', () => {
  const yamlBands = extractConfidenceBands();
  for (const band of ['low', 'medium', 'high']) {
    assert.ok(band in yamlBands, `"${band}" band missing from YAML`);
    assert.ok(band in CONFIDENCE_CONFIG.bands, `"${band}" band missing from config`);
    assert.deepStrictEqual(yamlBands[band], CONFIDENCE_CONFIG.bands[band],
      `confidence.bands.${band}: YAML=${JSON.stringify(yamlBands[band])}, config=${JSON.stringify(CONFIDENCE_CONFIG.bands[band])}`);
  }
});

// 5. Clustering config values match
test('Clustering config values match (switchPenaltyCap, repeatBonusCap, minPagesForPenalty)', () => {
  const yamlClustering = extractClusteringConfig();
  assert.equal(yamlClustering.switchPenaltyCap, CLUSTERING_CONFIG.switchPenaltyCap,
    `switchPenaltyCap: YAML=${yamlClustering.switchPenaltyCap}, config=${CLUSTERING_CONFIG.switchPenaltyCap}`);
  assert.equal(yamlClustering.repeatBonusCap, CLUSTERING_CONFIG.repeatBonusCap,
    `repeatBonusCap: YAML=${yamlClustering.repeatBonusCap}, config=${CLUSTERING_CONFIG.repeatBonusCap}`);
  assert.equal(yamlClustering.minPagesForPenalty, CLUSTERING_CONFIG.minPagesForPenalty,
    `minPagesForPenalty: YAML=${yamlClustering.minPagesForPenalty}, config=${CLUSTERING_CONFIG.minPagesForPenalty}`);
});

// ─── Summary ───────────────────────────────────────────────────────

console.log();
if (failed > 0) {
  console.log(`Validation results: ${passed} passed, ${failed} failed`);
  process.exit(1);
} else {
  console.log(`Validation results: ${passed} passed, 0 failed`);
}
