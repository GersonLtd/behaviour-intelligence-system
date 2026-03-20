/**
 * Behaviour Intelligence System — Layout Shift Detector
 *
 * GTM Custom HTML Tag: detects high Cumulative Layout Shift (CLS > 0.25)
 * during a page view and pushes a `high_layout_shift` event to dataLayer.
 *
 * Uses the PerformanceObserver API with the `layout-shift` entry type.
 * CLS is accumulated across all layout shift entries that are not preceded
 * by recent user input (i.e. only unexpected shifts count). When the
 * cumulative score exceeds the threshold, a single event fires per page.
 *
 * Browser support: Chrome 77+, Edge 79+, Opera 64+. Firefox and Safari
 * do not support the layout-shift entry type — the detector is a no-op
 * in those browsers (fails silently).
 *
 * Deployment: Add as a Custom HTML tag in GTM, triggered on All Pages.
 * Consent: Respects Google Consent Mode v2 via GTM's native consent
 * settings (consentStatus: "NEEDED" on the tag). GTM blocks this tag
 * entirely when analytics_storage is not granted — no JS-level check
 * required.
 */
(function () {
  'use strict';

  var CLS_THRESHOLD = 0.25;

  // Guard: PerformanceObserver with layout-shift support required
  if (typeof PerformanceObserver === 'undefined') return;
  try {
    if (!PerformanceObserver.supportedEntryTypes ||
        PerformanceObserver.supportedEntryTypes.indexOf('layout-shift') === -1) {
      return;
    }
  } catch (e) {
    return;
  }

  var cumulativeCLS = 0;
  var fired = false;

  /**
   * Build a selector string for the largest shift source element.
   */
  function elementSelector(el) {
    if (!el || !el.tagName) return 'unknown';
    var tag = el.tagName.toLowerCase();
    var id = el.id ? '#' + String(el.id).slice(0, 50) : '';
    var cls = el.className && typeof el.className === 'string'
      ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
      : '';
    return (tag + id + cls).slice(0, 150);
  }

  /**
   * Find the largest layout shift source from a shift entry.
   * Each entry has a `sources` array of LayoutShiftAttribution objects.
   */
  function largestSource(entry) {
    if (!entry.sources || !entry.sources.length) return null;
    var largest = entry.sources[0];
    for (var i = 1; i < entry.sources.length; i++) {
      var rect = entry.sources[i].currentRect;
      var largestRect = largest.currentRect;
      if (rect && largestRect) {
        var area = rect.width * rect.height;
        var largestArea = largestRect.width * largestRect.height;
        if (area > largestArea) largest = entry.sources[i];
      }
    }
    return largest.node || null;
  }

  var observer = new PerformanceObserver(function (list) {
    if (fired) return;

    var entries = list.getEntries();
    var lastUnexpectedEntry = null;
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];

      // Only count unexpected shifts (not preceded by user input)
      if (entry.hadRecentInput) continue;

      cumulativeCLS += entry.value;
      lastUnexpectedEntry = entry;
    }

    if (cumulativeCLS > CLS_THRESHOLD && lastUnexpectedEntry) {
      fired = true;

      // Identify the largest source from the most recent unexpected shift
      var sourceEl = largestSource(lastUnexpectedEntry);

      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({
        event: 'high_layout_shift',
        layout_shift_score: Math.round(cumulativeCLS * 1000) / 1000,
        layout_shift_element: elementSelector(sourceEl),
        layout_shift_url: window.location.pathname
      });

      observer.disconnect();
    }
  });

  observer.observe({ type: 'layout-shift', buffered: true });
})();
