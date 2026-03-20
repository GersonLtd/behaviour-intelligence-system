/**
 * Behaviour Intelligence System — Form Error Tracker
 *
 * GTM Custom HTML Tag: detects form validation errors and pushes
 * a `form_error` event to dataLayer.
 *
 * Listens for both HTML5 native validation (invalid event) and
 * common JS validation patterns (error class additions).
 *
 * Deployment: Add as a Custom HTML tag in GTM, triggered on All Pages.
 * Consent: Respects Google Consent Mode v2 via GTM's native consent
 * settings (consentStatus: "NEEDED" on the tag). GTM blocks this tag
 * entirely when analytics_storage is not granted — no JS-level check
 * required.
 */
(function () {
  'use strict';

  var DEBOUNCE_MS = 1000; // minimum gap between events for the same field
  var lastFiredFields = {};

  /**
   * Push a form_error event to dataLayer (with debounce per field).
   */
  function fireFormError(fieldName, errorType, formId) {
    var now = Date.now();
    var key = formId + ':' + fieldName;

    if (lastFiredFields[key] && now - lastFiredFields[key] < DEBOUNCE_MS) return;
    lastFiredFields[key] = now;

    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({
      event: 'form_error',
      form_error_field: fieldName || 'unknown',
      form_error_type: errorType || 'validation_failed',
      form_error_form_id: formId || 'unknown',
      form_error_url: window.location.pathname
    });
  }

  /**
   * Classify a validation error into a safe, non-PII error type
   * using the ValidityState API rather than the raw message.
   */
  function classifyValidationError(el) {
    if (!el || !el.validity) return 'validation_failed';
    var v = el.validity;
    if (v.valueMissing)    return 'required';
    if (v.typeMismatch)    return 'type_mismatch';
    if (v.patternMismatch) return 'pattern_mismatch';
    if (v.tooShort)        return 'too_short';
    if (v.tooLong)         return 'too_long';
    if (v.rangeUnderflow)  return 'range_underflow';
    if (v.rangeOverflow)   return 'range_overflow';
    if (v.stepMismatch)    return 'step_mismatch';
    if (v.badInput)        return 'bad_input';
    if (v.customError)     return 'custom_error';
    return 'validation_failed';
  }

  // ── HTML5 native validation: 'invalid' event ──
  document.addEventListener('invalid', function (e) {
    var target = e.target;
    var formEl = target.closest('form');

    fireFormError(
      target.name || target.id || 'unnamed',
      classifyValidationError(target),
      formEl ? (formEl.id || formEl.getAttribute('data-form-name') || 'unknown') : 'unknown'
    );
  }, true); // capture phase to catch before default handling

  // ── JS validation pattern: watch for error class additions ──
  var errorClassPatterns = ['error', 'invalid', 'has-error', 'is-invalid', 'field-error'];

  var classObserver = new MutationObserver(function (mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var mutation = mutations[i];
      if (mutation.type !== 'attributes' || mutation.attributeName !== 'class') continue;

      var target = mutation.target;
      if (!target.classList) continue;

      // Check if an error class was added
      for (var j = 0; j < errorClassPatterns.length; j++) {
        if (target.classList.contains(errorClassPatterns[j])) {
          var isFormField = ['INPUT', 'SELECT', 'TEXTAREA'].indexOf(target.tagName) !== -1;
          var fieldEl = isFormField ? target : target.querySelector('input, select, textarea');

          if (fieldEl) {
            var formEl = fieldEl.closest('form');
            fireFormError(
              fieldEl.name || fieldEl.id || 'unnamed',
              'class_based_error',
              formEl ? (formEl.id || 'unknown') : 'unknown'
            );
          }
          break;
        }
      }
    }
  });

  // Observe for class changes on form-related elements.
  // Scope to individual <form> elements when possible to reduce
  // mutation noise on SPAs. Falls back to document.body if no
  // forms are found (handles dynamically injected forms).
  var observeConfig = { attributes: true, attributeFilter: ['class'], subtree: true };
  var forms = document.querySelectorAll('form');
  if (forms.length > 0) {
    for (var f = 0; f < forms.length; f++) {
      classObserver.observe(forms[f], observeConfig);
    }
  } else {
    classObserver.observe(document.body, observeConfig);
  }
})();
