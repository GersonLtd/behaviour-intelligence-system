# Behaviour Intelligence System

A behavioural intelligence framework for websites and digital products. Built for analytics leads, product teams, and growth teams who want to move beyond "what happened" reporting toward "what should we do next."

Traditional analytics tells you how many users visited, where they clicked, and which pages they viewed. This system answers a different question:

**What is this visitor trying to do, how confident are we, and what should we change as a result?**

Instead of reporting on the past, it classifies live visitor behaviour into actionable states, scores how confident you should be in that classification, and tells you what to do about it.

### What makes it work

Like any analytics product, the system needs to be configured for your site before it delivers value. Three things matter:

1. **Taxonomy quality** — every page on your site needs to be tagged with a page type and topic cluster. Without this, the signals that drive classification are meaningless. This is the most important step, and it happens before any code runs.
2. **Someone acting on the outputs** — the system produces prescriptive recommendations (e.g. "reduce form friction on the contact page"), but they need a human or a downstream system to turn them into actual changes. Dashboards that nobody reads don't improve anything.
3. **Calibration over time** — the default thresholds are educated starting points, not tuned to your specific site. After a few months of real data, you'll want to review and adjust them to match your traffic patterns.

The setup guide below walks through all three.

---

## Key Concepts

A few terms you'll see throughout this guide:

**Signal** — A measurable indicator of behaviour. The system uses four:
- **Breadth** — how much they explore (pages, page types, topics visited)
- **Depth** — how deeply they engage (time on page, scroll depth, repeat reading)
- **Progression** — how far they move toward action (CTA clicks, form starts, conversions)
- **Clustering** — how focused they are on one topic versus scattered across many

**State** — A classification that describes where a visitor currently sits on the journey from awareness to action. For example, "Scanner" means browsing widely but shallowly, while "Evaluator" means reading deeply and moving toward a decision.

**Confidence** — A score (0-10) measuring how certain the system is about a classification. Low confidence means the evidence is thin; high confidence means the signals are strong and consistent. Confidence controls what actions the system is allowed to take — low confidence produces reports, not interventions.

**Taxonomy** — A register that tags every page on the site with a page type (e.g. "service page") and topic cluster (e.g. "pricing"). This is what makes clustering measurable. Without it, the system cannot distinguish focused evaluation from random browsing.

**Motivation** — An optional inference about what a visitor may be seeking (e.g. "risk-sensitive" or "proof-focused"), based on observed behaviour. Always secondary to state, and only assigned when confidence is medium or high.

---

## How It Works

The core principle is a loop:

```
Behaviour  →  State  →  Response  →  Outcome  →  Learning
                                                    ↓
                                            (refine and repeat)
```

Under the hood, this plays out across six layers:

1. **Collect** — raw events from GA4/GTM (clicks, scrolls, form interactions, friction signals)
2. **Score** — convert raw events into four signals, each scored 0-10
3. **Classify** — assign one of 10 behavioural states based on signal patterns
4. **Confidence** — score how certain the classification is (0-10)
5. **Act** — map state + confidence to a prescriptive response
6. **Learn** — measure outcomes, refine thresholds, repeat

An optional motivation layer can refine the action content (e.g. "this Evaluator is proof-focused — surface case studies rather than pricing") but only when confidence is medium or high.

### The 10 States

| State | What it means | Typical action |
|---|---|---|
| **Mismatch** | Landed and left immediately. Likely wrong audience or a poor landing page. | Review traffic source quality and landing page relevance |
| **Scanner** | Browsing widely but shallowly — clicking around without reading deeply. On a poorly structured site, this often signals a lost user, not a curious one. | Improve navigation clarity and value proposition |
| **Explorer** | Moderate exploration with emerging structure — actively learning what you offer. | Surface guided pathways and related content |
| **Comparator** | Moderate depth across multiple options — comparing services, plans, or approaches. | Provide comparison tools, differentiators, and proof |
| **Evaluator** | Deep and focused — seriously assessing your solution with sustained attention. | Add case studies, implementation details, FAQs |
| **Focused Evaluator** | Very narrow, very deep, high progression — strongly aligned with one offering. | Personalise with offer-specific content and direct CTA |
| **Hesitant** | Started a high-intent action (form, booking) but didn't complete it. Intent is present but something blocked them. | Reduce form friction, add trust signals, simplify the step |
| **Stalled** | Engaged but stuck — looping through pages without progressing. If friction signals (rage clicks, dead clicks) are present, classified as Stalled (Friction). | Simplify navigation (or fix the broken interaction for Friction) |
| **Engaged** | Converted and continuing — validating their decision or onboarding. | Support onboarding, confirm next steps |
| **Returning Evaluator** | Multi-session visitor whose intent is strengthening over time. | Acknowledge return, surface what changed, provide direct path |

