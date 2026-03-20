# GTM Container Import Guide

## What's included

The file `gtm-container-template.json` contains a ready-to-import GTM container with everything the Behaviour Intelligence System needs:

**15 tags:**
- 1 GA4 Configuration tag (sends page_type, page_topic, traffic_source_group on every page)
- 7 GA4 Event tags (cta_click, form_start, form_submit, booking_click, conversion_complete, resource_download, video_start)
- 4 Custom HTML tags (rage click detector, dead click detector, form error tracker, element metadata reader)
- 3 GA4 Event tags for friction events (rage_click, dead_click, form_error)

**11 triggers:**
- All Pages, CTA Click, Form Start, Form Submit, Booking Click, Conversion Complete, Resource Download, Video Start
- 3 custom event triggers for friction events

**17 variables:**
- 1 GA4 Measurement ID (constant — you must replace the placeholder)
- 15 Data Layer Variables (page_type, page_topic, intent_weight, element_role, element_weight, etc.)
- 1 Custom JavaScript Variable (traffic source classifier)

All tags include **Consent Mode v2** settings requiring `analytics_storage` consent.

---

## How to import

### Step 1: Import the container

1. Open [Google Tag Manager](https://tagmanager.google.com)
2. Select your container (or create a new one)
3. Go to **Admin** → **Import Container**
4. Upload `gtm-container-template.json`
5. Choose a workspace (or create a new one called "Behaviour Intelligence")
6. Select **Merge** → **Rename conflicting tags, triggers, and variables**
   - This preserves any existing tags in your container

### Step 2: Set your GA4 Measurement ID

1. Go to **Variables**
2. Find **GA4 Measurement ID**
3. Replace `G-XXXXXXXXXX` with your actual GA4 Measurement ID
4. Save

### Step 3: Adjust triggers for your site

Several triggers use CSS selectors that may need adjusting for your site:

| Trigger | Default selector | What to check |
|---|---|---|
| **CTA Click** | `.cta, [data-cta], .btn-primary, [data-element-role='progression']` | Match your site's CTA classes |
| **Booking Click** | `.booking-btn, [data-booking], [href*='calendly'], [href*='booking']` | Match your booking elements |
| **Resource Download** | `\.(pdf\|docx?\|xlsx?\|pptx?\|zip\|csv)$` on Click URL | Add file types if needed |
| **Form Start** | Custom event `gtm.element.focus` | May need adjustment for your form framework |

Triggers that listen for dataLayer pushes (Conversion Complete, Video Start, friction events) work automatically — they fire when your site pushes the corresponding event.

### Step 4: Verify in Preview mode

1. Click **Preview** in GTM
2. Navigate your site and perform key actions:
   - Load a page → GA4 Config should fire
   - Click a CTA → cta_click event should fire
   - Start a form → form_start event should fire
   - Submit a form → form_submit event should fire
3. Open **GA4 DebugView** (GA4 → Admin → DebugView) to confirm events arrive with correct parameters

### Step 5: Publish

Once verified, publish the workspace.

---

## What you still need to do on your site

The GTM container handles event collection, but your site must provide the data:

1. **Data layer push on every page** — your CMS/site must push `page_type` and `page_topic` to the dataLayer before GTM loads. See `docs/ga4-gtm-implementation.md` Step 2.

2. **Conversion complete push** — your form success handler or thank-you page must push `{ event: 'conversion_complete', conversion_type: '...', conversion_value: '...' }` to the dataLayer.

3. **Element metadata attributes** — high-value CTAs should carry `data-element-role` and `data-element-weight` HTML attributes. The Element Metadata Reader tag picks these up automatically on click.

---

## Customisation

The container is a starting point. Common modifications:

- **Add URL filters to Form Submit** — exclude search forms or login forms from tracking
- **Add YouTube video trigger** — replace the Video Start custom event trigger with GTM's built-in YouTube trigger if you use YouTube embeds
- **Adjust friction thresholds** — the rage click detector uses 3 clicks / 2 seconds by default. Edit the Custom HTML tag to change these values.
- **Customise form error CSS classes** — the Form Error Tracker detects JS-based validation errors by watching for specific CSS classes: `error`, `invalid`, `has-error`, `is-invalid`, `field-error`. These cover Bootstrap and common libraries. If your site uses a different framework, update the `errorClassPatterns` array in the Form Error Tracker Custom HTML tag:

  | Framework | Classes to add |
  |---|---|
  | **Tailwind CSS** | Add checks for Tailwind utility classes (e.g. `border-red-500`) — requires extending the observer logic to check computed classes rather than exact matches |
  | **Material UI** | `Mui-error` |
  | **Ant Design** | `ant-form-item-has-error` |
  | **Custom / headless** | Inspect your form error states and add the relevant class names |

For the full implementation reference, see `docs/ga4-gtm-implementation.md`.
