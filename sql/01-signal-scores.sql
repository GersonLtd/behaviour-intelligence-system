-- ============================================================================
-- Behaviour Intelligence System — Signal Score Calculation
-- ============================================================================
-- Calculates the four core signal scores (breadth, depth, progression,
-- clustering) from GA4 BigQuery export data.
--
-- Prerequisites:
--   - GA4 BigQuery export enabled
--   - Taxonomy register uploaded as `manual_taxonomy_lookup` table
--   - Adjust project/dataset references before running
--
-- Output: One row per user-session with all four signal scores (0–10)
--         plus raw metrics for calibration and debugging.
-- ============================================================================

WITH

-- ── Step 1: Extract raw events with session identity ──
raw_events AS (
  SELECT
    user_pseudo_id,
    -- GA4 session ID is per-user, so always pair with user_pseudo_id
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
      WHERE key = 'percent_scrolled') AS scroll_percent
    ,
    COALESCE(
      (SELECT value.string_value
         FROM UNNEST(event_params)
        WHERE key = 'traffic_source_group'),
      'unknown'
    ) AS traffic_source_group,
    -- CMS-embedded taxonomy (primary source — set at page creation time)
    (SELECT value.string_value
       FROM UNNEST(event_params)
      WHERE key = 'page_type') AS cms_page_type,
    (SELECT value.string_value
       FROM UNNEST(event_params)
      WHERE key = 'page_topic') AS cms_page_topic,
    (SELECT value.float_value
       FROM UNNEST(event_params)
      WHERE key = 'intent_weight') AS cms_intent_weight,
    -- Element-level metadata (micro-signals — set on individual elements)
    (SELECT value.string_value
       FROM UNNEST(event_params)
      WHERE key = 'element_role') AS element_role,
    (SELECT value.float_value
       FROM UNNEST(event_params)
      WHERE key = 'element_weight') AS element_weight
  FROM `your-project.analytics_123456.events_*`
  WHERE _TABLE_SUFFIX BETWEEN
    FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY))
    AND FORMAT_DATE('%Y%m%d', CURRENT_DATE())
),

-- ── Step 2: Map events to taxonomy ──
-- CMS-embedded metadata is the primary source. The external register
-- (manual_taxonomy_lookup) is a fallback for legacy sites or pages
-- where CMS metadata has not yet been embedded.
--
-- Performance note: We extract the URL path once and prefer an exact
-- match against the lookup table's `url_path` column. Regex fallback
-- (url_pattern) is only evaluated for rows that didn't match exactly.
-- This avoids a full REGEXP_CONTAINS cross-join on every event row,
-- which can spike BigQuery slot time and billing on high-traffic sites.
url_paths AS (
  SELECT
    *,
    REGEXP_EXTRACT(url, r'^https?://[^/]+(/.*)$') AS url_path
  FROM raw_events
),

-- Exact path match (cheap, covers the majority of lookups)
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

