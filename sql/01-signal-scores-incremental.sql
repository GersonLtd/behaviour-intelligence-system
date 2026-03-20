-- ============================================================================
-- Behaviour Intelligence System — Incremental Signal Score Calculation
-- ============================================================================
-- Processes only yesterday's GA4 partition and MERGEs results into the
-- signal_scores table. Run this daily via BigQuery scheduled queries.
--
-- First run: Use the full 01-signal-scores.sql to backfill historical data.
-- Daily runs: This file processes one day at ~1/30th the cost.
--
-- Idempotent: safe to re-run — MERGE upserts on (user_pseudo_id, session_id).
-- ============================================================================

DECLARE target_date STRING DEFAULT FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY));

MERGE `your-project.your_dataset.signal_scores` AS target
USING (

  WITH

  -- ── Step 1: Extract raw events from yesterday's partition only ──
  raw_events AS (
    SELECT
      user_pseudo_id,
      (SELECT value.int_value
         FROM UNNEST(event_params)
        WHERE key = 'ga_session_id') AS session_id,
      event_name,
      TIMESTAMP_MICROS(event_timestamp) AS event_time,
      (SELECT value.string_value
         FROM UNNEST(event_params)
        WHERE key = 'page_location') AS url,
      (SELECT value.int_value
         FROM UNNEST(event_params)
        WHERE key = 'engagement_time_msec') AS engagement_time_msec,
      (SELECT value.int_value
         FROM UNNEST(event_params)
        WHERE key = 'percent_scrolled') AS scroll_percent,
      COALESCE(
        (SELECT value.string_value
           FROM UNNEST(event_params)
          WHERE key = 'traffic_source_group'),
        'unknown'
      ) AS traffic_source_group,
      (SELECT value.string_value
         FROM UNNEST(event_params)
        WHERE key = 'page_type') AS cms_page_type,
      (SELECT value.string_value
         FROM UNNEST(event_params)
        WHERE key = 'page_topic') AS cms_page_topic,
      (SELECT value.float_value
         FROM UNNEST(event_params)
        WHERE key = 'intent_weight') AS cms_intent_weight,
      (SELECT value.string_value
         FROM UNNEST(event_params)
        WHERE key = 'element_role') AS element_role,
      (SELECT value.float_value
         FROM UNNEST(event_params)
        WHERE key = 'element_weight') AS element_weight
    FROM `your-project.analytics_123456.events_*`
    WHERE _TABLE_SUFFIX = target_date
  ),

  -- ── Step 2: Map events to taxonomy ──
  url_paths AS (
    SELECT
      *,
      REGEXP_EXTRACT(url, r'^https?://[^/]+(/.*)$') AS url_path
    FROM raw_events
  ),

  exact_match AS (
    SELECT
      e.*,
      t.topic_cluster  AS lookup_topic,
      t.page_type      AS lookup_page_type,
      t.intent_weight  AS lookup_intent_weight
    FROM url_paths e
    LEFT JOIN `your-project.your_dataset.manual_taxonomy_lookup` t
      ON e.cms_page_type IS NULL
      AND e.url_path = t.url_path
  ),

  regex_match AS (
    SELECT
      e.* EXCEPT(lookup_topic, lookup_page_type, lookup_intent_weight),
      COALESCE(e.lookup_topic, t.topic_cluster)        AS lookup_topic,
      COALESCE(e.lookup_page_type, t.page_type)        AS lookup_page_type,
      COALESCE(e.lookup_intent_weight, t.intent_weight) AS lookup_intent_weight
    FROM exact_match e
    LEFT JOIN `your-project.your_dataset.manual_taxonomy_lookup` t
      ON e.cms_page_type IS NULL
      AND e.lookup_page_type IS NULL
      AND REGEXP_CONTAINS(e.url, t.url_pattern)
  ),

  mapped_events AS (
    SELECT
      * EXCEPT(lookup_topic, lookup_page_type, lookup_intent_weight, url_path),
      COALESCE(cms_page_topic, lookup_topic, 'General')          AS topic_cluster,
      COALESCE(cms_page_type, lookup_page_type, 'Unknown')       AS page_type,
      COALESCE(cms_intent_weight, lookup_intent_weight, 0.5)     AS intent_weight
    FROM regex_match
  ),

  -- ── Step 3–6: Identical metric CTEs as full version ──

  breadth_metrics AS (
    SELECT
      user_pseudo_id, session_id,
      COUNT(DISTINCT url)           AS unique_pages,
      COUNT(DISTINCT page_type)     AS unique_page_types,
      COUNT(DISTINCT topic_cluster) AS unique_topics
    FROM mapped_events
    WHERE event_name = 'page_view'
    GROUP BY 1, 2
  ),

  depth_metrics AS (
    SELECT
      user_pseudo_id, session_id,
      SUM(engagement_time_msec) / 1000.0 AS engagement_time_seconds,
      AVG(CASE WHEN scroll_percent IS NOT NULL
               THEN scroll_percent END)  AS avg_scroll_percent,
      COUNTIF(event_name IN ('resource_download', 'video_start'))
                                         AS deep_engagement_events
    FROM mapped_events
    GROUP BY 1, 2
  ),

  clustering_prep AS (
    SELECT
      user_pseudo_id, session_id, topic_cluster, event_time,
      COUNT(*) OVER(PARTITION BY user_pseudo_id, session_id) AS total_views,
      COUNT(*) OVER(PARTITION BY user_pseudo_id, session_id, topic_cluster) AS cluster_views,
      LAG(topic_cluster) OVER(PARTITION BY user_pseudo_id, session_id ORDER BY event_time) AS prev_topic
    FROM mapped_events
    WHERE event_name = 'page_view'
  ),

  clustering_metrics AS (
    SELECT
      user_pseudo_id, session_id,
      MAX(SAFE_DIVIDE(cluster_views, total_views)) AS dominant_topic_share,
      COUNTIF(topic_cluster != prev_topic AND prev_topic IS NOT NULL) AS topic_switch_count,
      MAX(total_views)       AS total_page_views,
      MAX(cluster_views) - 1 AS repeat_cluster_visits
    FROM clustering_prep
    GROUP BY 1, 2
  ),

  progression_events AS (
    SELECT
      user_pseudo_id, session_id, event_name,
      COALESCE(
        element_weight,
        CASE element_role
          WHEN 'progression' THEN 2.0
          WHEN 'navigation'  THEN 0.3
          WHEN 'depth'       THEN 0.5
          WHEN 'tool_use'    THEN 0.8
          WHEN 'social'      THEN 0.3
        END,
        intent_weight
      ) AS effective_weight
    FROM mapped_events
  ),

  progression_metrics AS (
    SELECT
      user_pseudo_id, session_id,
      SUM(CASE
        WHEN event_name = 'cta_click'           THEN 1.0 * effective_weight
        WHEN event_name = 'form_start'          THEN 1.5 * effective_weight
        WHEN event_name = 'form_submit'         THEN 2.0 * effective_weight
        WHEN event_name = 'booking_click'       THEN 1.5 * effective_weight
        WHEN event_name = 'conversion_complete' THEN 2.0 * effective_weight
        ELSE 0
      END)                    AS raw_progression_sum,
      COUNTIF(event_name = 'form_start')          AS form_starts,
      COUNTIF(event_name = 'form_submit')         AS form_submits,
      COUNTIF(event_name = 'conversion_complete') AS conversions
    FROM progression_events
    GROUP BY 1, 2
  ),

  friction_metrics AS (
    SELECT
      user_pseudo_id, session_id,
      COUNTIF(event_name = 'rage_click')        AS rage_clicks,
      COUNTIF(event_name = 'dead_click')        AS dead_clicks,
      COUNTIF(event_name = 'form_error')        AS form_errors,
      COUNTIF(event_name = 'high_layout_shift') AS high_layout_shifts
    FROM mapped_events
    GROUP BY 1, 2
  ),

  session_meta AS (
    SELECT
      user_pseudo_id, session_id,
      MIN(event_time) AS session_start,
      ARRAY_AGG(traffic_source_group IGNORE NULLS ORDER BY event_time LIMIT 1)[SAFE_OFFSET(0)]
        AS traffic_source_group
    FROM mapped_events
    GROUP BY 1, 2
  )

  -- ── Assemble signal scores ──
  SELECT
    b.user_pseudo_id,
    b.session_id,
    sm.session_start,
    DATE(sm.session_start) AS session_date,
    sm.traffic_source_group,

    LEAST(10, CASE
      WHEN b.unique_pages = 1                              THEN 1
      WHEN b.unique_pages <= 3 AND b.unique_page_types <= 2 THEN 3
      WHEN b.unique_pages <= 5                              THEN 5
      WHEN b.unique_pages <= 8 AND b.unique_page_types >= 3 THEN 7
      WHEN b.unique_pages <= 8                              THEN 5
      ELSE 9
    END) AS breadth_score,

    LEAST(10, GREATEST(0,
      CASE
        WHEN d.engagement_time_seconds <= 10  THEN 1
        WHEN d.engagement_time_seconds <= 30  THEN 3
        WHEN d.engagement_time_seconds <= 90  THEN 5
        WHEN d.engagement_time_seconds <= 180 THEN 7
        ELSE 9
      END
      + CASE WHEN COALESCE(d.avg_scroll_percent, 0) >= 75 THEN 1 ELSE 0 END
      + CASE WHEN d.deep_engagement_events > 0 THEN 1 ELSE 0 END
      + CASE WHEN sm.traffic_source_group = 'referral' THEN 1 ELSE 0 END
    )) AS depth_score,

    LEAST(10, GREATEST(0, ROUND(p.raw_progression_sum) + CASE
      WHEN sm.traffic_source_group = 'direct'      THEN 1
      WHEN sm.traffic_source_group = 'paid_search'  THEN 1
      WHEN sm.traffic_source_group = 'social_media' THEN -1
      ELSE 0
    END)) AS progression_score,

    ROUND(GREATEST(0, LEAST(10,
      (c.dominant_topic_share * 10)
      - CASE
          WHEN c.total_page_views < 4 THEN 0
          ELSE LEAST(c.topic_switch_count, 5)
        END
      + LEAST(GREATEST(c.repeat_cluster_visits - 1, 0), 3)
    ))) AS clustering_score,

    b.unique_pages,
    b.unique_page_types,
    b.unique_topics,
    d.engagement_time_seconds,
    d.avg_scroll_percent,
    d.deep_engagement_events,
    c.dominant_topic_share,
    c.topic_switch_count,
    c.total_page_views,
    c.repeat_cluster_visits,
    p.raw_progression_sum,
    p.form_starts,
    p.form_submits,
    p.conversions,
    COALESCE(f.rage_clicks, 0)        AS rage_clicks,
    COALESCE(f.dead_clicks, 0)        AS dead_clicks,
    COALESCE(f.form_errors, 0)        AS form_errors,
    COALESCE(f.high_layout_shifts, 0) AS high_layout_shifts

  FROM breadth_metrics b
  JOIN depth_metrics d
    ON b.user_pseudo_id = d.user_pseudo_id AND b.session_id = d.session_id
  JOIN clustering_metrics c
    ON b.user_pseudo_id = c.user_pseudo_id AND b.session_id = c.session_id
  JOIN progression_metrics p
    ON b.user_pseudo_id = p.user_pseudo_id AND b.session_id = p.session_id
  JOIN session_meta sm
    ON b.user_pseudo_id = sm.user_pseudo_id AND b.session_id = sm.session_id
  LEFT JOIN friction_metrics f
    ON b.user_pseudo_id = f.user_pseudo_id AND b.session_id = f.session_id

) AS source
ON target.user_pseudo_id = source.user_pseudo_id
  AND target.session_id = source.session_id

