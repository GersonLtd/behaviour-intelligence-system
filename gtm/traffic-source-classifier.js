/**
 * Behaviour Intelligence System — Traffic Source Classifier
 *
 * GTM Custom JavaScript Variable: classifies the current visitor's
 * traffic source into one of the framework's source groups.
 *
 * Returns: 'direct' | 'organic_search' | 'social_media' | 'referral' | 'paid_search'
 *
 * Deployment: Create as a Custom JavaScript Variable in GTM.
 * Reference in GA4 event tags as {{traffic_source_group}}.
 */
function () {
  'use strict';

  var ref = (document.referrer || '').toLowerCase();
  var params = new URLSearchParams(window.location.search);
  var utmMedium = (params.get('utm_medium') || '').toLowerCase();
  var utmSource = (params.get('utm_source') || '').toLowerCase();
  var hostname = window.location.hostname.toLowerCase();

  // ── Paid search ──
  // Check for Google Ads click ID, or explicit CPC/PPC medium
  if (params.get('gclid') || params.get('msclkid')
      || utmMedium === 'cpc' || utmMedium === 'ppc'
      || utmMedium === 'paid_search') {
    return 'paid_search';
  }

  // ── Social media ──
  var socialDomains = [
    'facebook.com', 'fb.com', 't.co', 'twitter.com', 'x.com',
    'linkedin.com', 'instagram.com', 'pinterest.com',
    'tiktok.com', 'youtube.com', 'reddit.com', 'threads.net'
  ];
  if (utmMedium === 'social' || utmMedium === 'social-media') {
    return 'social_media';
  }
  for (var i = 0; i < socialDomains.length; i++) {
    if (ref.indexOf(socialDomains[i]) !== -1) return 'social_media';
  }

  // ── Organic search ──
  var searchDomains = [
    'google.', 'bing.com', 'yahoo.', 'duckduckgo.com',
    'baidu.com', 'yandex.', 'ecosia.org', 'ask.com'
  ];
  if (utmMedium === 'organic') return 'organic_search';
  for (var j = 0; j < searchDomains.length; j++) {
    if (ref.indexOf(searchDomains[j]) !== -1) return 'organic_search';
  }

  // ── Referral ──
  // Has a referrer that is not the current site
  if (ref && ref.indexOf(hostname) === -1) {
    return 'referral';
  }

  // ── Direct ──
  return 'direct';
}
