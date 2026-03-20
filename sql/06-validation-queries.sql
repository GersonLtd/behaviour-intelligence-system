-- ============================================================================
-- Behaviour Intelligence System — Validation Queries
-- ============================================================================
-- Run these queries after deployment to verify the pipeline is working
-- correctly. Not materialised views — run manually or on a schedule.
-- ============================================================================


-- ── 1. Element weight impact verification ──
-- Compares progression scores for sessions WITH element weights vs WITHOUT.
-- Expect: sessions with element_weight > page_weight should have higher progression.

SELECT
  CASE
    WHEN MAX(e.element_weight) IS NOT NULL THEN 'has_element_weight'
    ELSE 'page_weight_only'
  END AS weight_source,
  COUNT(DISTINCT CONCAT(s.user_pseudo_id, '-', CAST(s.session_id AS STRING))) AS session_count,
  ROUND(AVG(s.progression_score), 1) AS avg_progression,
  ROUND(AVG(s.depth_score), 1) AS avg_depth,
  ROUND(AVG(s.confidence_score), 1) AS avg_confidence
FROM `your-project.your_dataset.signal_scores` s
LEFT JOIN (
  SELECT DISTINCT user_pseudo_id, session_id, element_weight
  FROM `your-project.your_dataset.signal_scores`
  WHERE element_weight IS NOT NULL
) e ON s.user_pseudo_id = e.user_pseudo_id AND s.session_id = e.session_id
GROUP BY 1;


-- ── 2. CMS metadata coverage ──
-- What percentage of events carry CMS-embedded metadata vs fallback?

SELECT
  CASE
    WHEN cms_page_type IS NOT NULL THEN 'CMS-embedded'
    WHEN page_type != 'Unknown' THEN 'External register fallback'
    ELSE 'Untagged (default)'
  END AS metadata_source,
  COUNT(*) AS event_count,
  ROUND(COUNT(*) / SUM(COUNT(*)) OVER() * 100, 1) AS percent_of_events
FROM (
  SELECT
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_type') AS cms_page_type,
    COALESCE(
      (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_type'),
      'Unknown'
    ) AS page_type
  FROM `your-project.analytics_123456.events_*`
  WHERE _TABLE_SUFFIX BETWEEN
    FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY))
    AND FORMAT_DATE('%Y%m%d', CURRENT_DATE())
    AND event_name = 'page_view'
)
GROUP BY 1
ORDER BY event_count DESC;


-- ── 3. Source bias impact verification ──
-- Compares progression scores by traffic source.
-- Expect: direct and paid_search slightly higher than organic; social slightly lower.

SELECT
  traffic_source_group,
  COUNT(*) AS session_count,
  ROUND(AVG(progression_score), 1) AS avg_progression,
  ROUND(AVG(raw_progression_sum), 1) AS avg_raw_progression_before_bias
FROM `your-project.your_dataset.signal_scores`
GROUP BY 1
ORDER BY avg_progression DESC;


-- ── 4. Friction signal coverage ──
-- How many sessions have friction events?
-- Friction thresholds mirrored in: src/classifier.js hasFriction(), sql/02-state-classification.sql

SELECT
  CASE
    WHEN rage_clicks >= 3 OR dead_clicks >= 2 OR form_errors >= 2 THEN 'friction_detected'
    WHEN rage_clicks > 0 OR dead_clicks > 0 OR form_errors > 0 THEN 'friction_below_threshold'
    ELSE 'no_friction'
  END AS friction_status,
  COUNT(*) AS session_count,
  ROUND(COUNT(*) / SUM(COUNT(*)) OVER() * 100, 1) AS percent_of_sessions
FROM `your-project.your_dataset.signal_scores`
GROUP BY 1;


-- ── 5. State distribution sanity check ──
-- Expect: no single state > 60% (would indicate a classification collapse).

SELECT
  state,
  COUNT(*) AS session_count,
  ROUND(COUNT(*) / SUM(COUNT(*)) OVER() * 100, 1) AS state_share_percent
FROM `your-project.your_dataset.classified_sessions`
GROUP BY 1
ORDER BY session_count DESC;
