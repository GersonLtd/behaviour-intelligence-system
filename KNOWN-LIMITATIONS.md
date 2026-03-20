# Known Limitations & Recommendations

This document captures every known limitation, design trade-off, and improvement opportunity in the Behaviour Intelligence System as of 2026-03-19. Each item includes what the issue is, whether it should be addressed, and how.

---

## 1. Focused Evaluator is unreachable for unconverted visitors

**What:** Hesitant (priority 2) requires `progression >= 6 AND depth >= 4`. Focused Evaluator (priority 4) requires `progression >= 6 AND depth >= 7 AND breadth 2-4 AND clustering >= 7`. Because Focused Evaluator's criteria are a strict subset of Hesitant's, any unconverted visitor matching Focused Evaluator will be caught by Hesitant first. The only way to reach Focused Evaluator is if `temporal.conversionComplete === true` (a returning visitor with a prior conversion).

**Why it exists:** The source framework specification (Section 7, Step 4) explicitly states "Hesitant overrides Focused Evaluator." The rationale is that a visitor who has started but not completed a high-intent action (form, booking) is more immediately actionable than one who is deeply engaged but hasn't started converting.

**Should it be changed:** No, not unless real-world data shows that Focused Evaluators are being incorrectly treated as Hesitant. The priority order comes from the original framework design and reflects a deliberate business decision: interrupted conversions are more urgent than deep evaluation.

**What to watch:** If the Hesitant state consistently captures visitors who are deeply engaged but haven't started a form (i.e. they have high progression from CTA clicks and deep page views, not from form starts), consider adding a `form_start` requirement to Hesitant to distinguish "interrupted conversion" from "deep evaluation with high intent."

---

## 2. Single-visitor prescriptions have unfilled placeholders

**What:** The prescriptive templates in `src/action.js` use placeholders like `{topSource}`, `{topLandingPage}`, `{topBlockedPage}`, and `{topFrictionElement}`. At the single-visitor level (via `evaluateVisitor()`), these aggregate values are not available. Only `{sessionCount}`, `{blockedCount}`, and `{trafficSource}` can be filled from session data. Unfilled placeholders appear literally in the output (e.g. `"Review traffic quality from {topSource}"`).

**Why it exists:** Aggregate context (which source produces the most Mismatches, which page blocks the most Hesitant users) requires querying across all sessions, not just the current one. The SQL dashboard view (`dashboard_prescriptive`) fills these from aggregate data, but the JS pipeline processes one visitor at a time.

**Mitigation:** The caller of `evaluateVisitor()` can supply a `prescriptionContext` object with aggregate values:

```javascript
evaluateVisitor({
  sessionData: { ... },
  prescriptionContext: {
    topSource: 'social_media',
    topBlockedPage: '/contact',
    sessionCount: 312
  }
});
```

The SQL path (`sql/05-dashboard-views.sql`, View 8) generates prescriptions with full aggregate context and is the primary prescriptive output channel.

**What should NOT be done:** Do not add cross-session queries to the single-visitor JS pipeline. It should remain stateless and fast. Aggregate prescriptions belong in SQL/dashboards.

---

## 3. Taxonomy ownership (RACI) not defined

**What:** The CMS-first taxonomy model requires that every page has `page_type`, `page_topic`, and `intent_weight` assigned at publish time. The monthly audit requires checking pages with `page_topic = 'General'`. But no named owner, SLA, or escalation path is defined for these responsibilities.

**Why it exists:** Ownership is an organisational decision, not a technical one. It depends on team structure.

**Should it be changed:** Yes. Before deploying the system, define:

| Responsibility | Owner | SLA |
|---|---|---|
| Tag new pages at publish | Content author (via CMS required fields) | Before publish, enforced by CMS |
| Monthly taxonomy audit | Analytics lead | Report by 5th of each month |
| Fix untagged pages (100+ views) | Content author | Within 5 business days of audit |
| Review element weights quarterly | Product lead + Analytics lead | By end of quarter |
| Threshold recalibration | Analytics lead | Quarterly, per `docs/feedback-loop.md` |

