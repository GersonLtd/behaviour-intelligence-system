# Looker Studio Dashboard Template

Complete build specification for the Behaviour Intelligence System dashboards.
Each section maps to a BigQuery view from `sql/05-dashboard-views.sql`.

---

## Data Sources

| Source Name | BigQuery View | Refresh |
|---|---|---|
| State Distribution | `dashboard_state_distribution` | Daily |
| Conversion by State | `dashboard_conversion_by_state` | Daily |
| State Transitions | `dashboard_state_transitions` | Daily |
| Source Quality | `dashboard_source_quality` | Daily |
| Confidence Distribution | `dashboard_confidence_distribution` | Daily |
| Problem View | `dashboard_problem_view` | Daily |
| Taxonomy Health | `dashboard_taxonomy_health` | Monthly |
| Prescriptive Output | `dashboard_prescriptive` | Daily |

---

## Theme (Inspired by behaviour-intelligence.htm)

Use these report theme values in Looker Studio:

| Token | Hex | Use |
|---|---|---|
| Background | `#f6f8fc` | Page canvas |
| Card | `#ffffff` | Chart containers |
| Border | `#e1e4ec` | Control and table borders |
| Primary Dark | `#143e6f` | Section headers, axis labels |
| Primary | `#225cc7` | Primary trend lines and highlights |
| Primary Light | `#4d8dff` | Secondary trend lines |
| Accent | `#49b0ff` | Emphasis markers |
| Text Main | `#2a2a2a` | Main text |
| Text Muted | `#4b5563` | Supporting text |

Typography:
- Font family: `Inter` (fallback `Segoe UI`, `Arial`, sans-serif)
- Header weight: `700`
- Body weight: `400` to `600`

---

## State Color Map

Apply consistently across all charts:

| State | Hex |
|---|---|
| Mismatch | `#4b5563` |
| Scanner | `#49b0ff` |
| Explorer | `#4d8dff` |
| Comparator | `#225cc7` |
| Evaluator | `#143e6f` |
| Focused Evaluator | `#1a2856` |
| Hesitant | `#f4b740` |
| Stalled | `#cc5a2a` |
| Stalled (Friction) | `#9f2d2d` |
| Engaged | `#2f8f6b` |
| Returning Evaluator | `#2f6f8f` |

---

## Page 1: State Overview

Purpose: at-a-glance view of visitor behaviour distribution and trends.

### Chart 1.1 State Distribution (Stacked Bar)
- Data source: `dashboard_state_distribution`
- Dimension: `session_date`
- Breakdown: `state`
- Metric: `session_count`
- Sort: `session_date` ascending

### Chart 1.2 State Share (Donut)
- Data source: `dashboard_state_distribution`
- Dimension: `state`
- Metric: `session_count`
- Sort: `session_count` descending

### Chart 1.3 KPI Scorecards
- Total Sessions: `SUM(session_count)`
- Unique Users: `SUM(user_count)`
- Avg Confidence: `AVG(avg_confidence)`
- Mismatch Rate: `SUM(CASE WHEN state='Mismatch' THEN session_count ELSE 0 END) / SUM(session_count)`
- Evaluator+ Rate: `SUM(CASE WHEN lifecycle_phase IN ('evaluation','retention') THEN session_count ELSE 0 END) / SUM(session_count)`

### Chart 1.4 Lifecycle Split (100% stacked)
- Data source: `dashboard_state_distribution`
- Dimension: `session_date`
- Breakdown: `lifecycle_phase`
- Metric: `session_count`

---

## Page 2: Conversion Analysis

### Chart 2.1 Conversion Rate by State
- Data source: `dashboard_conversion_by_state`
- Dimension: `state`
- Metric: `conversion_rate_percent`

### Chart 2.2 Conversion Table
- Columns: `state`, `total_sessions`, `converted_sessions`, `conversion_rate_percent`, `avg_confidence_converters`

### Chart 2.3 Converter vs Non-Converter Depth
- Data source: `dashboard_conversion_by_state`
- Dimension: `state`
- Metrics: `avg_depth_converters`, `avg_depth_non_converters`

---

## Page 3: State Transitions

### Chart 3.1 Transition Matrix (Pivot Heatmap)
- Data source: `dashboard_state_transitions`
- Row: `from_state`
- Column: `to_state`
- Metric: `transition_count`

