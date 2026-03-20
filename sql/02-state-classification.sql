-- ============================================================================
-- Behaviour Intelligence System — State Classification
-- ============================================================================
-- Assigns behavioural states to each user-session using the four signal
-- scores from 01-signal-scores.sql.
--
-- Evaluates states in strict priority order. Includes confidence factors
-- and lifecycle phase assignment.
--
-- Input:  signal_scores (output of 01-signal-scores.sql, or a materialised table)
-- Output: One row per user-session with state, confidence, and lifecycle phase.
-- ============================================================================

WITH

-- Reference the signal scores (materialise 01-signal-scores as a table/view for production)
signal_scores AS (
  SELECT * FROM `your-project.your_dataset.signal_scores`
),

-- ── State Assignment (priority order) ──
state_assignment AS (
  SELECT
    s.*,

    -- Assign state using priority rules
    CASE
      -- Priority 1: Engaged (conversion completed)
      WHEN s.progression_score >= 8
        THEN 'Engaged'

      -- Priority 2: Hesitant (high intent, no completion)
      WHEN s.progression_score >= 6
        AND s.depth_score >= 4
        AND s.conversions = 0
        THEN 'Hesitant'

      -- Priority 3: Returning Evaluator is handled in 03-temporal.sql

      -- Priority 4: Focused Evaluator (narrow, deep, high progression)
      WHEN s.breadth_score BETWEEN 2 AND 4
        AND s.depth_score >= 7
        AND s.clustering_score >= 7
        AND s.progression_score >= 6
        THEN 'Focused Evaluator'

      -- Priority 5: Evaluator (deep + clustered + progressing)
      WHEN s.depth_score >= 6
        AND s.clustering_score >= 5
        AND s.progression_score BETWEEN 4 AND 6
        THEN 'Evaluator'

      -- Priority 6: Comparator (multi-pathway, depth 3–5)
      WHEN s.breadth_score BETWEEN 4 AND 7
        AND s.depth_score BETWEEN 3 AND 5
        AND s.clustering_score >= 5
        AND s.progression_score BETWEEN 3 AND 5
        THEN 'Comparator'

      -- Priority 7a: Stalled (Friction) — UX failures blocking progress
      -- Friction thresholds mirrored in: src/classifier.js hasFriction(), sql/06-validation-queries.sql
      WHEN s.breadth_score BETWEEN 3 AND 6
        AND s.depth_score BETWEEN 4 AND 6
        AND s.progression_score <= 3
        AND (s.rage_clicks >= 3 OR s.dead_clicks >= 2 OR s.form_errors >= 2)
        THEN 'Stalled (Friction)'

      -- Priority 7b: Stalled — confusion/overload, no friction signals
      WHEN s.breadth_score BETWEEN 3 AND 6
        AND s.depth_score BETWEEN 4 AND 6
        AND s.progression_score <= 3
        THEN 'Stalled'

      -- Priority 8: Scanner (wide, shallow, scattered)
      WHEN s.breadth_score >= 6
        AND s.depth_score <= 3
        AND s.clustering_score <= 3
        THEN 'Scanner'

      -- Priority 9: Explorer (moderate exploration)
      WHEN s.breadth_score BETWEEN 4 AND 7
        AND s.depth_score BETWEEN 3 AND 6
        THEN 'Explorer'

      -- Priority 10: Mismatch (minimal engagement)
      WHEN s.breadth_score <= 2
        AND s.depth_score <= 2
        AND s.progression_score = 0
        THEN 'Mismatch'

      -- Fallback
      ELSE 'Unclassified'
    END AS state,

    -- Lifecycle phase
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

-- ── Confidence scoring ──
-- Five factors, each 0–2. Sum = confidence (0–10).
confidence_scored AS (
  SELECT
    sa.*,

    -- Factor 1: Signal count (how many distinct event types)
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

    -- Factor 2: Signal strength (matches JS: form_start/form_submit/booking → 2, cta_click → 1)
    CASE
      WHEN sa.form_starts > 0 OR sa.form_submits > 0 OR sa.conversions > 0 THEN 2
      WHEN sa.raw_progression_sum > 0 AND sa.form_starts = 0 THEN 1  -- has CTA clicks but no form/booking
      ELSE 0
    END AS f_signal_strength,

    -- Factor 3: State clarity (simplified — full hybrid detection in JS)
    CASE
      WHEN sa.state != 'Unclassified' AND sa.progression_score >= 8 THEN 2
      WHEN sa.state != 'Unclassified' THEN 1
      ELSE 0
    END AS f_state_clarity,

    -- Factor 4: Session depth
    CASE
      WHEN sa.engagement_time_seconds > 120 AND sa.unique_pages >= 5 THEN 2
      WHEN sa.engagement_time_seconds >= 30 AND sa.unique_pages >= 3 THEN 1
      ELSE 0
    END AS f_session_depth,

    -- Factor 5: Temporal consistency (single-session only here; see 03-temporal.sql)
    0 AS f_temporal_consistency

  FROM state_assignment sa
)

-- ── Final output ──
SELECT
  user_pseudo_id,
  session_id,
  session_start,
  session_date,
  traffic_source_group,
  state,
  lifecycle_phase,

  -- Confidence
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

  -- Signal scores
  breadth_score,
  depth_score,
  progression_score,
  clustering_score,

  -- Confidence factors (for debugging)
  f_signal_count,
  f_signal_strength,
  f_state_clarity,
  f_session_depth,
  f_temporal_consistency,

  -- Raw metrics
  unique_pages,
  unique_page_types,
  engagement_time_seconds,
  form_starts,
  form_submits,
  conversions

FROM confidence_scored
