# Taxonomy & Metadata Architecture

The clustering signal is only as reliable as the taxonomy behind it. This document defines how taxonomy metadata reaches the analytics engine.

---

## CMS-Embedded Metadata (Primary)

Strategic meaning is a property of the content, not a secondary layer. Every page and interactive element should carry its own metadata, assigned at the moment of creation within the CMS.

### Page-level metadata

When a page is published, the CMS assigns two required fields stored as hidden metadata in the HTML:

| Field | Required? | Description | Example values |
|---|---|---|---|
| `page_type` | **Required** | The structural type of the page | homepage, service, blog, case_study, pricing, contact |
| `page_topic` | **Required** | The topic cluster the page belongs to | strategy, proof, pricing, onboarding, product_a |
| `intent_weight` | Optional | Override for business significance (0.5–2.0) | Only set when a page deviates from its type's default |

**You do not need to set `intent_weight` on every page.** The system automatically maps each `page_type` to a default weight via `PAGE_TYPE_WEIGHTS` in `src/config.js`:

| Page type | Default weight |
|---|---|
| homepage | 0.5 |
| blog / resource | 0.6 |
| service / product | 1.0 |
| case_study | 1.2 |
| pricing | 1.5 |
| contact / booking | 2.0 |

Only set `intent_weight` explicitly when a specific page should deviate from its type's default — for example, a blog post that functions as a sales page (set `intent_weight="1.5"` to override the default 0.6).

### How it works

1. **Tag at publish (CMS layer):** The CMS publishing workflow includes `page_type` and `page_topic` as required fields, with optional `intent_weight` for overrides. These are stored as HTML data attributes or meta tags in the page header.

2. **The bridge (GTM layer):** Google Tag Manager reads this metadata from the page's data layer and attaches it to every GA4 event as custom parameters.

3. **The system feed:** These parameters flow directly into GA4 and then into BigQuery, where the classification engine uses them to calculate clustering and progression scores.

4. **Dynamic flexibility:** Updating the strategy simply involves updating the page's CMS metadata. The very next visit will reflect the updated values.

### HTML implementation

```html
<!-- Option A: Data attributes on body or container -->
<body data-page-type="service" data-page-topic="strategy">

<!-- With optional intent_weight override (only when deviating from type default) -->
<body data-page-type="blog" data-page-topic="strategy" data-intent-weight="1.5">

<!-- Option B: Meta tags in head -->
<meta name="bi:page-type" content="service">
<meta name="bi:page-topic" content="strategy">
<!-- Optional: <meta name="bi:intent-weight" content="1.5"> -->
```

### GTM data layer push

```html
<script>
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({
    'page_type': document.body.dataset.pageType || 'unknown',
    'page_topic': document.body.dataset.pageTopic || 'General',
    // intent_weight is optional — only pushed when the page carries an explicit override.
    // When absent, the classification engine uses the default weight for the page_type.
    ...(document.body.dataset.intentWeight
      ? { 'intent_weight': parseFloat(document.body.dataset.intentWeight) }
      : {})
  });
</script>
```

### Why CMS-first is the only scalable approach

- **Zero blind spots:** Every new page is classified the moment it goes live. No lag where users visit untagged pages.
- **No maintenance burden:** No separate spreadsheet to manage. The taxonomy is part of the website's structure.
- **Reliable clustering:** The clustering signal depends on seeing consistent topic tags. CMS-embedded tags ensure the signal is always accurate and never null.
- **Infinite scalability:** Whether you have 10 pages or 10,000, the system scales because the metadata is distributed across the site rather than trapped in a central register.

---

## Element-Level Metadata (Micro-Signals)

Individual interactive elements can carry their own weight, independent of the page they sit on.

| Field | Description | Example values |
|---|---|---|
| `element_role` | The behavioural role of the element | progression, navigation, depth, tool_use, social |
| `element_weight` | Signal weight override (0.3–2.0) | 2.0 (Get a Quote button), 0.5 (Read More link), 0.3 (nav link) |

### HTML implementation

