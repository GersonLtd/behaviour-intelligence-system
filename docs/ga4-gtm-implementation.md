# GA4 & GTM Implementation Guide

This is a **detailed instruction document** for implementing the data collection layer using Google Analytics 4 (GA4) with Google Tag Manager (GTM).

> **This document is a deliverable.** Follow these instructions step-by-step to configure the data collection foundation that feeds the entire Behaviour Intelligence System.

---

## Stack Overview

| Component | Role |
|---|---|
| **Google Tag Manager (GTM)** | Manages tracking code, sends events to GA4 |
| **Google Analytics 4 (GA4)** | Collects and stores event data |
| **BigQuery** | Stores raw event data for flexible querying (intermediate/advanced) |
| **Taxonomy Register** | Maps URLs to page types, topics, and intent weights |

---

## Required Events

Configure these events in GTM to fire on the corresponding user actions:

| Event Name | Trigger | Required Parameters |
|---|---|---|
| `page_view` | Every page load | `page_type`, `page_topic`, `content_role`, `offer_id` |
| `scroll` | GA4 enhanced measurement (75% threshold recommended) | `percent_scrolled` |
| `cta_click` | Click on any CTA button/link | `page_type`, `page_topic`, `cta_label`, `cta_destination` |
| `form_start` | First interaction with a form field | `form_id`, `page_type`, `page_topic` |
| `form_submit` | Successful form submission | `form_id`, `page_type`, `page_topic`, `conversion_stage` |
| `resource_download` | Click on download link (PDF, whitepaper, etc.) | `resource_name`, `resource_type`, `page_topic` |
| `navigation_click` | Click on main navigation elements | `nav_target`, `nav_level` |
| `section_view` | Key page section scrolled into viewport | `section_id`, `section_name`, `page_type` |
| `booking_click` | Click on booking/scheduling action | `booking_type`, `page_type`, `conversion_stage` |
| `conversion_complete` | Final conversion event (form submitted, booking confirmed) | `conversion_type`, `conversion_value` |

### Friction Events (Recommended)

Required for Stalled (Friction) sub-type detection:

| Event Name | Trigger | Definition |
|---|---|---|
| `rage_click` | Custom JS listener | 3+ rapid clicks on the same element within 2 seconds |
| `dead_click` | Custom JS listener | Click on a non-interactive element with no system response |
| `form_error` | Form validation failure | Validation error displayed to the user during form completion |
| `high_layout_shift` | PerformanceObserver | Cumulative Layout Shift exceeds 0.25 during a page view (Chrome/Edge only; no-op in unsupported browsers) |

---

## Required Parameters (Custom Dimensions)

Register these as **event-scoped custom dimensions** in GA4:

| Parameter | Scope | Description |
|---|---|---|
| `page_type` | Event | Type of page (homepage, service, blog, pricing, etc.) |
| `page_topic` | Event | Topic cluster the page belongs to |
| `conversion_stage` | Event | Where the user is in the conversion funnel |
| `content_role` | Event | Role of the content (orientation, evaluation, proof, etc.) |
| `offer_id` | Event | Identifier for the specific offer/product (where relevant) |
| `traffic_source_group` | Event | Grouped traffic source (direct, organic, social, referral, paid) |

### GA4 Property Limits

> **Standard GA4 allows up to 50 event-scoped custom dimensions and 25 user-scoped custom dimensions.**
>
> This framework uses 6 required event parameters plus friction events. Plan your custom dimension budget early.
>
> **If the site already uses 40+ custom dimensions for other needs:** Consolidate where possible or use BigQuery export (where these limits do not apply).
>
> **Action:** Audit existing custom dimensions before rollout so you do not hit the limit halfway through implementation.

---

## GTM Data Layer Setup

### Step 1: Embed CMS Metadata in the Page

The CMS must assign `page_type` and `page_topic` as required fields at publish time. These are stored as HTML data attributes. `intent_weight` is optional — when omitted, the system uses the default weight for the page type (defined in `src/config.js`).

```html
<!-- Required fields only — intent_weight defaults to 1.0 for "service" -->
<body data-page-type="service" data-page-topic="strategy">

<!-- With optional intent_weight override -->
<body data-page-type="blog" data-page-topic="strategy" data-intent-weight="1.5">
```

