const test = require('node:test');
const assert = require('node:assert/strict');
const { X509Certificate } = require('node:crypto');
const { rootCertificates } = require('node:tls');
const { macCaTrusted } = require('../features/doctor/mac-ca.cjs');
const cert = new X509Certificate(rootCertificates[0]);

test('a standalone CA validation cannot hide a missing keychain certificate', async () => {
  let verified = false;
  const result = await macCaTrusted('ca.cer', cert, async (_, args) => {
    if (args[0] === 'verify-cert') verified = true;
    return { stdout: '' };
  });
  assert.equal(result, false);
  assert.equal(verified, false);
});

test('another installed CA with a different fingerprint does not count', async () => {
  const result = await macCaTrusted('ca.cer', cert, async () => ({ stdout: rootCertificates[1] }));
  assert.equal(result, false);
});

test('the matching installed CA also needs successful SSL trust evaluation', async () => {
  for (const trusted of [false, true]) {
    const result = await macCaTrusted('ca.cer', cert, async (_, args) => {
      if (args[0] === 'verify-cert') {
        assert.ok(args.includes('ssl'));
        if (!trusted) throw new Error('not trusted');
      }
      return { stdout: rootCertificates[0] };
    });
    assert.equal(result, trusted);
  }
});
