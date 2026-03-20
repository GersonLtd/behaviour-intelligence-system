/**
 * Behaviour Intelligence System — Dead Click Detector
 *
 * GTM Custom HTML Tag: detects clicks on non-interactive elements that
 * produce no response (no DOM change, no navigation, no handler response).
 *
 * Fires a `dead_click` event to dataLayer.
 *
 * Deployment: Add as a Custom HTML tag in GTM, triggered on All Pages.
 * Consent: Respects Google Consent Mode v2 via GTM's native consent
 * settings (consentStatus: "NEEDED" on the tag). GTM blocks this tag
 * entirely when analytics_storage is not granted — no JS-level check
 * required.
 *
 * Note: Uses a 300ms observation window + MutationObserver to check
 * whether the click produced any DOM change. This prevents overcounting
 * intentional clicks on layout elements.
 */
(function () {
  'use strict';

  var OBSERVATION_WINDOW_MS = 300;
  var DEBOUNCE_MS = 2000; // minimum gap between dead_click events
  var lastFiredAt = 0;

  // Interactive element tags and roles
  var INTERACTIVE_TAGS = ['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL', 'SUMMARY'];
  var INTERACTIVE_ROLES = ['button', 'link', 'menuitem', 'tab', 'checkbox', 'radio', 'switch'];

  /**
   * Check if an element is inherently interactive.
   */
  function isInteractive(el) {
    if (!el || !el.tagName) return true; // fail safe

    // Direct interactive tag
    if (INTERACTIVE_TAGS.indexOf(el.tagName) !== -1) return true;

    // ARIA role
    var role = el.getAttribute('role');
    if (role && INTERACTIVE_ROLES.indexOf(role) !== -1) return true;

    // Tabindex set (explicitly interactive)
    if (el.getAttribute('tabindex') !== null) return true;

    // Closest interactive ancestor
    if (el.closest('a, button, [role="button"], [role="link"], label, summary')) return true;

    // Inline event handler (onclick attribute)
    if (el.getAttribute('onclick')) return true;

    return false;
  }

  /**
   * Build a selector for logging.
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

    // Skip if debouncing
    if (now - lastFiredAt < DEBOUNCE_MS) return;

    // Skip interactive elements
    if (isInteractive(target)) return;

    // Observe DOM for changes after the click.
    // Scope to the clicked element's parent rather than document.body
    // to avoid main-thread jank on SPAs with heavy DOM churn.
    var domChanged = false;
    var observer = new MutationObserver(function () {
      domChanged = true;
    });

    var observeRoot = target.parentElement || target;
    observer.observe(observeRoot, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true
    });

    // Capture URL before setTimeout so we can detect SPA navigation
    var originalUrl = window.location.href;

    // Check after observation window
    setTimeout(function () {
      observer.disconnect();

      // Check if SPA navigation happened (full-page navigations unload before this fires)
      var navigated = window.location.href !== originalUrl;

      if (!domChanged && !navigated) {
        window.dataLayer = window.dataLayer || [];
        window.dataLayer.push({
          event: 'dead_click',
          dead_click_element: elementSelector(target),
          dead_click_url: window.location.pathname
        });
        lastFiredAt = Date.now();
      }
    }, OBSERVATION_WINDOW_MS);
  });
})();
