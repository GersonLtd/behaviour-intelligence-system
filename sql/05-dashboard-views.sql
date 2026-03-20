-- ============================================================================
-- Behaviour Intelligence System - Dashboard Views
-- ============================================================================
-- Creates BigQuery views used by Looker Studio.
--
-- Prerequisites:
--   1) 01-signal-scores.sql materialised as your_dataset.signal_scores
--   2) 02-state-classification.sql materialised as your_dataset.classified_sessions
--   3) 03-temporal-analysis.sql materialised as your_dataset.temporal_analysis
-- ============================================================================

-- ----------------------------------------------------------------------------
-- View 0: Combined Sessions (overlays temporal states onto classified sessions)
-- Temporal states (Returning Evaluator, Re-engaged Prospect) override the
-- single-session classification when present.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW `your-project.your_dataset.combined_sessions` AS
SELECT
  cs.*,
  -- Override state with temporal state when assigned
  COALESCE(ta.temporal_state, cs.state) AS effective_state,
  COALESCE(ta.temporal_lifecycle_phase, cs.lifecycle_phase) AS effective_lifecycle_phase,
  ta.temporal_state,
  ta.velocity,
  ta.trend_direction,
  ta.recency_band,
  ta.sessions_7d,
  ta.sessions_30d,
  -- Add temporal confidence bonus to base confidence
  LEAST(10, cs.confidence_score + COALESCE(ta.temporal_confidence_bonus, 0)) AS effective_confidence_score,
  CASE
    WHEN LEAST(10, cs.confidence_score + COALESCE(ta.temporal_confidence_bonus, 0)) <= 3 THEN 'low'
    WHEN LEAST(10, cs.confidence_score + COALESCE(ta.temporal_confidence_bonus, 0)) <= 6 THEN 'medium'
    ELSE 'high'
  END AS effective_confidence_band
FROM `your-project.your_dataset.classified_sessions` cs
LEFT JOIN `your-project.your_dataset.temporal_analysis` ta
  ON cs.user_pseudo_id = ta.user_pseudo_id;

-- ----------------------------------------------------------------------------
-- View 1: State Distribution
-- Uses effective_state (temporal-aware) for accurate state reporting.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW `your-project.your_dataset.dashboard_state_distribution` AS
SELECT
  session_date,
  effective_state AS state,
  effective_lifecycle_phase AS lifecycle_phase,
  effective_confidence_band AS confidence_band,
  traffic_source_group,
  COUNT(*) AS session_count,
  COUNT(DISTINCT user_pseudo_id) AS user_count,
  ROUND(AVG(confidence_score), 1) AS avg_confidence,
  ROUND(AVG(breadth_score), 1) AS avg_breadth,
  ROUND(AVG(depth_score), 1) AS avg_depth,
  ROUND(AVG(progression_score), 1) AS avg_progression,
  ROUND(AVG(clustering_score), 1) AS avg_clustering,
  ROUND(SAFE_DIVIDE(COUNT(*), SUM(COUNT(*)) OVER (PARTITION BY session_date)) * 100, 1) AS state_share_percent
FROM `your-project.your_dataset.combined_sessions`
GROUP BY 1, 2, 3, 4, 5;

-- ----------------------------------------------------------------------------
-- View 2: Conversion by State
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW `your-project.your_dataset.dashboard_conversion_by_state` AS
SELECT
  effective_state AS state,
  effective_lifecycle_phase AS lifecycle_phase,
  effective_confidence_band AS confidence_band,
  traffic_source_group,
  COUNT(*) AS total_sessions,
  COUNTIF(conversions > 0) AS converted_sessions,
  ROUND(SAFE_DIVIDE(COUNTIF(conversions > 0), COUNT(*)) * 100, 1) AS conversion_rate_percent,
  ROUND(AVG(CASE WHEN conversions > 0 THEN depth_score END), 1) AS avg_depth_converters,
  ROUND(AVG(CASE WHEN conversions = 0 THEN depth_score END), 1) AS avg_depth_non_converters,
  ROUND(AVG(CASE WHEN conversions > 0 THEN confidence_score END), 1) AS avg_confidence_converters
FROM `your-project.your_dataset.combined_sessions`
GROUP BY 1, 2, 3, 4
HAVING total_sessions >= 30;

