const { recordBrowserReport } = require('./browser-status.cjs');
const { readState } = require('../projects/store.cjs');
const { json } = require('../../shared/http/http.cjs');

// A plugin protocol handles this request inside Whistle. Mapping it back to
// Whistle's listening/UI port would issue a 302 to http://127.0.0.1 instead.
function handleReport(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  try {
    const url = new URL(request.originalReq?.url || request.url, 'https://cloudgametest2.migufun.com:18443');
    if (url.origin !== 'https://cloudgametest2.migufun.com:18443' || url.pathname !== '/__cafe/confirm') {
      return json(response, 404, { message: '接口不存在。' });
    }
    if (request.method !== 'GET') return json(response, 405, { message: '请求方式不支持。' });
    const accepted = recordBrowserReport(readState(), url.searchParams, request.headers.referer);
    return json(response, accepted ? 200 : 409, { accepted });
  } catch {
    return json(response, 400, { message: '回报参数无效。' });
  }
}
exports.reportServer = server => server.on('request', handleReport);