### Chart 3.2 Key Transition Cards
- Scanner -> Explorer share
- Evaluator -> Hesitant share
- Hesitant -> Engaged share
- Returning Evaluator -> Engaged share

---

## Page 4: Source Quality

### Chart 4.1 Source x State Heatmap
- Data source: `dashboard_source_quality`
- Row: `traffic_source`
- Column: `state`
- Metric: `state_share_percent`

### Chart 4.2 Mismatch by Source
- Data source: `dashboard_source_quality`
- Dimension: `traffic_source`
- Metric: `mismatch_rate_percent`

### Chart 4.3 Source Quality Table
- Columns: `traffic_source`, `session_count`, `mismatch_rate_percent`, `avg_confidence`

---

## Page 5: Confidence Monitor

### Chart 5.1 Confidence Band Mix by State
- Data source: `dashboard_confidence_distribution`
- Dimension: `state`
- Breakdown: `confidence_band`
- Metric: `session_count`

### Chart 5.2 Confidence Histogram
- Data source: `dashboard_confidence_distribution`
- Dimension: `confidence_score`
- Metric: `session_count`

### Chart 5.3 Low Confidence Alert
- Formula: `SUM(CASE WHEN confidence_band='low' THEN session_count ELSE 0 END) / SUM(session_count)`
- Alert threshold: > 60%

---

## Page 6: Problem-First View

### Chart 6.1 Problem Summary Table
- Data source: `dashboard_problem_view`
- Columns: `business_problem`, `state`, `user_count`, `conversion_rate_percent`, `avg_confidence`

### Chart 6.2 Problem Volume
- Data source: `dashboard_problem_view`
- Dimension: `business_problem`
- Breakdown: `state`
- Metric: `session_count`

---

## Page 7: Taxonomy Health

### Chart 7.1 Coverage Scorecards
- `page_coverage_percent`
- `view_coverage_percent`
- `urgent_untagged_count`

### Chart 7.2 Coverage Gauge
- Metric: `view_coverage_percent`
- Bands: 0-89 red, 90-94 amber, 95-100 green

---

## Page 8: Prescriptive Instructions

**Purpose:** Natural-language action instructions generated from state classifications and aggregate data. The dashboard tells the team what to do.

### Chart 8.1 — Prescriptive Instructions Table
| Setting | Value |
|---|---|
| Chart type | Table |
| Data source | Prescriptive Output |
| Columns | `state`, `session_count`, `prescription` |
| Sort | `session_count` descending |
| Row height | Auto (prescriptions may be multi-line) |

### Chart 8.2 — Top 3 Priorities (Scorecard Row)
Display the prescriptions for the top 3 states by session volume as large-text scorecards. These are the most impactful instructions.

### Design note
Prescriptions are template-based, not AI-generated. Each state maps to a fixed instruction template with placeholders interpolated from aggregate data. If a placeholder cannot be filled (e.g. no top source identified), the raw placeholder text is shown as a prompt to investigate.

---

## Performance

Looker Studio queries BigQuery views directly on every filter change (date range, confidence band, state). On high-traffic sites with millions of GA4 events this can be slow and expensive.

**Recommended mitigations:**

1. **BigQuery BI Engine** — enable BI Engine on your project to cache query results in memory. This eliminates repeated scans for the same filter combinations and keeps dashboard load times under 2 seconds. Requires a BI Engine reservation (1 GB is usually sufficient for this dataset).

2. **Looker Studio Extracts** — for dashboards that don't need real-time data (most of these are daily refresh), create Extracted data sources instead of live connections. Extracts pre-materialise the query results and serve them from cache, with no BigQuery cost on each page load.

3. **Materialise views as tables** — if BI Engine is not available, schedule the `sql/05-dashboard-views.sql` output as materialised tables (via scheduled queries or `deploy.sh`) rather than querying the underlying views on demand.

---

## Setup Checklist

- [ ] Run `sql/05-dashboard-views.sql` to create all 8 dashboard views.
- [ ] Connect Looker Studio to your BigQuery dataset.
- [ ] Enable BigQuery BI Engine or use Looker Studio Extracts (see Performance above).
- [ ] Build all 8 pages listed above.
- [ ] Apply the theme tokens and state color map.
- [ ] Add date and confidence filters on each relevant page.
- [ ] Enforce minimum sample size interpretation (>= 30 users/segment).