-- ----------------------------------------------------------------------------
-- View 3: State Transitions
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW `your-project.your_dataset.dashboard_state_transitions` AS
WITH ordered AS (
  SELECT
    user_pseudo_id,
    session_start,
    effective_state AS state,
    effective_confidence_score AS confidence_score,
    LAG(effective_state) OVER (PARTITION BY user_pseudo_id ORDER BY session_start) AS previous_state
  FROM `your-project.your_dataset.combined_sessions`
)
SELECT
  previous_state AS from_state,
  state AS to_state,
  COUNT(*) AS transition_count,
  COUNT(DISTINCT user_pseudo_id) AS unique_users,
  ROUND(AVG(confidence_score), 1) AS avg_confidence_at_transition,
  ROUND(SAFE_DIVIDE(COUNT(*), SUM(COUNT(*)) OVER (PARTITION BY previous_state)) * 100, 1) AS transition_share_percent
FROM ordered
WHERE previous_state IS NOT NULL
  AND previous_state != state
GROUP BY 1, 2
HAVING transition_count >= 5;

-- ----------------------------------------------------------------------------
-- View 4: Source Quality
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW `your-project.your_dataset.dashboard_source_quality` AS
WITH source_rollup AS (
  SELECT
    traffic_source_group AS traffic_source,
    effective_state AS state,
    effective_confidence_band AS confidence_band,
    COUNT(*) AS session_count,
    COUNTIF(effective_state = 'Mismatch') AS mismatch_sessions,
    ROUND(AVG(effective_confidence_score), 1) AS avg_confidence
  FROM `your-project.your_dataset.combined_sessions`
  GROUP BY 1, 2, 3
)
SELECT
  traffic_source,
  state,
  confidence_band,
  session_count,
  ROUND(SAFE_DIVIDE(session_count, SUM(session_count) OVER (PARTITION BY traffic_source)) * 100, 1) AS state_share_percent,
  ROUND(SAFE_DIVIDE(mismatch_sessions, session_count) * 100, 1) AS mismatch_rate_percent,
  avg_confidence
FROM source_rollup;

-- ----------------------------------------------------------------------------
-- View 5: Confidence Distribution
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW `your-project.your_dataset.dashboard_confidence_distribution` AS
SELECT
  effective_state AS state,
  effective_confidence_band AS confidence_band,
  effective_confidence_score AS confidence_score,
  COUNT(*) AS session_count,
  ROUND(SAFE_DIVIDE(COUNT(*), SUM(COUNT(*)) OVER (PARTITION BY effective_state)) * 100, 1) AS band_share_percent,
  ROUND(AVG(breadth_score), 1) AS avg_breadth,
  ROUND(AVG(depth_score), 1) AS avg_depth,
  ROUND(AVG(progression_score), 1) AS avg_progression,
  ROUND(AVG(clustering_score), 1) AS avg_clustering
FROM `your-project.your_dataset.combined_sessions`
GROUP BY 1, 2, 3;

-- ----------------------------------------------------------------------------
-- View 6: Problem-First Reporting
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW `your-project.your_dataset.dashboard_problem_view` AS
SELECT
  CASE
    WHEN effective_state IN ('Mismatch', 'Scanner') THEN 'High bounce / low engagement'
    WHEN effective_state IN ('Explorer', 'Stalled', 'Stalled (Friction)') THEN 'Traffic but weak progression'
    WHEN effective_state IN ('Evaluator', 'Comparator', 'Hesitant') THEN 'Strong evaluation but weak conversion'
    WHEN effective_state = 'Returning Evaluator' THEN 'Repeat visits without action'
    WHEN effective_state = 'Engaged' THEN 'Converted (monitor retention)'
    ELSE 'Other'
  END AS business_problem,
  effective_state AS state,
  effective_lifecycle_phase AS lifecycle_phase,
  COUNT(*) AS session_count,
  COUNT(DISTINCT user_pseudo_id) AS user_count,
  ROUND(AVG(effective_confidence_score), 1) AS avg_confidence,
  COUNTIF(conversions > 0) AS converted_count,
  ROUND(SAFE_DIVIDE(COUNTIF(conversions > 0), COUNT(*)) * 100, 1) AS conversion_rate_percent