**What should NOT be done:** Do not make taxonomy ownership optional or shared without a named accountable person. Shared ownership means no ownership.

---

## 4. User-ID strategy not defined for cross-device identity

**What:** GA4 identity relies on cookies and optional User-ID. Without User-ID, visitors who switch devices, use private browsing, or clear cookies appear as new users. This fragments their behavioural history, splitting a Returning Evaluator into multiple Scanner sessions. Temporal states (Returning Evaluator, Re-engaged Prospect, Persistent Hesitation, Chronic Stall) are all affected.

**Why it exists:** User-ID requires authenticated sessions (login, gated content, CRM integration). Many sites have no login mechanism.

**Should it be changed:** Depends on the site type:

- **B2B sites with login/gated content:** User-ID is a practical requirement. Implement via GA4's User-ID feature, linked to CRM identifiers. Without it, temporal automation should not be enabled.
- **B2C marketing sites without login:** Accept temporal fragmentation as a known limitation. Rely on single-session classification (which does not require identity) and aggregate temporal patterns (which are statistically robust even with fragmentation).
- **Hybrid sites:** Implement User-ID for authenticated pages; accept fragmentation for anonymous pages.

**What should NOT be done:** Do not enable automated CRM workflows triggered by temporal states without a User-ID strategy. The false-positive rate will be too high. Do not attempt to stitch identity client-side.

---

## 5. Confidence scoring can over-reward long confused sessions

**What:** The `session_depth` confidence factor awards 2 points for sessions >= 2 minutes with 5+ pages. A confused visitor looping through pages for 3 minutes could score high on session depth despite low-quality engagement.

**Why it exists:** Session depth is a reasonable signal that more data = more confidence. The contradiction penalty (depth >= 7 + progression <= 2 + breadth >= 5 = -1 to confidence) partially mitigates this, but only for the specific pattern of deep + wide + no progression.

**Should it be changed:** Monitor, but not immediately. If calibration data shows that high-confidence Stalled classifications lead to incorrect interventions, add a second contradiction penalty for loop detection:

```
IF repeat_page_views >= 3 AND progression <= 2 THEN confidence -= 1
```

**What should NOT be done:** Do not remove session depth as a confidence factor. Longer sessions with more pages genuinely provide more evidence for classification. The fix is better contradiction detection, not removing the positive signal.

---

## 6. Minimum data volume required for meaningful confidence scores

**What:** The confidence scoring system (`02-state-classification.sql`, `src/confidence.js`) uses five factors (signal count, signal strength, state clarity, session depth, temporal consistency), each scoring 0–2. On low-traffic sites (under ~500–1,000 sessions per month), most sessions will lack the diversity of event types and multi-session patterns needed to score above the "low" confidence band (0–3). The system will effectively stay in a fixed-rules mode where classifications are produced but flagged as low confidence.

**Why it exists:** The confidence model is designed to be honest about uncertainty. With sparse data, there genuinely isn't enough evidence to distinguish a Scanner from an Explorer or to detect temporal patterns like Returning Evaluator. This is correct behaviour, not a bug.

**Minimum thresholds (guidelines):**

| Confidence level | Approximate minimum | What unlocks |
|---|---|---|
| Low-confidence classifications usable | ~100 sessions/month | Single-session states (Scanner, Explorer, Mismatch) begin appearing, but most will be low confidence. Useful for directional insights only. |
| Medium-confidence classifications | ~500 sessions/month | Enough event diversity for signal count/strength factors to contribute. State distribution becomes meaningful for dashboard reporting. |
| Temporal states reliable | ~1,000 sessions/month with returning users | Multi-session patterns (Returning Evaluator, Persistent Hesitation) require repeat visits. Sites with high bounce rates need more volume. |
| High-confidence automated actions safe | ~2,000+ sessions/month | Confidence bands stabilise enough to trigger CRM workflows or personalisation without excessive false positives. |

