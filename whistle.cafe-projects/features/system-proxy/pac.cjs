const { origin, testHost } = require('../../shared/config/config.cjs');

const pacRoute = '/cybercafe.pac';
const pacUrl = origin + '/plugin.cafe-projects' + pacRoute;
const pacBody = [
  'function FindProxyForURL(url, host) {',
  '  return host.toLowerCase() === ' + JSON.stringify(testHost) + ' ? "PROXY 127.0.0.1:8899; DIRECT" : "DIRECT";',
  '}',
  '',
].join('\n');

function servePac(response, method) {
  response.setHeader('Content-Type', 'application/x-ns-proxy-autoconfig');
  response.end(method === 'HEAD' ? undefined : pacBody);
}

module.exports = { pacRoute, pacUrl, pacBody, servePac };
