# Feedback Loop

The system improves through a continuous cycle: **Observe → Classify → Act → Measure → Refine**.

---

## The Cycle

| Step | Action |
|---|---|
| **1. Observe** | Collect behavioural data through GA4 events and parameters |
| **2. Classify** | Assign states and confidence scores using the signal model and classification logic |
| **3. Act** | Trigger the appropriate response based on state and confidence |
| **4. Measure** | Track the defined success metric for each action. Did the intervention change behaviour? |
| **5. Refine** | Adjust thresholds, weights, and state definitions based on measured outcomes |

## Refinement Examples

- If many Explorers convert without passing through Evaluator → lower the Explorer → Evaluator boundary
- If Hesitant users rarely convert after intervention → investigate structural form friction
- If confidence scores cluster around medium → signal model may need additional inputs or thresholds are too conservative

## Review Cadence

| Frequency | Review |
|---|---|
| **Weekly** | State distributions and conversion rates by state |
| **Monthly** | Confidence distributions, action effectiveness, threshold accuracy, taxonomy coverage |
| **Quarterly** | Recalibrate score ranges using percentile analysis; reassess state definitions against actual journeys |

---

## KPI Guardrails for Threshold Changes

Before changing any threshold, weight, or state boundary, define acceptance criteria and rollback conditions.

### Acceptance criteria (must ALL be met before a change ships)

| Criterion | Measurement | Threshold |
|---|---|---|
| Classification stability | % of sessions whose state changed vs previous thresholds | < 15% shift |
| Conversion correlation | Does the new threshold improve conversion prediction accuracy? | Lift ≥ 5% |
| Confidence distribution | Does the change reduce low-confidence share? | Low band ≤ 50% |
| No state collapse | No single state absorbs > 50% of all sessions | Max share < 50% |

### Rollback triggers (revert immediately if ANY are met)

| Trigger | Measurement | Threshold |
|---|---|---|
| Conversion rate drop | Site-wide conversion rate vs pre-change baseline | Drop > 10% sustained 7 days |
| False positive spike | Manual review of high-confidence classifications | Error rate > 20% |
| State distribution collapse | One state captures majority of traffic | Any state > 60% |
| Action effectiveness drop | Interventions stop producing measured improvement | Lift drops to ≤ 0% for 14 days |

### Change process

1. Document the proposed change and its rationale
2. Run the new thresholds against 30 days of historical data in BigQuery
3. Compare state distributions, conversion correlations, and confidence distributions
4. If acceptance criteria are met, deploy to production
5. Monitor rollback triggers daily for 14 days after deployment
6. If any rollback trigger fires, revert to previous `state-rules.yml` and investigate