**What to do:**

- In deployment documentation, set expectations: the system has a learning phase. On low-traffic sites, expect 2–4 weeks before the state distribution is stable enough to act on.
- Do not enable automated CRM/personalisation actions until the `dashboard_confidence_distribution` view shows at least 30% of sessions in the "medium" or "high" confidence band.
- For very low traffic sites (<100 sessions/month), the system still provides useful aggregate insights (e.g. "most visitors are Scanners") but individual session classifications should not drive automated actions.

**What should NOT be done:** Do not lower confidence thresholds to compensate for low traffic. The confidence model is correctly reflecting uncertainty. Lowering thresholds would increase false positives and erode trust in the system's recommendations.

---

## 7. Interactive classifier cannot test temporal or friction states

**What:** The interactive classifier (`src/interactive-classifier.js`) takes 4 signal scores and returns a state. It cannot test Returning Evaluator (requires multi-session data), Re-engaged Prospect (requires 30+ day gap), or Stalled (Friction) (requires friction signals).

**Should it be changed:** No. This is an inherent limitation of a 4-slider tool. Adding more inputs would make it less useful as a quick testing tool.

---

## 8. Config generator uses a naive YAML parser

**What:** `tools/generate-config.js` parses `state-rules.yml` with line-by-line regex matching rather than a full YAML parser. It does not support advanced YAML features such as folded multi-line strings (`>`), flow sequences on continuation lines, or anchors/aliases.

**Why it exists:** The project has zero runtime dependencies. Adding `js-yaml` solely for the config generator would introduce a dependency for a build-time tool that runs against a controlled file. The YAML structure is simple and owned by the same team that owns the parser.

**Should it be changed:** Not unless the YAML grows beyond the parser's capability. The full test suite (validate-rules.js + parity-tests.js) runs against the generated output on every `npm test`, so any parser failure surfaces immediately. If a future contributor needs multi-line strings or complex YAML features, `npm install js-yaml` is a one-line fix at that point.

**What should NOT be done:** Do not pre-emptively add the dependency "just in case." The current parser is tested, sufficient, and keeps the dependency count at zero.

---

## 9. deploy.sh requires manual execution

**What:** `deploy.sh` wraps the full SQL pipeline (signal scores → state classification → temporal analysis → dashboard views) into a single script. It supports both full backfill (`--mode=full`) and incremental daily runs (`--mode=incremental`). However, it must be run manually or scheduled externally — there is no built-in cron, Cloud Scheduler, or orchestration integration.

**Why it exists:** Scheduling is infrastructure-specific. The script is designed to be wrapped by whatever orchestration the deploying team uses, not to prescribe one.

**Should it be changed:** For production deployments, the SQL steps should be scheduled via one of:

| Option | Best for |
|---|---|
| **BigQuery Scheduled Queries** | Simplest. Native to GCP, no infrastructure to manage. Set each SQL step as a scheduled query with dependencies. |
| **dbt** | Teams already using dbt for analytics engineering. Provides version control, testing, and dependency graphs. |
| **Cloud Composer (Airflow)** | Part of a larger data pipeline with non-SQL steps or cross-system dependencies. |

`deploy.sh` remains useful for initial deployment, ad-hoc backfills, and local development.

**What should NOT be done:** Do not run `deploy.sh` via a system cron on a VM as a production solution. It lacks retry logic, alerting, and dependency tracking that orchestration tools provide.

---

## 10. Layout shift detection is unavailable on Safari and Firefox

**What:** The Layout Shift Detector (`gtm/layout-shift-detector.js`) uses the `layout-shift` PerformanceObserver entry type, which is only supported in Chromium browsers (Chrome, Edge, Opera). Safari (all iOS browsers, macOS Safari) and Firefox do not implement it. The detector is a silent no-op in those browsers — no error, but no data.

