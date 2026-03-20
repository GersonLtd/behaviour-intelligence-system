# Dashboard Contract

Defines the exact metrics, formulas, data sources, ownership, alert thresholds, and decision actions for each dashboard view.

---

## State Distribution Dashboard

| Metric | Formula | Source Table | Owner | Alert Threshold | Decision Action |
|---|---|---|---|---|---|
| State distribution (%) | `COUNT(state) / total_sessions * 100` per state | `classified_sessions` | Analytics | Mismatch > 40% of any source | Review traffic source quality |
| Scanner volume trend | `COUNT(Scanner) per week` | `classified_sessions` | Product | +25% week-over-week | Investigate navigation / site structure |
| Evaluator conversion rate | `COUNT(Engaged WHERE prev_state = Evaluator) / COUNT(Evaluator)` | `temporal_analysis` | Growth | < 5% sustained 2 weeks | Review conversion path friction |
| Hesitant drop-off rate | `COUNT(Hesitant WHERE no_conversion_14d) / COUNT(Hesitant)` | `temporal_analysis` | UX | > 70% sustained | Investigate form/booking friction |
| Confidence band split | `COUNT per band / total` | `classified_sessions` | Analytics | Low > 60% | Signal model may need more inputs |

## Transition Flow Dashboard

| Metric | Formula | Source Table | Owner | Alert Threshold | Decision Action |
|---|---|---|---|---|---|
| Scanner → Explorer rate | `COUNT(transition) / COUNT(Scanner)` | `temporal_analysis` | Content | < 20% sustained | Improve value proposition and guided entry |
| Evaluator → Hesitant rate | `COUNT(transition) / COUNT(Evaluator)` | `temporal_analysis` | UX | > 30% sustained | Review conversion path for friction |
| Returning Evaluator → Engaged rate | `COUNT(transition) / COUNT(Returning Evaluator)` | `temporal_analysis` | Growth | < 15% sustained | Review trust/pricing elements |
| Chronic Stall volume | `COUNT(chronic_stall = true)` | `temporal_analysis` | Product | > 10% of returning users | Investigate navigation loops |

## Source Quality Dashboard

| Metric | Formula | Source Table | Owner | Alert Threshold | Decision Action |
|---|---|---|---|---|---|
| Mismatch rate by source | `COUNT(Mismatch) / COUNT(*) per source` | `classified_sessions` | Marketing | > 50% from any paid source | Review targeting / landing pages |
| Evaluator rate by source | `COUNT(Evaluator+) / COUNT(*) per source` | `classified_sessions` | Marketing | < 10% from a major source | Investigate traffic quality |
| Avg confidence by source | `AVG(confidence_score) per source` | `classified_sessions` | Analytics | < 3.0 for any source | Review if source produces sufficient signals |

## Taxonomy Health Dashboard

| Metric | Formula | Source Table | Owner | Alert Threshold | Decision Action |
|---|---|---|---|---|---|
| Coverage rate | `tagged_pages / total_pages_with_traffic` | `taxonomy_audit` | Content | < 90% | Classify untagged high-traffic pages |
| Untagged page views | `SUM(views WHERE page_topic = 'General')` | `signal_scores` | Content | > 5% of total views | Tag pages receiving significant traffic |
| Taxonomy staleness | CMS audit: pages not updated in 90 days | CMS (external) | Content | > 20 stale entries | Review and update CMS metadata |

## Action Effectiveness Dashboard

| Metric | Formula | Source Table | Owner | Alert Threshold | Decision Action |
|---|---|---|---|---|---|
| Intervention success rate | `COUNT(improved_state) / COUNT(interventions)` per state | `action_log` | Growth | < 20% for any state | Review action mapping or execution |
| False positive rate | `COUNT(incorrect_classifications) / COUNT(high_confidence)` | `validation_log` | Analytics | > 15% | Recalibrate thresholds |
| Time to action | `AVG(days from classification to intervention)` | `action_log` | Ops | > 7 days for automated actions | Review automation pipeline |

---

## Refresh Cadence

| Dashboard | Refresh | Minimum Data |
|---|---|---|
| State Distribution | Daily | 30 users per state |
| Transition Flow | Weekly | 2+ weeks of data |
| Source Quality | Weekly | 100+ sessions per source |
| Taxonomy Health | Monthly | Full month of traffic |
| Action Effectiveness | Monthly | 30+ interventions per state |

## Prescriptive Output Dashboard

| Metric | Formula | Source Table | Owner | Alert Threshold | Decision Action |
|---|---|---|---|---|---|
| Prescription per state | Template interpolation from `PRESCRIPTION_TEMPLATES` | `dashboard_prescriptive` | Growth | N/A — always generated | Read and act on the top 3 by session count |
| Top blocked page (Hesitant) | Page with highest `form_start` without `form_submit` | `classified_sessions` | UX | blocked_count > 20/week | Fix form friction on that page |
| Top friction element (Stalled Friction) | Element with highest `rage_click` or `dead_click` count | `classified_sessions` | UX Engineering | friction_count > 10/week | Fix the broken interaction |

---

## GA4 Thresholding Note

GA4 suppresses rows when user counts are small (< ~10 users in a segment). For reliable dashboards:
- Use BigQuery export for unsampled data
- Use wider date ranges when segment volumes are low
- Do not draw conclusions from segments with fewer than 30 users