Each state maps to a prescriptive action. Actions are **confidence-gated**: low confidence produces reports for review, not automated interventions.

---

## Setup Guide

### What You Need

- **Google Analytics 4** property
- **Google Tag Manager** container deployed on your site
- **BigQuery** project linked to GA4 (for the SQL pipeline and dashboards)
- **Node.js 18+** (for running tests and the JavaScript classification engine)

### Phase 1: Tag Your Content (Taxonomy)

Before any tracking is useful, your pages need metadata. The system's clustering signal depends entirely on this — without it, you cannot distinguish a focused evaluator from a scattered scanner.

Every page needs two fields, assigned in your CMS at publish time:

| Field | Required? | What it is | Example |
|---|---|---|---|
| `page_type` | **Required** | The structural type of the page | homepage, service, blog, pricing, contact |
| `page_topic` | **Required** | The topic cluster the page belongs to | strategy, pricing, proof, onboarding |
| `intent_weight` | Optional | Override for business significance (0.5-2.0) | Only needed when a page's weight should differ from its type's default |

You don't need to set `intent_weight` on every page. The system already maps each `page_type` to a default weight (e.g. homepage = 0.5, service = 1.0, pricing = 1.5, contact = 2.0 — see `src/config.js`). Only set `intent_weight` when a specific page should deviate from its type's default — for example, a blog post that functions as a sales page.

For high-value interactive elements (CTAs, booking buttons), you can also add `data-element-role` and `data-element-weight` attributes so the system scores element-level intent independently of the page.

**Getting started — generate a draft taxonomy from your sitemap:**

```bash
node tools/taxonomy-bootstrap.js https://yoursite.com/sitemap.xml --output=taxonomy-draft.csv
```

This fetches your sitemap, infers `page_type` and `page_topic` from URL patterns, and outputs a draft register. It typically gets 70-80% right — you review and correct the rest rather than starting from scratch. See `tools/taxonomy-bootstrap.js --help` for options.

**Then implement in your CMS:**

1. Read `docs/taxonomy-register.md` for the full architecture and HTML examples
2. Add `page_type` and `page_topic` as required fields in your CMS
3. Embed them as data attributes on the `<body>` tag or as `<meta>` tags
4. Optionally add `intent_weight` where a page deviates from its type's default
5. Tag high-value elements with `data-element-role` and `data-element-weight`

If your CMS cannot enforce required fields yet, use the bootstrap output as the external register fallback (import into Google Sheets or Airtable). See `docs/taxonomy-register.md`. Migrate to CMS-first as soon as possible.

**Target:** 95%+ of pages with traffic should carry proper taxonomy tags. Below 90%, clustering scores become unreliable and you will see false Scanners and false Mismatches.

### Phase 2: Configure Data Collection (GA4 + GTM)

**Quick start — import the pre-built GTM container:**

```
GTM Admin → Import Container → gtm/gtm-container-template.json → Merge → Rename conflicting tags
```

This gives you all event tags, friction detectors, data layer variables, and consent gates in one import. Set your GA4 Measurement ID in the `{{GA4 Measurement ID}}` variable, verify in GA4 DebugView, and publish. See `docs/ga4-gtm-implementation.md` for the full manual setup and customisation reference.

**What the container includes:**

**Data layer and variables** — your site pushes CMS metadata (page type and topic, plus optional intent weight override) into the GTM data layer on every page load. GTM reads these into variables that get attached to every event.

**10 GA4 events** — page views, scrolls, CTA clicks, form starts/submits, resource downloads, navigation clicks, section views, booking clicks, and conversion completions. Each event carries the taxonomy parameters from the data layer.

**6 custom dimensions** — registered in GA4 so the parameters are available in reports and BigQuery: `page_type`, `page_topic`, `conversion_stage`, `content_role`, `offer_id`, `traffic_source_group`.

**Friction detection** — five GTM scripts (in the `gtm/` folder) detect UX problems in real time:

| Script | What it detects |
|---|---|
| `rage-click-detector.js` | 3+ rapid clicks on the same element — signals frustration |
| `dead-click-detector.js` | Clicks on non-interactive elements — signals confusion |
| `form-error-tracker.js` | Form validation failures — signals form friction |
| `traffic-source-classifier.js` | Groups traffic sources for source bias scoring |
| `element-metadata-reader.js` | Reads element-level role and weight from clicked elements |