-- Regex fallback only for unmatched rows that still lack CMS metadata
regex_match AS (
  SELECT
    e.* EXCEPT(lookup_topic, lookup_page_type, lookup_intent_weight),
    COALESCE(e.lookup_topic, t.topic_cluster)        AS lookup_topic,
    COALESCE(e.lookup_page_type, t.page_type)        AS lookup_page_type,
    COALESCE(e.lookup_intent_weight, t.intent_weight) AS lookup_intent_weight
  FROM exact_match e
  LEFT JOIN `your-project.your_dataset.manual_taxonomy_lookup` t
    ON e.cms_page_type IS NULL
    AND e.lookup_page_type IS NULL      -- exact match didn't hit
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

-- ── Step 3: Breadth metrics ──
-- Unique pages, page types, and topic clusters per session.
breadth_metrics AS (
  SELECT
    user_pseudo_id,
    session_id,
    COUNT(DISTINCT url)           AS unique_pages,
    COUNT(DISTINCT page_type)     AS unique_page_types,
    COUNT(DISTINCT topic_cluster) AS unique_topics
  FROM mapped_events
  WHERE event_name = 'page_view'
  GROUP BY 1, 2
),

-- ── Step 4: Depth metrics ──
-- Engagement time, scroll depth, and high-attention events per session.
depth_metrics AS (
  SELECT
    user_pseudo_id,
    session_id,
    SUM(engagement_time_msec) / 1000.0 AS engagement_time_seconds,
    AVG(CASE WHEN scroll_percent IS NOT NULL
             THEN scroll_percent END)  AS avg_scroll_percent,
    COUNTIF(event_name IN ('resource_download', 'video_start'))
                                       AS deep_engagement_events
  FROM mapped_events
  GROUP BY 1, 2
),

-- ── Step 5: Clustering metrics ──
-- Topic concentration, switching, and repeat returns per session.
clustering_prep AS (
  SELECT
    user_pseudo_id,
    session_id,
    topic_cluster,
    event_time,
    -- Total views in this session
    COUNT(*) OVER(
      PARTITION BY user_pseudo_id, session_id
    ) AS total_views,
    -- Views in this cluster within this session
    COUNT(*) OVER(
      PARTITION BY user_pseudo_id, session_id, topic_cluster
    ) AS cluster_views,
    -- Previous topic (for switch detection)
    LAG(topic_cluster) OVER(
      PARTITION BY user_pseudo_id, session_id
      ORDER BY event_time
    ) AS prev_topic
  FROM mapped_events
  WHERE event_name = 'page_view'
),

clustering_metrics AS (
  SELECT
    user_pseudo_id,
    session_id,
    -- Dominant topic share: largest cluster / total
    MAX(SAFE_DIVIDE(cluster_views, total_views)) AS dominant_topic_share,
    -- Topic switches: transitions between different clusters
    COUNTIF(topic_cluster != prev_topic AND prev_topic IS NOT NULL)
                                                 AS topic_switch_count,
    -- Total page views (for signal floor check)
    MAX(total_views)                             AS total_page_views,
    -- Repeat cluster return: views in dominant cluster beyond first
    MAX(cluster_views) - 1                       AS repeat_cluster_visits
  FROM clustering_prep
  GROUP BY 1, 2
),

-- ── Step 6: Progression metrics ──
-- Weighted action scores. Element weight overrides page intent weight
-- when present (CMS-first element-level intelligence).
-- page_view and scroll are excluded (breadth/depth only).
--
-- effective_weight resolves the 3-level priority once per event:
--   explicit element_weight > element_role lookup > page intent_weight
-- Matches the priority in src/signals.js scoreProgression().
progression_events AS (
  SELECT
    user_pseudo_id,
    session_id,
    event_name,
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
    user_pseudo_id,
    session_id,
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

-- ── Step 6b: Friction metrics ──
-- Aggregates friction events for Stalled (Friction) sub-type detection.
friction_metrics AS (
  SELECT
    user_pseudo_id,
    session_id,
    COUNTIF(event_name = 'rage_click')  AS rage_clicks,
    COUNTIF(event_name = 'dead_click')  AS dead_clicks,
    COUNTIF(event_name = 'form_error')  AS form_errors
  FROM mapped_events
  GROUP BY 1, 2
),

-- Meta fields that downstream models require.
session_meta AS (
  SELECT
    user_pseudo_id,
    session_id,
    MIN(event_time) AS session_start,
    ARRAY_AGG(traffic_source_group IGNORE NULLS ORDER BY event_time LIMIT 1)[SAFE_OFFSET(0)]
      AS traffic_source_group
  FROM mapped_events
  GROUP BY 1, 2
)

-- ── Step 7: Assemble final signal scores (0–10) ──
SELECT
  b.user_pseudo_id,
  b.session_id,
  sm.session_start,
  DATE(sm.session_start) AS session_date,
  sm.traffic_source_group,

  -- Breadth score (0–10)
  LEAST(10, CASE
    WHEN b.unique_pages = 1                              THEN 1
    WHEN b.unique_pages <= 3 AND b.unique_page_types <= 2 THEN 3
    WHEN b.unique_pages <= 5                              THEN 5
    WHEN b.unique_pages <= 8 AND b.unique_page_types >= 3 THEN 7
    WHEN b.unique_pages <= 8                              THEN 5  -- 6-8 pages, low type diversity
    ELSE 9
  END) AS breadth_score,

  -- Depth score (0–10): base from time + scroll bonus + engagement bonus + source bias (±1 max)
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

  -- Progression score (0–10): capped weighted sum + source bias (±1 max)
  LEAST(10, GREATEST(0, ROUND(p.raw_progression_sum) + CASE
    WHEN sm.traffic_source_group = 'direct'      THEN 1
    WHEN sm.traffic_source_group = 'paid_search'  THEN 1
    WHEN sm.traffic_source_group = 'social_media' THEN -1
    ELSE 0
  END)) AS progression_score,

  -- Clustering score (0–10): formula with minimum signal floor
  ROUND(GREATEST(0, LEAST(10,
    (c.dominant_topic_share * 10)
    - CASE
        WHEN c.total_page_views < 4 THEN 0   -- signal floor: no penalty below 4 pages
        ELSE LEAST(c.topic_switch_count, 5)
      END
    + LEAST(GREATEST(c.repeat_cluster_visits - 1, 0), 3)
  ))) AS clustering_score,  -- integer, consistent with JS Math.round()

  -- Raw metrics for debugging and calibration
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

  -- Friction signals (for Stalled/Friction sub-type detection)
  COALESCE(f.rage_clicks, 0)  AS rage_clicks,
  COALESCE(f.dead_clicks, 0)  AS dead_clicks,
  COALESCE(f.form_errors, 0)  AS form_errors

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
