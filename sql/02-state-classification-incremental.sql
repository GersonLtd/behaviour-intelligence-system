-- ============================================================================
-- Behaviour Intelligence System — Incremental State Classification
-- ============================================================================
-- Classifies only sessions added/updated in the most recent incremental run.
-- MERGEs results into the classified_sessions table.
--
-- Input:  signal_scores table (after incremental MERGE from step 1)
-- Output: Upserts into classified_sessions for yesterday's sessions.
-- ============================================================================

DECLARE target_date DATE DEFAULT DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY);

MERGE `your-project.your_dataset.classified_sessions` AS target
USING (

  WITH

  signal_scores AS (
    SELECT * FROM `your-project.your_dataset.signal_scores`
    WHERE session_date = target_date
  ),

  state_assignment AS (
    SELECT
      s.*,

      CASE
        WHEN s.progression_score >= 8
          THEN 'Engaged'
        WHEN s.progression_score >= 6
          AND s.depth_score >= 4
          AND s.conversions = 0
          THEN 'Hesitant'
        WHEN s.breadth_score BETWEEN 2 AND 4
          AND s.depth_score >= 7
          AND s.clustering_score >= 7
          AND s.progression_score >= 6
          THEN 'Focused Evaluator'
        WHEN s.depth_score >= 6
          AND s.clustering_score >= 5
          AND s.progression_score BETWEEN 4 AND 6
          THEN 'Evaluator'
        WHEN s.breadth_score BETWEEN 4 AND 7
          AND s.depth_score BETWEEN 3 AND 5
          AND s.clustering_score >= 5
          AND s.progression_score BETWEEN 3 AND 5
          THEN 'Comparator'
        WHEN s.breadth_score BETWEEN 3 AND 6
          AND s.depth_score BETWEEN 4 AND 6
          AND s.progression_score <= 3
          AND (s.rage_clicks >= 3 OR s.dead_clicks >= 2 OR s.form_errors >= 2)
          THEN 'Stalled (Friction)'
        WHEN s.breadth_score BETWEEN 3 AND 6
          AND s.depth_score BETWEEN 4 AND 6
          AND s.progression_score <= 3
          THEN 'Stalled'
        WHEN s.breadth_score >= 6
          AND s.depth_score <= 3
          AND s.clustering_score <= 3
          THEN 'Scanner'
        WHEN s.breadth_score BETWEEN 4 AND 7
          AND s.depth_score BETWEEN 3 AND 6
          THEN 'Explorer'
        WHEN s.breadth_score <= 2
          AND s.depth_score <= 2
          AND s.progression_score = 0
          THEN 'Mismatch'
        ELSE 'Unclassified'
      END AS state,

      CASE
        WHEN s.progression_score >= 8 THEN 'retention'
        WHEN s.progression_score >= 6 AND s.conversions = 0 THEN 'evaluation'
        WHEN s.breadth_score BETWEEN 2 AND 4 AND s.depth_score >= 7 THEN 'evaluation'
        WHEN s.depth_score >= 6 AND s.clustering_score >= 5 THEN 'evaluation'
        WHEN s.breadth_score BETWEEN 4 AND 7 AND s.clustering_score >= 5 THEN 'evaluation'
        WHEN s.breadth_score BETWEEN 3 AND 6 AND s.depth_score BETWEEN 4 AND 6 THEN 'evaluation'
        ELSE 'acquisition'
      END AS lifecycle_phase

    FROM signal_scores s
  ),

  confidence_scored AS (
    SELECT
      sa.*,

      CASE
        WHEN (CASE WHEN sa.unique_pages > 0 THEN 1 ELSE 0 END
            + CASE WHEN COALESCE(sa.avg_scroll_percent, 0) > 0 THEN 1 ELSE 0 END
            + CASE WHEN sa.form_starts > 0 THEN 1 ELSE 0 END
            + CASE WHEN sa.form_submits > 0 THEN 1 ELSE 0 END
            + CASE WHEN sa.deep_engagement_events > 0 THEN 1 ELSE 0 END
            + CASE WHEN sa.conversions > 0 THEN 1 ELSE 0 END
            ) >= 5 THEN 2
        WHEN (CASE WHEN sa.unique_pages > 0 THEN 1 ELSE 0 END
            + CASE WHEN COALESCE(sa.avg_scroll_percent, 0) > 0 THEN 1 ELSE 0 END
            + CASE WHEN sa.form_starts > 0 THEN 1 ELSE 0 END
            + CASE WHEN sa.form_submits > 0 THEN 1 ELSE 0 END
            + CASE WHEN sa.deep_engagement_events > 0 THEN 1 ELSE 0 END
            + CASE WHEN sa.conversions > 0 THEN 1 ELSE 0 END
            ) >= 3 THEN 1
        ELSE 0
      END AS f_signal_count,

      CASE
        WHEN sa.form_starts > 0 OR sa.form_submits > 0 OR sa.conversions > 0 THEN 2
        WHEN sa.raw_progression_sum > 0 AND sa.form_starts = 0 THEN 1
        ELSE 0
      END AS f_signal_strength,

      CASE
        WHEN sa.state != 'Unclassified' AND sa.progression_score >= 8 THEN 2
        WHEN sa.state != 'Unclassified' THEN 1
        ELSE 0
      END AS f_state_clarity,

      CASE
        WHEN sa.engagement_time_seconds > 120 AND sa.unique_pages >= 5 THEN 2
        WHEN sa.engagement_time_seconds >= 30 AND sa.unique_pages >= 3 THEN 1
        ELSE 0
      END AS f_session_depth,

      0 AS f_temporal_consistency

    FROM state_assignment sa
  )

  SELECT
    user_pseudo_id,
    session_id,
    session_start,
    session_date,
    traffic_source_group,
    state,
    lifecycle_phase,
    LEAST(10,
      f_signal_count + f_signal_strength + f_state_clarity
      + f_session_depth + f_temporal_consistency
    ) AS confidence_score,
    CASE
      WHEN (f_signal_count + f_signal_strength + f_state_clarity
            + f_session_depth + f_temporal_consistency) <= 3 THEN 'low'
      WHEN (f_signal_count + f_signal_strength + f_state_clarity
            + f_session_depth + f_temporal_consistency) <= 6 THEN 'medium'
      ELSE 'high'
    END AS confidence_band,
    breadth_score,
    depth_score,
    progression_score,
    clustering_score,
    f_signal_count,
    f_signal_strength,
    f_state_clarity,
    f_session_depth,
    f_temporal_consistency,
    unique_pages,
    unique_page_types,
    engagement_time_seconds,
    form_starts,
    form_submits,
    conversions
  FROM confidence_scored

) AS source
ON target.user_pseudo_id = source.user_pseudo_id
  AND target.session_id = source.session_id

