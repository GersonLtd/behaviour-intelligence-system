/**
 * Behaviour Intelligence System — Temporal Analysis Engine
 *
 * Evaluates behaviour across sessions: recency, frequency, velocity,
 * trend direction, and temporal state detection (Returning Evaluator,
 * Re-engaged Prospect, Persistent Hesitation, Chronic Stall).
 */

import { TEMPORAL_THRESHOLDS } from './config.js';

// ─── Recency Classification ────────────────────────────────────────

/**
 * Classify recency into a band based on days since last session.
 *
 * @param {number} daysSinceLastSession - Days since the user's last visit
 * @returns {string} Recency band label
 */
export function classifyRecency(daysSinceLastSession) {
  const bands = TEMPORAL_THRESHOLDS.recencyBands;

  if (daysSinceLastSession <= bands.highlyRecent)       return 'highly_recent';
  if (daysSinceLastSession <= bands.activeConsideration) return 'active_consideration';
  if (daysSinceLastSession <= bands.delayedReturn)       return 'delayed_return';
  return 'dormant';
}

// ─── Frequency Analysis ─────────────────────────────────────────────

/**
 * Count sessions within a time window.
 *
 * @param {Array<Object>} sessions - Sorted array of session records
 * @param {number} days            - Time window in days
 * @param {Date} [referenceDate]   - Date to count from (default: now)
 * @returns {number} Session count within window
 */
export function countSessionsInWindow(sessions, days, referenceDate = new Date()) {
  const cutoff = new Date(referenceDate);
  cutoff.setDate(cutoff.getDate() - days);

  return sessions.filter(s => new Date(s.sessionDate) >= cutoff).length;
}

// ─── Trend Direction ────────────────────────────────────────────────

/**
 * Calculate the trend direction across the most recent sessions.
 *
 * Examines the last 3 sessions (or fewer) and checks whether
 * progression and depth scores are increasing, consistent, or decaying.
 *
 * @param {Array<Object>} sessions - Sorted array of { sessionDate, breadth, depth, progression, clustering }
 * @returns {string} 'reinforcing' | 'increasing' | 'consistent' | 'decaying' | 'insufficient'
 */
export function calculateTrend(sessions) {
  if (sessions.length < 2) return 'insufficient';

  // Take the most recent 3 sessions
  const recent = sessions.slice(-3);
  const progressionValues = recent.map(s => s.progression);
  const depthValues = recent.map(s => s.depth);

  const progIncreasing = isNonDecreasing(progressionValues);
  const depthIncreasing = isNonDecreasing(depthValues);
  const progDecreasing = isNonIncreasing(progressionValues);

  if (progIncreasing && depthIncreasing)  return 'reinforcing';
  if (progIncreasing || depthIncreasing)  return 'increasing';
  if (progDecreasing)                     return 'decaying';
  return 'consistent';  // signals held steady across sessions
}

/**
 * Check if an array of values is non-decreasing (each ≤ next).
 * @param {number[]} values
 * @returns {boolean}
 */
function isNonDecreasing(values) {
  for (let i = 0; i < values.length - 1; i++) {
    if (values[i] > values[i + 1]) return false;
  }
  return true;
}

/**
 * Check if an array of values is non-increasing (each ≥ next).
 * @param {number[]} values
 * @returns {boolean}
 */
function isNonIncreasing(values) {
  for (let i = 0; i < values.length - 1; i++) {
    if (values[i] < values[i + 1]) return false;
  }
  return true;
}

// ─── Session Gap Detection ──────────────────────────────────────────

/**
 * Find the maximum gap (in days) between consecutive sessions.
 *
 * @param {Array<Object>} sessions - Sorted array of { sessionDate }
 * @returns {number} Maximum gap in days (0 if single session)
 */
export function maxSessionGap(sessions) {
  if (sessions.length < 2) return 0;

  let maxGap = 0;
  for (let i = 1; i < sessions.length; i++) {
    const prev = new Date(sessions[i - 1].sessionDate);
    const curr = new Date(sessions[i].sessionDate);
    const gapDays = (curr - prev) / (1000 * 60 * 60 * 24);
    if (gapDays > maxGap) maxGap = gapDays;
  }
  return Math.round(maxGap);
}

// ─── Velocity Classification ────────────────────────────────────────

/**
 * Classify the velocity of a user's movement toward action.
 *
 * @param {Object} params
 * @param {number} params.timeToFirstHighIntentMs - Time from session start to first high-intent event
 * @param {number} params.sessionCount             - Total sessions
 * @param {string} params.trend                    - Trend direction
 * @returns {string} 'high' | 'medium' | 'low'
 */
