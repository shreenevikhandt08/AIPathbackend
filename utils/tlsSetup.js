/**
 * Prefer OS trust store (Windows corporate proxies / SSL inspection).
 * Call once at process start before any HTTPS (OpenRouter, Mongo TLS, etc.).
 */
function applySystemCa() {
  try {
    const tls = require("tls");
    if (typeof tls.getCACertificates !== "function" || typeof tls.setDefaultCACertificates !== "function") {
      return false;
    }
    const bundled = tls.getCACertificates("bundled") || [];
    let system = [];
    try {
      system = tls.getCACertificates("system") || [];
    } catch (_) {
      system = [];
    }
    if (!system.length) return false;
    const merged = [...bundled, ...system];
    tls.setDefaultCACertificates(merged);
    console.log(`🔐 TLS: using system CA store (${system.length} system + ${bundled.length} bundled)`);
    return true;
  } catch (e) {
    console.warn("TLS system CA setup skipped:", e.message);
    return false;
  }
}

module.exports = { applySystemCa };