**The bias this creates:** An iPhone user and an Android user can experience the exact same broken, jumping page. The Android user gets classified as **Stalled (Friction)** because the layout shift event fires. The iPhone user gets classified as plain **Stalled** because the sensor doesn't exist on their device. This means the "Stalled (Friction)" state will naturally skew towards desktop and Android traffic — not because iOS users experience less friction, but because the instrument is blind on Apple devices.

**Who needs to know:** Anyone consuming the Stalled vs Stalled (Friction) split in dashboards or audience segments. When comparing friction rates across device types or browsers, the absence of layout shift data on Safari/iOS must be accounted for. A low friction rate on iOS does not mean iOS users are having a better experience.

**Mitigation options:**

| Approach | Trade-off |
|---|---|
| **Segment friction reports by browser engine** | Simplest. Show friction breakdowns for Chromium-only traffic so the comparison is apples-to-apples. |
| **Exclude layout shift from cross-browser comparisons** | Compare Stalled (Friction) only on rage clicks, dead clicks, and form errors when the audience includes Safari/Firefox. |
| **Use CrUX or RUM data as a supplement** | Google's Chrome UX Report provides CLS data at the origin level, which can fill the gap directionally, though not at the individual session level. |

**Should it be changed:** No code change needed — the detector correctly degrades to a no-op. The bias is inherent to browser API availability and must be handled at the analysis layer, not the collection layer.

---

## Resolved

Items that were identified as limitations and have since been fixed.

| # | Issue | Resolution |
|---|---|---|
| R1 | No `package.json` or test script | Added. `npm test` runs unit tests, fixture tests, and YAML drift validation. |
| R2 | SQL missing source bias on progression | Added source bias (±1 capped) to `sql/01-signal-scores.sql`. |
| R3 | SQL missing Stalled (Friction) detection | Added `friction_metrics` CTE and split Stalled/Stalled (Friction) in SQL. |
| R4 | SQL element weights used 2-level priority (JS uses 3-level) | SQL progression scoring now uses `COALESCE(element_weight, CASE element_role ... END, intent_weight)` matching JS. |
| R5 | SQL clustering score produced decimals (JS produces integers) | Changed `ROUND(..., 1)` to `ROUND(...)` in `sql/01-signal-scores.sql`. |
| R6 | SQL confidence signal strength factor diverged from JS | Rewritten to check `form_starts/form_submits` for score 2, `raw_progression_sum > 0` for score 1. |
| R7 | SQL temporal trend required 3 sessions for "reinforcing" (JS requires 2) | Removed `total_sessions >= 3` gate in `sql/03-temporal-analysis.sql`. |
| R8 | SQL View 5 used `PARTITION BY state` instead of `effective_state` | Fixed in `sql/05-dashboard-views.sql`. |
| R9 | SQL View 0 referenced itself (`combined_sessions` FROM `combined_sessions`) | Fixed to reference `classified_sessions`. |
| R10 | Breadth scoring: 8 pages with <3 types leapfrogged to score 9 | Added catch-all threshold (score 5) for 6-8 pages with low type diversity. |
| R11 | Element weights not validated in SQL | Validation queries added to `sql/06-validation-queries.sql`. |
| R12 | Test-runner diverged from pipeline temporal handling | Test-runner now includes current session in temporal context, matching pipeline. |
| R13 | No temporal state testing in fixtures | Persistent Hesitation and Chronic Stall fixtures added. |
| R14 | Session depth used strict `> 120s` threshold | Changed to `>= 120` in `src/confidence.js`. |
| R15 | GTM scripts lacked consent enforcement in code | Consent Mode v2 gate added to all 4 GTM scripts. |
| R16 | `state-rules.yml` claimed to be canonical source of truth | Header updated; drift validation test (`test/validate-rules.js`) added. |
