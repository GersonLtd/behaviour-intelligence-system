/**
 * Behaviour Intelligence System — Rage Click Detector
 *
 * GTM Custom HTML Tag: detects rapid repeated clicks on the same element
 * (3+ clicks within 2 seconds) and pushes a `rage_click` event to dataLayer.
 *
 * Deployment: Add as a Custom HTML tag in GTM, triggered on All Pages.
 * Consent: Respects Google Consent Mode v2 via GTM's native consent
 * settings (consentStatus: "NEEDED" on the tag). GTM blocks this tag
 * entirely when analytics_storage is not granted — no JS-level check
 * required.
 */
(function () {
  'use strict';

  var THRESHOLD = 3;      // minimum clicks to qualify
  var WINDOW_MS = 2000;   // time window in milliseconds
  var DEBOUNCE_MS = 5000; // cooldown after detection to avoid flooding

  var clickLog = [];
  var lastFiredAt = 0;

  /**
   * Build a stable selector string for an element (for logging).
   */
  function elementSelector(el) {
    if (!el || !el.tagName) return 'unknown';
    var tag = el.tagName.toLowerCase();
    var id = el.id ? '#' + String(el.id).slice(0, 50) : '';
    var cls = el.className
      ? '.' + String(el.className).trim().split(/\s+/).slice(0, 2).join('.')
      : '';
    return (tag + id + cls).slice(0, 150);
  }

  document.addEventListener('click', function (e) {
    var now = Date.now();
    var target = e.target;

    // Debounce: skip if we just fired
    if (now - lastFiredAt < DEBOUNCE_MS) return;

    // Record this click (store selector string, not DOM reference, to avoid
    // memory leaks and to detect rage clicks across framework re-renders)
    var selector = elementSelector(target);
    clickLog.push({ time: now, selector: selector });

    // Trim expired entries
    clickLog = clickLog.filter(function (c) {
      return now - c.time <= WINDOW_MS;
    });

    // Count clicks on the same element
    var sameTargetCount = 0;
    for (var i = 0; i < clickLog.length; i++) {
      if (clickLog[i].selector === selector) sameTargetCount++;
    }

    if (sameTargetCount >= THRESHOLD) {
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({
        event: 'rage_click',
        rage_click_element: selector,
        rage_click_count: sameTargetCount,
        rage_click_url: window.location.pathname
      });

      lastFiredAt = now;
      clickLog = []; // reset after detection
    }
  });
})();