export function classifyVelocity(params) {
  const { timeToFirstHighIntentMs, sessionCount, trend } = params;

  // High: reaches high-intent action quickly in a single session
  if (sessionCount === 1 && timeToFirstHighIntentMs && timeToFirstHighIntentMs < 120000) {
    return 'high';
  }

  // Medium: increasing intent across a few sessions
  if (sessionCount <= 3 && (trend === 'increasing' || trend === 'reinforcing')) {
    return 'medium';
  }

  // Low: repeated evaluation without stronger action
  return 'low';
}

// ─── Full Temporal Assessment ───────────────────────────────────────

/**
 * Perform a complete temporal assessment for a user.
 *
 * Detects temporal states (Returning Evaluator, Re-engaged Prospect,
 * Persistent Hesitation, Chronic Stall) and calculates all temporal
 * metadata needed by the classifier and confidence modules.
 *
 * @param {Array<Object>} userHistory - All session records for this user, each containing:
 *   { sessionDate, state, breadth, depth, progression, clustering, conversionComplete }
 * @param {Date} [referenceDate] - Current date (default: now)
 * @returns {Object} Temporal assessment result
 */
export function assessTemporalContext(userHistory, referenceDate = new Date()) {
  if (!userHistory || userHistory.length === 0) {
    return {
      temporalState: null,
      recencyBand: 'dormant',
      sessionCount7d: 0,
      sessionCount30d: 0,
      trend: 'insufficient',
      velocity: 'low',
      daysSinceLastSession: Infinity,
      conversionComplete: false
    };
  }

  // Sort by date
  const sessions = [...userHistory].sort(
    (a, b) => new Date(a.sessionDate) - new Date(b.sessionDate)
  );

  const latest = sessions[sessions.length - 1];
  const daysSinceLast = Math.round(
    (referenceDate - new Date(latest.sessionDate)) / (1000 * 60 * 60 * 24)
  );

  // Core temporal metrics
  const recencyBand = classifyRecency(daysSinceLast);
  const sessionCount7d = countSessionsInWindow(sessions, 7, referenceDate);
  const sessionCount30d = countSessionsInWindow(sessions, 30, referenceDate);
  const trend = calculateTrend(sessions);
  const gap = maxSessionGap(sessions);
  const conversionComplete = sessions.some(s => s.conversionComplete);

  const velocity = classifyVelocity({
    timeToFirstHighIntentMs: latest.timeToFirstHighIntentMs,
    sessionCount: sessions.length,
    trend
  });

  // ── Detect temporal states ──

  let temporalState = null;
  const thresholds = TEMPORAL_THRESHOLDS;

  // Re-engaged Prospect: 30+ day gap, then return with medium-high signals
  if (sessions.length >= 2 && gap >= thresholds.reengagedProspect.gapDays) {
    if (daysSinceLast <= 7
        && latest.clustering >= thresholds.reengagedProspect.minClustering
        && latest.progression >= thresholds.reengagedProspect.minProgression) {
      temporalState = 'Re-engaged Prospect';
    }
  }

  // Returning Evaluator: multiple sessions with increasing signals, no conversion
  if (!temporalState && !conversionComplete) {
    const meetsFrequency =
      sessionCount7d >= thresholds.returningEvaluator.sessionsIn7Days ||
      sessionCount30d >= thresholds.returningEvaluator.sessionsIn30Days;

    if (meetsFrequency && (trend === 'increasing' || trend === 'reinforcing')) {
      temporalState = 'Returning Evaluator';
    }
  }

  // Persistent Hesitation: 2+ hesitant sessions within 14 days
  if (!temporalState) {
    const recentCutoff = new Date(referenceDate);
    recentCutoff.setDate(recentCutoff.getDate() - thresholds.persistentHesitation.withinDays);

    const hesitantSessions = sessions.filter(
      s => s.state === 'Hesitant' && new Date(s.sessionDate) >= recentCutoff
    );

    if (hesitantSessions.length >= thresholds.persistentHesitation.minHesitantSessions) {
      temporalState = 'Persistent Hesitation';
    }
  }

  // Chronic Stall: 3+ stalled sessions within 30 days, not improving
  if (!temporalState) {
    const stallCutoff = new Date(referenceDate);
    stallCutoff.setDate(stallCutoff.getDate() - thresholds.chronicStall.withinDays);

    const stalledSessions = sessions.filter(
      s => (s.state === 'Stalled' || s.state === 'Stalled (Friction)')
           && new Date(s.sessionDate) >= stallCutoff
    );

    if (stalledSessions.length >= thresholds.chronicStall.minStalledSessions
        && trend !== 'increasing'
        && trend !== 'reinforcing') {
      temporalState = 'Chronic Stall';
    }
  }

  return {
    temporalState,
    recencyBand,
    sessionCount7d,
    sessionCount30d,
    trend,
    velocity,
    daysSinceLastSession: daysSinceLast,
    conversionComplete,
    maxGapDays: gap,
    trendDirection: trend  // alias for confidence module
  };
}
