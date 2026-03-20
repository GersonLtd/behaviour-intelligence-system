/**
 * Behaviour Intelligence System — Element Metadata Reader
 *
 * GTM Custom HTML Tag: reads data-element-role and data-element-weight
 * from clicked elements and pushes them to the dataLayer.
 *
 * When an interactive element (button, link, form control) is clicked,
 * this script checks the element (and its ancestors) for element-level
 * metadata attributes. If found, the values are pushed to dataLayer
 * so GTM can forward them to GA4 as event parameters.
 *
 * Deployment: Add as a Custom HTML tag in GTM, triggered on All Pages.
 * Consent: Respects Google Consent Mode v2 via GTM's native consent
 * settings (consentStatus: "NEEDED" on the tag). GTM blocks this tag
 * entirely when analytics_storage is not granted — no JS-level check
 * required.
 */
(function () {
  'use strict';

  document.addEventListener('click', function (e) {
    var target = e.target;

    // Walk up the DOM to find the nearest element with metadata attributes.
    // This handles cases where the click lands on a child (e.g. icon inside a button).
    var el = target.closest('[data-element-role], [data-element-weight]');
    if (!el) return;

    var role = el.getAttribute('data-element-role');
    var weight = el.getAttribute('data-element-weight');

    // Only push if at least one attribute is present
    if (!role && !weight) return;

    var payload = {};
    if (role) payload.element_role = role;
    if (weight) {
      var parsed = parseFloat(weight);
      if (!isNaN(parsed)) payload.element_weight = parsed;
    }

    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(payload);
  });
})();
