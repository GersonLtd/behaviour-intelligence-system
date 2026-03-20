-- ============================================================================
-- Behaviour Intelligence System — Incremental Temporal Analysis
-- ============================================================================
-- Recomputes temporal metrics only for users who had sessions yesterday.
-- These users need updated recency, frequency, trend, and temporal state.
--
-- Reads the full classified_sessions table for affected users (required for
-- multi-session trend calculation), but only MERGEs results for those users.
-- ============================================================================

DECLARE target_date DATE DEFAULT DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY);

MERGE `your-project.your_dataset.temporal_analysis` AS target
USING (

  WITH

  -- Identify users who had activity yesterday
  affected_users AS (
    SELECT DISTINCT user_pseudo_id
    FROM `your-project.your_dataset.classified_sessions`
    WHERE session_date = target_date
  ),

  -- Pull full session history for affected users only
  classified_sessions AS (
    SELECT cs.*
    FROM `your-project.your_dataset.classified_sessions` cs
    INNER JOIN affected_users au
      ON cs.user_pseudo_id = au.user_pseudo_id
  ),

  ordered_sessions AS (
    SELECT
      user_pseudo_id,
      session_id,
      session_start,
      session_date,
      state,
      lifecycle_phase,
      confidence_score,
      confidence_band,
      breadth_score,
      depth_score,
      progression_score,
      clustering_score,
      conversions,
      traffic_source_group,
      ROW_NUMBER() OVER (
        PARTITION BY user_pseudo_id
        ORDER BY session_start DESC
      ) AS session_recency_rank,
      LAG(session_start) OVER (
        PARTITION BY user_pseudo_id
        ORDER BY session_start
      ) AS previous_session_start
    FROM classified_sessions
  ),

  temporal_metrics AS (
    SELECT
      user_pseudo_id,
      COUNT(*) AS total_sessions,
      COUNTIF(session_start >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)) AS sessions_7d,
      COUNTIF(session_start >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)) AS sessions_30d,
      DATE_DIFF(CURRENT_DATE(), DATE(MAX(session_start)), DAY) AS days_since_last_session,
      MAX(DATE_DIFF(DATE(session_start), DATE(previous_session_start), DAY)) AS max_session_gap_days,

      MAX(CASE WHEN session_recency_rank = 1 THEN state END) AS latest_state,
      MAX(CASE WHEN session_recency_rank = 1 THEN breadth_score END) AS latest_breadth,
      MAX(CASE WHEN session_recency_rank = 1 THEN depth_score END) AS latest_depth,
      MAX(CASE WHEN session_recency_rank = 1 THEN progression_score END) AS latest_progression,
      MAX(CASE WHEN session_recency_rank = 1 THEN clustering_score END) AS latest_clustering,
      MAX(CASE WHEN session_recency_rank = 1 THEN traffic_source_group END) AS latest_traffic_source_group,

      MAX(CASE WHEN session_recency_rank = 2 THEN depth_score END) AS prev_depth,
      MAX(CASE WHEN session_recency_rank = 2 THEN progression_score END) AS prev_progression,
      MAX(CASE WHEN session_recency_rank = 3 THEN depth_score END) AS third_depth,
      MAX(CASE WHEN session_recency_rank = 3 THEN progression_score END) AS third_progression,

      MAX(CASE WHEN conversions > 0 THEN 1 ELSE 0 END) AS has_conversion,
      COUNTIF(
        state = 'Hesitant'
        AND session_start >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 14 DAY)
      ) AS hesitant_sessions_14d,
      COUNTIF(
        state IN ('Stalled', 'Stalled (Friction)')
        AND session_start >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
      ) AS stalled_sessions_30d
    FROM ordered_sessions
    GROUP BY 1
  ),

  trend_analysis AS (
    SELECT
      tm.*,
      CASE
        WHEN tm.total_sessions < 2 THEN 'insufficient'
        WHEN tm.latest_progression >= COALESCE(tm.prev_progression, tm.latest_progression)
          AND tm.latest_depth >= COALESCE(tm.prev_depth, tm.latest_depth)
          AND COALESCE(tm.prev_progression, tm.latest_progression) >= COALESCE(tm.third_progression, tm.prev_progression)
          AND COALESCE(tm.prev_depth, tm.latest_depth) >= COALESCE(tm.third_depth, tm.prev_depth)
          THEN 'reinforcing'
        WHEN tm.latest_progression >= COALESCE(tm.prev_progression, tm.latest_progression)
          OR tm.latest_depth >= COALESCE(tm.prev_depth, tm.latest_depth)
          THEN 'increasing'
        WHEN tm.latest_progression < COALESCE(tm.prev_progression, tm.latest_progression)
          THEN 'decaying'
        ELSE 'consistent'
      END AS trend_direction,
      CASE
        WHEN tm.days_since_last_session <= 2 THEN 'highly_recent'
        WHEN tm.days_since_last_session <= 7 THEN 'active_consideration'
        WHEN tm.days_since_last_session <= 30 THEN 'delayed_return'
        ELSE 'dormant'
      END AS recency_band
    FROM temporal_metrics tm
  )

  SELECT
    ta.user_pseudo_id,
    ta.total_sessions,
    ta.sessions_7d,
    ta.sessions_30d,
    ta.days_since_last_session,
    ta.max_session_gap_days,
    ta.latest_state,
    ta.latest_breadth,
    ta.latest_depth,
    ta.latest_progression,
    ta.latest_clustering,
    ta.latest_traffic_source_group AS traffic_source_group,
    ta.trend_direction,
    ta.recency_band,
    ta.has_conversion,
    ta.hesitant_sessions_14d,
    ta.stalled_sessions_30d,

    CASE
      WHEN ta.max_session_gap_days >= 30
        AND ta.days_since_last_session <= 7
        AND ta.latest_clustering >= 5
        AND ta.latest_progression >= 4
        THEN 'Re-engaged Prospect'
      WHEN (ta.sessions_7d >= 2 OR ta.sessions_30d >= 3)
        AND ta.trend_direction IN ('increasing', 'reinforcing')
        AND ta.has_conversion = 0
        THEN 'Returning Evaluator'
      WHEN ta.hesitant_sessions_14d >= 2
        THEN 'Persistent Hesitation'
      WHEN ta.stalled_sessions_30d >= 3
        AND ta.trend_direction NOT IN ('increasing', 'reinforcing')
        THEN 'Chronic Stall'
      ELSE NULL
    END AS temporal_state,

    CASE
      WHEN ta.has_conversion = 1 THEN 'retention'
      WHEN (ta.sessions_7d >= 2 OR ta.sessions_30d >= 3) AND ta.has_conversion = 0 THEN 'retention'
      WHEN ta.latest_state IN ('Comparator', 'Evaluator', 'Focused Evaluator', 'Hesitant', 'Stalled', 'Stalled (Friction)')
        THEN 'evaluation'
      ELSE 'acquisition'
    END AS temporal_lifecycle_phase,

    CASE
      WHEN ta.total_sessions = 1 AND ta.latest_progression >= 6 THEN 'high'
      WHEN ta.total_sessions <= 3 AND ta.trend_direction IN ('increasing', 'reinforcing') THEN 'medium'
      ELSE 'low'
    END AS velocity,

    CASE
      WHEN (ta.sessions_7d >= 3 OR ta.sessions_30d >= 3) AND ta.trend_direction = 'reinforcing' THEN 2
      WHEN ta.sessions_7d >= 2 AND ta.trend_direction IN ('consistent', 'reinforcing') THEN 1
      ELSE 0
    END AS temporal_confidence_bonus

  FROM trend_analysis ta

) AS source
ON target.user_pseudo_id = source.user_pseudo_id

