// Talky — API Configuration
// TALKY_API_URL يُحقن أثناء النشر (deploy_frontend.py يستبدل RENDER_BACKEND_URL_PLACEHOLDER)
// إن بقي فارغاً أو placeholder فالواجهة تنادي OmniVoice مباشرة من المتصفح.
(function () {
  var raw = (typeof window.TALKY_API_URL === 'string' ? window.TALKY_API_URL : '').trim();
  var isPlaceholder = !raw || raw === 'RENDER_BACKEND_URL_PLACEHOLDER' || raw === 'undefined';
  var base = isPlaceholder ? '' : raw.replace(/\/+$/, '');

  // Allow override via ?api=https://... for testing
  try {
    var qp = new URLSearchParams(location.search).get('api');
    if (qp) base = qp.trim().replace(/\/+$/, '');
  } catch (_) {}

  window.TALKY_CONFIG = { apiBase: base, directMode: !base };

  // Backward compat: API_CONFIG used in older code
  window.API_CONFIG = { BASE_URL: base };
})();
