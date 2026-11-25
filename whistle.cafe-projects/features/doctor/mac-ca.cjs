const { X509Certificate } = require('node:crypto');

// A trust-settings entry alone is insufficient for Chrome: the actual CA must
// also be discoverable in a user/system keychain, not just supplied as a file.
async function macCaTrusted(file, cert, run) {
  const certificates = await Promise.all([
    [], ['/Library/Keychains/System.keychain'],
  ].map(async keychains => {
    try {
      const { stdout } = await run('/usr/bin/security', ['find-certificate', '-a', '-p', ...keychains], { timeout: 5000 });
      return stdout;
    } catch { return ''; }
  }));
  const installed = certificates.some(output =>
    (output.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) || []).some(pem => {
      try { return new X509Certificate(pem).fingerprint256 === cert.fingerprint256; }
      catch { return false; }
    }));
  if (!installed) return false;
  try {
    await run('/usr/bin/security', ['verify-cert', '-l', '-L', '-p', 'ssl', '-c', file], { timeout: 5000 });
    return true;
  } catch { return false; }
}
module.exports = { macCaTrusted };