For interactive elements with specific signal weight, add element-level attributes:

```html
<button data-element-role="progression" data-element-weight="2.0">Get a Quote</button>
<a href="/blog/..." data-element-role="depth" data-element-weight="0.5">Read More</a>
```

### Step 2: Push CMS Metadata to the Data Layer

Add this to the site's HTML `<head>`. GTM reads metadata directly from the page's CMS-embedded attributes:

```html
<script>
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({
    'page_type': document.body.dataset.pageType || 'unknown',
    'page_topic': document.body.dataset.pageTopic || 'General',
    'content_role': document.body.dataset.contentRole || '',
    'offer_id': document.body.dataset.offerId || '',
    // intent_weight is optional — only pushed when the page carries an explicit override.
    // When absent, the classification engine uses the default weight for the page_type.
    ...(document.body.dataset.intentWeight
      ? { 'intent_weight': parseFloat(document.body.dataset.intentWeight) }
      : {})
  });
</script>
```

> **CMS-first principle:** These values come from the CMS, not from an external lookup table. The page "announces" its own strategic significance the moment it loads.

### Step 3: Create GTM Variables

Create these **Data Layer Variables** in GTM:

| Variable Name | Data Layer Variable Name | Type |
|---|---|---|
| `DLV - page_type` | `page_type` | Data Layer Variable |
| `DLV - page_topic` | `page_topic` | Data Layer Variable |
| `DLV - content_role` | `content_role` | Data Layer Variable |
| `DLV - offer_id` | `offer_id` | Data Layer Variable |
| `DLV - intent_weight` | `intent_weight` | Data Layer Variable (optional — only present when page overrides type default) |
| `DLV - element_role` | `element_role` | Data Layer Variable |
| `DLV - element_weight` | `element_weight` | Data Layer Variable |

> **Element-level variables** are populated by the `element-metadata-reader.js` GTM tag (see `gtm/element-metadata-reader.js`), which reads `data-element-role` and `data-element-weight` from clicked elements.

### Step 3: Configure GA4 Event Tags

For each event, create a GA4 Event tag in GTM:

**Example: CTA Click Tag**
```
Tag Type: Google Analytics: GA4 Event
Event Name: cta_click
Parameters:
  page_type      = {{DLV - page_type}}
  page_topic     = {{DLV - page_topic}}
  cta_label      = {{Click Text}}
  cta_destination = {{Click URL}}
Trigger: Click - All Elements
  Filter: Click matches CSS selector ".cta, [data-cta], .btn-primary"
```

**Example: Form Start Tag**
```
Tag Type: Google Analytics: GA4 Event
Event Name: form_start
Parameters:
  form_id    = {{Form ID}}
  page_type  = {{DLV - page_type}}
  page_topic = {{DLV - page_topic}}
Trigger: Form Submission (check "Check Validation")
  OR Element Visibility (first form field focused)
```

### Step 4: Configure Traffic Source Grouping

Create a **Custom JavaScript Variable** in GTM:

```javascript
function() {
  var ref = document.referrer || '';
  var url = window.location.href;
  var params = new URLSearchParams(window.location.search);
  var utm_medium = (params.get('utm_medium') || '').toLowerCase();
  var utm_source = (params.get('utm_source') || '').toLowerCase();

  // Paid search
  if (utm_medium === 'cpc' || utm_medium === 'ppc' || params.get('gclid')) {
    return 'paid_search';
  }
  // Social media
  if (utm_medium === 'social' || /facebook|twitter|linkedin|instagram/i.test(ref)) {
    return 'social_media';
  }
  // Organic search
  if (utm_medium === 'organic' || /google|bing|yahoo|duckduckgo/i.test(ref)) {
    return 'organic_search';
  }
  // Referral
  if (ref && !ref.includes(window.location.hostname)) {
    return 'referral';
  }
  // Direct
  return 'direct';
}
```

---

## Friction Event Implementation

### Rage Click Detection

Add this as a **Custom HTML Tag** in GTM, triggered on All Pages:

```html
<script>
(function() {
  var clickLog = [];
  var THRESHOLD = 3;     // clicks required
  var WINDOW_MS = 2000;  // time window

  document.addEventListener('click', function(e) {
    var now = Date.now();
    var target = e.target;

    // Record click with timestamp and target
    clickLog.push({ time: now, target: target });

    // Remove clicks outside the time window
    clickLog = clickLog.filter(function(c) {
      return now - c.time <= WINDOW_MS;
    });

    // Count clicks on the same element
    var sameTargetClicks = clickLog.filter(function(c) {
      return c.target === target;
    });

    if (sameTargetClicks.length >= THRESHOLD) {
      window.dataLayer.push({
        'event': 'rage_click',
        'rage_click_element': target.tagName + '.' + (target.className || '').split(' ')[0],
        'rage_click_count': sameTargetClicks.length,
        'page_type': document.querySelector('[data-page-type]')
          ? document.querySelector('[data-page-type]').getAttribute('data-page-type')
          : 'unknown'
      });
      clickLog = []; // reset after detection
    }
  });
})();
</script>
```

### Dead Click Detection

```html
<script>
(function() {
  document.addEventListener('click', function(e) {
    var target = e.target;

    // Check if the element is non-interactive
    var interactive = ['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL'];
    var isInteractive = interactive.indexOf(target.tagName) !== -1
      || target.getAttribute('role') === 'button'
      || target.getAttribute('tabindex') !== null
      || target.closest('a, button, [role="button"]');

    if (!isInteractive) {
      // Wait briefly to see if anything happens (e.g. JS-driven response)
      setTimeout(function() {
        window.dataLayer.push({
          'event': 'dead_click',
          'dead_click_element': target.tagName + '.' + (target.className || '').split(' ')[0],
          'page_type': document.querySelector('[data-page-type]')
            ? document.querySelector('[data-page-type]').getAttribute('data-page-type')
            : 'unknown'
        });
      }, 300);
    }
  });
})();
</script>
```

### Form Error Detection

Fire on form validation failure events:

```html
<script>
(function() {
  document.addEventListener('invalid', function(e) {
    window.dataLayer.push({
      'event': 'form_error',
      'form_error_field': e.target.name || e.target.id || 'unknown',
      'form_error_message': e.target.validationMessage || 'validation failed',
      'form_id': e.target.closest('form') ? e.target.closest('form').id : 'unknown'
    });
  }, true); // capture phase to catch before default handling
})();
</script>
```

---

## Validation Checklist

Before using scores operationally, validate:

- [ ] **All required events fire correctly** — check in GA4 DebugView
- [ ] **Custom dimensions appear** — verify in GA4 > Admin > Custom definitions
- [ ] **page_type and page_topic are populated** — no null/undefined values on key pages
- [ ] **Taxonomy coverage ≥ 95%** — check for "General" defaults in reports
- [ ] **No double-firing** — each event fires once per action
- [ ] **Friction events trigger correctly** — test rage clicks, dead clicks, form errors
- [ ] **Traffic source grouping is accurate** — verify against known traffic sources
- [ ] **BigQuery export is enabled** (if using intermediate/advanced setup)
- [ ] **Consent management is in place** — GDPR/ePrivacy compliance confirmed

---

## Implementation Sequence

| Step | Action | Dependency |
|---|---|---|
| 1 | Define taxonomy register (see `taxonomy-register.md`) | None |
| 2 | Implement data layer on site | Taxonomy register |
| 3 | Create GTM variables | Data layer |
| 4 | Create GA4 event tags in GTM | GTM variables |
| 5 | Add friction event listeners | GTM |
| 6 | Validate all events in GA4 DebugView | Tags deployed |
| 7 | Register custom dimensions in GA4 | Events validated |
| 8 | Enable BigQuery export | GA4 property setup |
| 9 | Build score calculations | Data flowing |
| 10 | Test state assignment against real sessions | Scores working |

---

## Processing Options by Maturity

### Basic Setup
- GA4 event collection
- Looker Studio reporting
- Manual or spreadsheet-based scoring

### Intermediate Setup
- GA4 + BigQuery export
- SQL-based score calculation (see `sql/01-signal-scores.sql` through `sql/05-dashboard-views.sql`)
- Dashboard state reporting

### Advanced Setup
- BigQuery + warehouse logic (e.g. dbt)
- Near-real-time classification
- Automated CRM or UX triggers based on high-confidence states