```html
<button data-element-role="progression" data-element-weight="2.0">Get a Quote</button>
<a href="/blog/..." data-element-role="depth" data-element-weight="0.5">Read More</a>
<a href="/about" data-element-role="navigation" data-element-weight="0.3">About Us</a>
```

### How element weights interact with page weights

When `element_weight` is present on a clicked element, it **overrides** the page's `intent_weight` for that specific interaction. When absent, the page's weight applies as the default.

```
effective_weight = element_weight ?? page_intent_weight
progression_contribution = action_weight * effective_weight
```

This means a "Get a Quote" button (element_weight 2.0) on a blog page (page_weight 0.6) contributes 2.0 to progression, not 0.6. The element's own significance wins.

---

## External Register (Fallback / Audit)

For sites that cannot yet embed CMS metadata, an external register provides a fallback. The register maps URL patterns to taxonomy values.

**Host in Google Sheets or Airtable** for CSV export or BigQuery sync.

| URL Pattern | Page Type | Topic Cluster | Journey Role | Intent Weight | Key Progression Event |
|---|---|---|---|---|---|
| `/` | Homepage | Brand | Orientation | 0.5 | `nav_click_services` |
| `/services/consulting/*` | Service | Strategy | Evaluation | 1.0 | `cta_click_quote` |
| `/case-studies/*` | Case study | Proof | Validation | 1.2 | `resource_download` |
| `/pricing` | Pricing | Commercial | High intent | 1.5 | `form_start_trial` |

### How the fallback works in BigQuery

The SQL pipeline uses a `COALESCE` pattern: CMS-embedded values are used first. If absent, the external register provides values via URL pattern matching. If neither exists, defaults apply.

```sql
COALESCE(cms_page_topic, register_topic_cluster, 'General') AS topic_cluster
```

### When to use the external register

- Legacy sites where CMS metadata has not yet been embedded
- As an audit tool to verify CMS metadata accuracy
- During migration from external register to CMS-first approach

---

## Maintenance Process

| Step | Action | Frequency |
|---|---|---|
| 1 | **Require metadata at publish** — the CMS must not allow pages to go live without `page_type` and `page_topic`. Build this as a required field in the CMS. | Per publish |
| 2 | **Audit monthly** — report pages viewed in last 30 days with `page_topic = 'General'`. Any page with 100+ views without a proper tag is a blind spot. | Monthly |
| 3 | **Track coverage** — `tagged_pages / total_pages_with_traffic`. Target >= 95%. Below 90%, clustering scores are unreliable. | Monthly |
| 4 | **Review element weights** — verify that high-value CTAs carry appropriate `element_weight` values. | Quarterly |

### Ownership (RACI)

Assign these responsibilities before deployment. Shared ownership without a named accountable person means no ownership.

| Responsibility | Accountable | Responsible | SLA |
|---|---|---|---|
| Tag new pages at publish | Content author | Content author (via CMS required fields) | Before publish — enforced by CMS |
| Monthly taxonomy audit | Analytics lead | Analytics lead | Report by 5th of each month |
| Fix untagged pages (100+ views) | Content lead | Content author | Within 5 business days of audit |
| Review element weights | Product lead | Product lead + Analytics lead | By end of quarter |
| Threshold recalibration | Analytics lead | Analytics lead | Quarterly (see `feedback-loop.md`) |

### Default for untagged pages

Any page without CMS metadata defaults to:
- `page_type`: `unknown`
- `page_topic`: `General`
- `intent_weight`: `0.5` (the default for `unknown` page type)

This prevents null values from breaking score calculations while making untagged pages visible in audit reports. Pages that have `page_type` set but no explicit `intent_weight` automatically use the default weight for their type (see table above).

### Common failure mode (external register)

> The marketing team publishes 10 blog posts without tagging them. Users who read those posts appear to have scattered, low-clustering behaviour — creating "false Scanners" or "false Mismatches." The system then recommends navigation improvements for a problem that is actually a taxonomy gap.

**The CMS-first model prevents this:** if tagging is a required CMS field, untagged pages cannot exist.
