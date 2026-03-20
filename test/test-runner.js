/**
 * Behaviour Intelligence System — Test Runner
 *
 * Validates the classification pipeline against fixture data.
 * Run with: node --experimental-vm-modules test/test-runner.js
 *
 * Each fixture defines session data + expected output. The runner
 * scores signals, classifies, and checks the result against expectations.
 */

import { scoreAllSignals } from '../src/signals.js';
import { classifyByPriority } from '../src/classifier.js';
import { assessTemporalContext } from '../src/temporal.js';
import { calculateConfidence } from '../src/confidence.js';
import { applyRefinements } from '../src/refinements.js';
import fixtures from './fixtures.json' with { type: 'json' };

let passed = 0;
let failed = 0;
const failures = [];

for (const fixture of fixtures.fixtures) {
  const { id, sessionData, userHistory, expected } = fixture;

  try {
    // Step 1: Score signals
    const signals = scoreAllSignals(sessionData);

    // Step 2: Temporal assessment
    // Include the current session in temporal context, matching pipeline.js behaviour.
    const referenceDate = new Date('2026-03-19');
    const currentSession = {
      sessionDate: sessionData.sessionDate || referenceDate.toISOString(),
      breadth: signals.breadth,
      depth: signals.depth,
      progression: signals.progression,
      clustering: signals.clustering,
      conversionComplete: signals.progression >= 8
    };
    const temporal = assessTemporalContext(
      [...(userHistory || []), currentSession],
      referenceDate
    );

    // Step 3: Classify
    const classification = classifyByPriority(
      signals,
      temporal,
      sessionData.frictionSignals || null
    );

    // Step 4: Confidence
    const eventNames = new Set((sessionData.events || []).map(e => e.eventName));
    const confidence = calculateConfidence({
      signalTypesObserved: eventNames,
      sessionMeta: {
        engagementTimeSeconds: sessionData.depthMetrics?.engagementTimeSeconds || 0,
        pageCount: sessionData.breadthMetrics?.uniquePages || 0
      },
      actionFlags: {
        hasFormStart: eventNames.has('form_start'),
        hasFormSubmit: eventNames.has('form_submit'),
        hasBooking: eventNames.has('booking_click'),
        hasCtaClick: eventNames.has('cta_click')
      },
      stateClarity: {
        primaryFitPercent: classification.primaryFitPercent || 100,
        secondaryFitPercent: classification.secondaryFitPercent || 0
      },
      temporal: {
        sessionCount7d: temporal.sessionCount7d,
        sessionCount30d: temporal.sessionCount30d,
        trendDirection: temporal.trend
      },
      signals
    });

    // Check state
    const stateMatch = classification.state === expected.state;

    // Check confidence band
    const bandMatch = !expected.confidenceBand || confidence.band === expected.confidenceBand;

    // Check lifecycle phase
    const phaseMatch = !expected.lifecyclePhase || classification.lifecyclePhase === expected.lifecyclePhase;

    // Check temporal state (if expected)
    const temporalMatch = !expected.temporalState || temporal.temporalState === expected.temporalState;

    if (stateMatch && bandMatch && phaseMatch && temporalMatch) {
      passed++;
      console.log(`  PASS  ${id}: ${classification.state} (${confidence.band})`);
    } else {
      failed++;
      const details = [];
      if (!stateMatch) details.push(`state: got ${classification.state}, expected ${expected.state}`);
      if (!bandMatch) details.push(`confidence: got ${confidence.band}, expected ${expected.confidenceBand}`);
      if (!phaseMatch) details.push(`phase: got ${classification.lifecyclePhase}, expected ${expected.lifecyclePhase}`);
      if (!temporalMatch) details.push(`temporalState: got ${temporal.temporalState}, expected ${expected.temporalState}`);
      console.log(`  FAIL  ${id}: ${details.join('; ')}`);
      failures.push({
        id,
        signals,
        got: { state: classification.state, band: confidence.band, phase: classification.lifecyclePhase, score: confidence.score },
        expected
      });
    }
  } catch (err) {
    failed++;
    console.log(`  ERROR ${id}: ${err.message}`);
    failures.push({ id, error: err.message });
  }
}

console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed out of ${fixtures.fixtures.length}`);

if (failures.length > 0) {
  console.log(`\nFailure details:`);
  for (const f of failures) {
    console.log(JSON.stringify(f, null, 2));
  }
}

process.exit(failed > 0 ? 1 : 0);
