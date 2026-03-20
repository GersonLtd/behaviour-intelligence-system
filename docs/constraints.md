# Constraints and Limitations

---

## Analytical Constraints
- **Probabilistic, not deterministic.** All classifications are estimates. Treat states as most likely interpretation.
- **Multi-signal required.** Require at least 3 signals before assigning any state above low confidence.
- **Small data = low confidence.** Sites with < 500 sessions/month: use fixed-rule scoring, avoid percentile normalisation.
- **Motivation is inferred, not observed.** Never replace behavioural states with motivation tags.
- **No low-confidence motivation.** Do not assign motivation when confidence is 0–3.
- **No psychological overreach.** Describe behavioural patterns, not internal mental truth.

## Data Quality Constraints
- **Taxonomy completeness.** Untagged pages distort clustering. Audit before trusting outputs.
- **Event reliability.** Missing or double-firing events corrupt scores. Validate in GA4 DebugView.
- **Cross-device identity.** GA4 relies on cookies. Device/browser switching splits history. Known limitation for temporal signals.
- **B2B-specific risk.** Without User-ID, Returning Evaluator fragments into separate Scanner sessions. User-ID is a practical requirement for B2B.

## User-ID Strategy

Temporal states (Returning Evaluator, Re-engaged Prospect, Persistent Hesitation, Chronic Stall) depend on linking sessions across visits. Without User-ID, these states are unreliable.

### By site type

| Site type | Strategy | Temporal automation |
|---|---|---|
| **B2B with login/gated content** | Implement GA4 User-ID, linked to CRM identifiers. Required before enabling temporal-triggered automation. | Enable after User-ID is live |
| **B2C marketing (no login)** | Accept temporal fragmentation. Rely on single-session classification and aggregate temporal patterns. | Do not enable individual-level automation |
| **Hybrid (some authenticated pages)** | Implement User-ID for authenticated sessions. Accept fragmentation for anonymous sessions. | Enable only for authenticated users |

### What must NOT be done
- Do not enable automated CRM workflows triggered by temporal states without a User-ID strategy. The false-positive rate will be too high.
- Do not attempt client-side identity stitching — this violates privacy regulations and is unreliable.
- Do not treat `user_pseudo_id` as a stable cross-device identifier — it is cookie-based and resets on browser changes.

## Privacy and Consent
- Session and cross-session tracking requires user consent under GDPR/ePrivacy.
- Do not store PII in GA4 custom parameters.
- Where consent is not granted, degrade to aggregate-only reporting.

## Exclusions
- **Bot/crawler traffic.** Filter before scoring. Verify automated traffic doesn't inflate Scanner/Mismatch.
- **Internal traffic.** Exclude staff and internal IPs.