FROM `your-project.your_dataset.combined_sessions`
GROUP BY 1, 2, 3;

-- ----------------------------------------------------------------------------
-- View 7: Taxonomy Health
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW `your-project.your_dataset.dashboard_taxonomy_health` AS
WITH page_topics AS (
  SELECT
    REGEXP_EXTRACT(
      (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_location'),
      r'https?://[^/]+(/.*)$'
    ) AS page_path,
    COALESCE(
      (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_topic'),
      'General'
    ) AS page_topic,
    COUNT(*) AS view_count
  FROM `your-project.analytics_123456.events_*`
  WHERE _TABLE_SUFFIX BETWEEN FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY))
    AND FORMAT_DATE('%Y%m%d', CURRENT_DATE())
    AND event_name = 'page_view'
  GROUP BY 1, 2
)
SELECT
  COUNTIF(page_topic != 'General') AS tagged_pages,
  COUNT(*) AS total_pages,
  ROUND(SAFE_DIVIDE(COUNTIF(page_topic != 'General'), COUNT(*)) * 100, 1) AS page_coverage_percent,
  SUM(CASE WHEN page_topic != 'General' THEN view_count ELSE 0 END) AS tagged_views,
  SUM(view_count) AS total_views,
  ROUND(SAFE_DIVIDE(SUM(CASE WHEN page_topic != 'General' THEN view_count ELSE 0 END), SUM(view_count)) * 100, 1) AS view_coverage_percent,
  COUNTIF(page_topic = 'General' AND view_count >= 100) AS urgent_untagged_count
FROM page_topics;

-- ----------------------------------------------------------------------------
-- View 8: Prescriptive Output
-- Generates natural-language instructions per state from aggregate data.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW `your-project.your_dataset.dashboard_prescriptive` AS
WITH state_agg AS (
  SELECT
    effective_state AS state,
    COUNT(*) AS session_count,
    COUNTIF(conversions > 0) AS converted_count,
    COUNTIF(form_starts > 0 AND form_submits = 0) AS blocked_count
  FROM `your-project.your_dataset.combined_sessions`
  WHERE session_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
  GROUP BY 1
)
SELECT
  state,
  session_count,
  CASE
    WHEN state = 'Mismatch'
      THEN CONCAT('Review traffic quality. ', CAST(session_count AS STRING), ' sessions showed no meaningful engagement in the last 7 days.')
    WHEN state = 'Scanner'
      THEN CONCAT('Add guided entry points. ', CAST(session_count AS STRING), ' sessions showed wide browsing with no depth.')
    WHEN state = 'Explorer'
      THEN CONCAT('Strengthen pathways from discovery content into offers. ', CAST(session_count AS STRING), ' sessions explored without clustering.')
    WHEN state = 'Comparator'
      THEN CONCAT('Clarify differentiation between competing options. ', CAST(session_count AS STRING), ' sessions compared without converting.')
    WHEN state = 'Evaluator'
      THEN CONCAT('Add case studies and proof elements. ', CAST(session_count AS STRING), ' sessions evaluated deeply but did not convert.')
    WHEN state = 'Focused Evaluator'
      THEN CONCAT('Shorten path to conversion. ', CAST(session_count AS STRING), ' high-intent sessions are close to acting.')
    WHEN state = 'Hesitant'
      THEN CONCAT('Reduce form friction. ', CAST(blocked_count AS STRING), ' users started but did not complete conversion.')
    WHEN state = 'Stalled'
      THEN CONCAT('Simplify navigation to reduce loops. ', CAST(session_count AS STRING), ' sessions showed no forward movement.')
    WHEN state = 'Stalled (Friction)'
      THEN CONCAT('Fix broken interactions. ', CAST(session_count AS STRING), ' users were blocked by UX failures.')
    WHEN state = 'Returning Evaluator'
      THEN CONCAT('Reinforce differentiation. ', CAST(session_count AS STRING), ' returning visitors have not yet converted.')
    WHEN state = 'Engaged'
      THEN CONCAT('Support onboarding. ', CAST(converted_count AS STRING), ' users converted in the last 7 days.')
    ELSE 'No prescription available.'
  END AS prescription
FROM state_agg
ORDER BY session_count DESC;