**Validation** — a checklist in the implementation guide confirms all events fire correctly before you go live.

**Important:** All GTM listeners must be gated behind consent mode for GDPR/ePrivacy compliance. See `docs/constraints.md`.

**GA4 dimension budget:** This framework uses 6 of GA4's 50 event-scoped custom dimension slots. If your property already uses 40+, audit existing dimensions before rollout or use BigQuery export where limits don't apply.

### Phase 3: Build the BigQuery Pipeline

Enable BigQuery export in your GA4 property settings. Once data is flowing, deploy the full SQL pipeline with one command:

```bash
./deploy.sh --project=your-gcp-project --dataset=bi_system --ga4-dataset=analytics_123456789
```

This substitutes your project/dataset names into all six SQL files and runs them in order. Use `--dry-run` to preview without executing. The script creates the dataset if it doesn't exist and runs validation checks at the end.

The six steps it runs:

| Step | File | What it does |
|---|---|---|
| 1 | `sql/01-signal-scores.sql` | Calculates the four signal scores + friction metrics + element weights from raw GA4 events |
| 2 | `sql/02-state-classification.sql` | Assigns a state and confidence score to each session |
| 3 | `sql/03-temporal-analysis.sql` | Analyses multi-session behaviour — returning visitors, trends, velocity |
| 4 | `sql/04-taxonomy-audit.sql` | Reports taxonomy coverage gaps. Run this monthly. |
| 5 | `sql/05-dashboard-views.sql` | Creates 9 materialised views that feed Looker Studio dashboards |
| 6 | `sql/06-validation-queries.sql` | Post-deployment checks — run after initial setup to verify data integrity |

### Phase 4: Build the Dashboards

Two documents guide you through this:

1. **`dashboard-contract.md`** — the specification. Defines every metric, its formula, data source, owner, alert threshold, and what decision to make when the threshold is breached.
2. **`looker-studio-template.md`** — the build guide. Step-by-step instructions for creating 8 Looker Studio pages with exact chart specifications, dimensions, filters, sort orders, and theme tokens.

The 8 dashboard pages:

| Page | What it answers |
|---|---|
| State Distribution | How are visitors distributed across states? Is any state growing unexpectedly? |
| Conversion by State | Which states convert? Where do visitors get stuck? |
| State Transitions | How do visitors move between states over time? |
| Source Quality | Which traffic sources produce evaluators vs. mismatches? |
| Confidence Distribution | How certain are classifications? Is the signal model producing enough evidence? |
| Problem-First View | What are the top business problems right now, mapped to states? |
| Taxonomy Health | What percentage of pages are properly tagged? Where are the gaps? |
| Prescriptive Output | Plain-language instructions: what to do, for which state, right now. |

### Phase 5: Calibrate and Iterate

The system ships with default thresholds that work as sensible starting points. After collecting **3+ months of data**, calibrate for your site:

1. **Percentile analysis** — compare your visitors' signal distributions to replace fixed thresholds with site-specific percentile boundaries. The JS engine supports both modes (`scoreAllSignals` for fixed, `scoreAllSignalsPercentile` for percentile-based).
2. **Review cadence** — follow `docs/feedback-loop.md`:
   - **Weekly:** check state distributions and conversion rates by state
   - **Monthly:** review confidence distributions, action effectiveness, threshold accuracy, taxonomy coverage
   - **Quarterly:** recalibrate score ranges using percentile analysis; reassess state definitions against real journeys
3. **Guardrails** — before changing any threshold, verify against the KPI guardrails and rollback triggers in `docs/feedback-loop.md`. Changes that shift more than 15% of classifications or drop conversion rates should be reverted.

---

## Using the JavaScript Engine

The `src/` modules implement the full classification pipeline in JavaScript (ES modules). Use them for real-time classification, testing, or server-side integration.

### Quick start

The fastest way to see the system in action — pass four signal scores and get a classification:

```bash
node src/interactive-classifier.js 5 7 4 6
# Arguments: breadth depth progression clustering
# → State:      Evaluator
# → Confidence: Medium
# → Action:     Add case studies, implementation details, FAQs, proof elements
```

For full pipeline evaluation with raw session data:

```javascript
import { evaluateVisitor } from './src/pipeline.js';

const result = evaluateVisitor({
  sessionData: {
    trafficSource: 'organic_search',
    breadthMetrics: { uniquePages: 6, uniquePageTypes: 4, uniqueTopics: 3 },
    depthMetrics: { engagementTimeSeconds: 120, avgScrollPercent: 80, deepEngagementEvents: 1 },
    events: [
      { eventName: 'page_view', pageType: 'service' },
      { eventName: 'cta_click', pageType: 'pricing' },
      { eventName: 'form_start', pageType: 'contact' }
    ],
    clusteringMetrics: {
      dominantTopicShare: 0.7,
      topicSwitchCount: 2,
      repeatClusterVisits: 3,
      totalPageViews: 6
    }
  },
  userHistory: []
});

console.log(result.classification.state);  // "Evaluator"
console.log(result.confidence.band);       // "medium"
console.log(result.action);               // prescriptive action object
```

### Module reference

| Module | What it does |
|---|---|
| `src/config.js` | All weights, thresholds, state definitions, and action mappings in one place |
| `src/signals.js` | Converts raw session metrics into four scored signals (0-10) |
| `src/classifier.js` | Assigns a state using priority-ordered rules + hybrid detection |
| `src/confidence.js` | Scores classification certainty using 5 factors + contradiction penalties |
| `src/temporal.js` | Analyses cross-session behaviour (recency, frequency, velocity, trend) |
| `src/refinements.js` | Detects content sub-types and infers motivation signals |
| `src/action.js` | Resolves the prescriptive action (confidence-gated, hybrid-aware) |
| `src/pipeline.js` | Orchestrates the full pipeline: score, classify, confidence, refine, act |
| `src/interactive-classifier.js` | Standalone CLI tool for quick state lookups |

---

## Running Tests

```bash
npm test                       # Runs everything
node test/unit-tests.js        # Focused unit tests for core logic
node test/test-runner.js       # 26 integration fixtures covering all states + edge cases
node test/validate-rules.js    # Drift validation: config.js vs state-rules.yml
node test/parity-tests.js      # JS/SQL scoring parity checks
```

---

## Project Structure

```
behaviour-intelligence-system/
|-- README.md                        # This guide
|-- state-rules.yml                  # Machine-readable ruleset (reference copy; runtime source is src/config.js)
|-- dashboard-contract.md            # Dashboard metric definitions, owners, alert thresholds
|-- looker-studio-template.md        # Complete Looker Studio build guide
|-- KNOWN-LIMITATIONS.md             # Design trade-offs, recommendations, resolved issues
|-- package.json
|-- LICENSE
|
|-- src/                             # JavaScript classification engine (ES modules)
|-- sql/                             # BigQuery SQL pipeline (6 modules, run in order)
|-- gtm/                             # GTM client-side scripts (friction detection, source grouping)
|-- test/                            # Integration fixtures + unit tests
|-- tools/                           # Setup tooling
|   `-- taxonomy-bootstrap.js        # Generate draft taxonomy from sitemap
|-- deploy.sh                        # BigQuery deploy script
|
`-- docs/                            # Operational guides
    |-- ga4-gtm-implementation.md    # Step-by-step GA4/GTM setup
    |-- taxonomy-register.md         # Taxonomy architecture, CMS-first model, maintenance RACI
    |-- feedback-loop.md             # Review cadence, KPI guardrails, rollback triggers
    `-- constraints.md               # Analytical, data quality, and privacy constraints
```

---

## Things to Keep in Mind

**Classifications are estimates, not facts.** The system assigns the most likely state based on available signals. Treat outputs as informed hypotheses, especially at low confidence.

**Confidence is there for a reason.** Low confidence states produce reports for you to review. Only medium and high confidence states trigger prescriptive actions. This is deliberate — acting on thin evidence does more harm than waiting for better data.

**Taxonomy makes or breaks the system.** If pages aren't tagged, the clustering signal is meaningless and you'll see misleading state assignments. Getting taxonomy right (Phase 1) is the single most important step.

**Start with defaults, calibrate later.** The system ships with sensible fixed thresholds. These work out of the box. Switch to percentile-based scoring after you have 3+ months of real data to calibrate against.

**Cross-device identity is a known gap.** GA4 relies on cookies. Returning visitors on different devices appear as new users, which fragments their history and weakens temporal states. If you run a B2B site with login, implement GA4 User-ID. See `docs/constraints.md` for guidance by site type.

For the full list of design trade-offs, edge cases, and recommendations, see `KNOWN-LIMITATIONS.md`.

---

## Licence

MIT — Copyright (c) 2026 Gerson Ltd. See [LICENSE](LICENSE).

Based on the *Behaviour Intelligence Framework* (v1.0, March 2026) by Steven Gerson, Gerson Ltd.
