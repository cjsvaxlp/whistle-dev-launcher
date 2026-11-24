// Keep mode-specific checks separate so browser mode never requests system PAC setup.
function proxyChecks(mode, { confirmed = [], systemProxy = {} } = {}) {
  if (mode === 'browser') {
    return [{ id: 'proxy', label: '浏览器代理', status: confirmed.length ? 'ok' : 'unknown',
      detail: confirmed.length ? '已确认本地访问：' + confirmed.join('、') : '尚未收到本地页面回报',
      action: confirmed.length ? '' : '启用浏览器扩展中的 HTTP 127.0.0.1:8899 规则，打开测试页面并刷新。' }];
  }
  return [
    { id: 'pac', label: 'PAC 配置', status: 'ok', detail: '由应用自动配置，无需手动生成。' },
    { id: 'proxy', label: 'Whistle 代理', ...systemProxy },
  ];
}
module.exports = { proxyChecks };
