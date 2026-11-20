const { randomBytes, timingSafeEqual } = require('node:crypto');
const token = randomBytes(32).toString('hex');

function json(response, code, value) {
  response.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

function sameMachine(originValue) {
  if (!originValue) return true;
  try {
    const host = new URL(originValue).hostname;
    return host === '127.0.0.1' || host === 'localhost' || host === '::1'
      || host === '[::1]' || host === 'local.whistlejs.com';
  } catch {
    return false;
  }
}

function authorized(request) {
  const presented = request.headers['x-cafe-token'];
  return typeof presented === 'string'
    && presented.length === token.length
    && timingSafeEqual(Buffer.from(token), Buffer.from(presented, 'latin1'))
    && sameMachine(request.headers.origin);
}

module.exports = { json, authorized, token };