-- Sessions spanning midnight: replace with latest full-day computation
WHEN MATCHED THEN UPDATE SET
  session_start          = source.session_start,
  session_date           = source.session_date,
  traffic_source_group   = source.traffic_source_group,
  breadth_score          = source.breadth_score,
  depth_score            = source.depth_score,
  progression_score      = source.progression_score,
  clustering_score       = source.clustering_score,
  unique_pages           = source.unique_pages,
  unique_page_types      = source.unique_page_types,
  unique_topics          = source.unique_topics,
  engagement_time_seconds = source.engagement_time_seconds,
  avg_scroll_percent     = source.avg_scroll_percent,
  deep_engagement_events = source.deep_engagement_events,
  dominant_topic_share   = source.dominant_topic_share,
  topic_switch_count     = source.topic_switch_count,
  total_page_views       = source.total_page_views,
  repeat_cluster_visits  = source.repeat_cluster_visits,
  raw_progression_sum    = source.raw_progression_sum,
  form_starts            = source.form_starts,
  form_submits           = source.form_submits,
  conversions            = source.conversions,
  rage_clicks            = source.rage_clicks,
  dead_clicks            = source.dead_clicks,
  form_errors            = source.form_errors,
  high_layout_shifts     = source.high_layout_shifts

WHEN NOT MATCHED THEN INSERT (
  user_pseudo_id, session_id, session_start, session_date,
  traffic_source_group, breadth_score, depth_score, progression_score,
  clustering_score, unique_pages, unique_page_types, unique_topics,
  engagement_time_seconds, avg_scroll_percent, deep_engagement_events,
  dominant_topic_share, topic_switch_count, total_page_views,
  repeat_cluster_visits, raw_progression_sum, form_starts, form_submits,
  conversions, rage_clicks, dead_clicks, form_errors, high_layout_shifts
) VALUES (
  source.user_pseudo_id, source.session_id, source.session_start,
  source.session_date, source.traffic_source_group, source.breadth_score,
  source.depth_score, source.progression_score, source.clustering_score,
  source.unique_pages, source.unique_page_types, source.unique_topics,
  source.engagement_time_seconds, source.avg_scroll_percent,
  source.deep_engagement_events, source.dominant_topic_share,
  source.topic_switch_count, source.total_page_views,
  source.repeat_cluster_visits, source.raw_progression_sum,
  source.form_starts, source.form_submits, source.conversions,
  source.rage_clicks, source.dead_clicks, source.form_errors,
  source.high_layout_shifts
);