WHEN MATCHED THEN UPDATE SET
  session_start        = source.session_start,
  session_date         = source.session_date,
  traffic_source_group = source.traffic_source_group,
  state                = source.state,
  lifecycle_phase      = source.lifecycle_phase,
  confidence_score     = source.confidence_score,
  confidence_band      = source.confidence_band,
  breadth_score        = source.breadth_score,
  depth_score          = source.depth_score,
  progression_score    = source.progression_score,
  clustering_score     = source.clustering_score,
  f_signal_count       = source.f_signal_count,
  f_signal_strength    = source.f_signal_strength,
  f_state_clarity      = source.f_state_clarity,
  f_session_depth      = source.f_session_depth,
  f_temporal_consistency = source.f_temporal_consistency,
  unique_pages         = source.unique_pages,
  unique_page_types    = source.unique_page_types,
  engagement_time_seconds = source.engagement_time_seconds,
  form_starts          = source.form_starts,
  form_submits         = source.form_submits,
  conversions          = source.conversions

WHEN NOT MATCHED THEN INSERT (
  user_pseudo_id, session_id, session_start, session_date,
  traffic_source_group, state, lifecycle_phase, confidence_score,
  confidence_band, breadth_score, depth_score, progression_score,
  clustering_score, f_signal_count, f_signal_strength, f_state_clarity,
  f_session_depth, f_temporal_consistency, unique_pages, unique_page_types,
  engagement_time_seconds, form_starts, form_submits, conversions
) VALUES (
  source.user_pseudo_id, source.session_id, source.session_start,
  source.session_date, source.traffic_source_group, source.state,
  source.lifecycle_phase, source.confidence_score, source.confidence_band,
  source.breadth_score, source.depth_score, source.progression_score,
  source.clustering_score, source.f_signal_count, source.f_signal_strength,
  source.f_state_clarity, source.f_session_depth,
  source.f_temporal_consistency, source.unique_pages,
  source.unique_page_types, source.engagement_time_seconds,
  source.form_starts, source.form_submits, source.conversions
);
