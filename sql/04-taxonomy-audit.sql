-- ============================================================================
-- Behaviour Intelligence System — Taxonomy Coverage Audit
-- ============================================================================
-- Reports on taxonomy health:
--   1. Pages with "General" default topic (untagged)
--   2. Coverage rate (tagged vs total)
--   3. High-traffic untagged pages that need immediate attention
--
-- Run monthly as part of the taxonomy maintenance process.
-- Target: >= 95% coverage. Below 90%, clustering scores are unreliable.
-- ============================================================================

-- ── 1. Untagged high-traffic pages ──
-- Pages viewed in the last 30 days with default "General" topic and 100+ views.
-- These are blind spots that must be classified.

WITH page_traffic AS (
  SELECT
    REGEXP_EXTRACT(
      (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_location'),
      r'https?://[^/]+(/.*)$'
    ) AS page_path,
    COALESCE(
      (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_topic'),
      'General'
    ) AS page_topic,
    COALESCE(
      (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_type'),
      'Unknown'
    ) AS page_type,
    COUNT(*) AS page_views
  FROM `your-project.analytics_123456.events_*`
  WHERE _TABLE_SUFFIX BETWEEN
    FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY))
    AND FORMAT_DATE('%Y%m%d', CURRENT_DATE())
    AND event_name = 'page_view'
  GROUP BY 1, 2, 3
)

SELECT
  page_path,
  page_topic,
  page_type,
  page_views,
  CASE
    WHEN page_topic = 'General' AND page_views >= 100 THEN 'URGENT: Needs tagging'
    WHEN page_topic = 'General' THEN 'Untagged'
    ELSE 'Tagged'
  END AS status
FROM page_traffic
ORDER BY
  CASE WHEN page_topic = 'General' THEN 0 ELSE 1 END,
  page_views DESC;


-- ── 2. Coverage rate ──
-- Run separately. Overall percentage of traffic from properly tagged pages.
-- Target: page_coverage_percent >= 95%. Below 90%, clustering scores are unreliable.

-- SELECT
--   COUNTIF(page_topic != 'General') AS tagged_pages,
--   COUNT(*) AS total_pages,
--   ROUND(SAFE_DIVIDE(COUNTIF(page_topic != 'General'), COUNT(*)) * 100, 1) AS page_coverage_percent,
--   SUM(CASE WHEN page_topic != 'General' THEN page_views ELSE 0 END) AS tagged_views,
--   SUM(page_views) AS total_views,
--   ROUND(SAFE_DIVIDE(
--     SUM(CASE WHEN page_topic != 'General' THEN page_views ELSE 0 END),
--     SUM(page_views)) * 100, 1
--   ) AS view_coverage_percent
-- FROM page_traffic;


-- ── 3. Topic cluster distribution ──
-- Run separately. Shows traffic distribution across topic clusters.
-- High "General" share indicates taxonomy debt.

-- SELECT
--   page_topic,
--   COUNT(DISTINCT page_path) AS page_count,
--   SUM(page_views) AS total_views,
--   ROUND(SAFE_DIVIDE(SUM(page_views), (SELECT SUM(page_views) FROM page_traffic)) * 100, 1)
--     AS view_share_percent
-- FROM page_traffic
-- GROUP BY 1
-- ORDER BY total_views DESC;