WHEN MATCHED THEN UPDATE SET
  total_sessions           = source.total_sessions,
  sessions_7d              = source.sessions_7d,
  sessions_30d             = source.sessions_30d,
  days_since_last_session  = source.days_since_last_session,
  max_session_gap_days     = source.max_session_gap_days,
  latest_state             = source.latest_state,
  latest_breadth           = source.latest_breadth,
  latest_depth             = source.latest_depth,
  latest_progression       = source.latest_progression,
  latest_clustering        = source.latest_clustering,
  traffic_source_group     = source.traffic_source_group,
  trend_direction          = source.trend_direction,
  recency_band             = source.recency_band,
  has_conversion           = source.has_conversion,
  hesitant_sessions_14d    = source.hesitant_sessions_14d,
  stalled_sessions_30d     = source.stalled_sessions_30d,
  temporal_state           = source.temporal_state,
  temporal_lifecycle_phase = source.temporal_lifecycle_phase,
  velocity                 = source.velocity,
  temporal_confidence_bonus = source.temporal_confidence_bonus

WHEN NOT MATCHED THEN INSERT (
  user_pseudo_id, total_sessions, sessions_7d, sessions_30d,
  days_since_last_session, max_session_gap_days, latest_state,
  latest_breadth, latest_depth, latest_progression, latest_clustering,
  traffic_source_group, trend_direction, recency_band, has_conversion,
  hesitant_sessions_14d, stalled_sessions_30d, temporal_state,
  temporal_lifecycle_phase, velocity, temporal_confidence_bonus
) VALUES (
  source.user_pseudo_id, source.total_sessions, source.sessions_7d,
  source.sessions_30d, source.days_since_last_session,
  source.max_session_gap_days, source.latest_state, source.latest_breadth,
  source.latest_depth, source.latest_progression, source.latest_clustering,
  source.traffic_source_group, source.trend_direction, source.recency_band,
  source.has_conversion, source.hesitant_sessions_14d,
  source.stalled_sessions_30d, source.temporal_state,
  source.temporal_lifecycle_phase, source.velocity,
  source.temporal_confidence_bonus
);
