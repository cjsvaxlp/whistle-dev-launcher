// 注入到每个被测子应用页面的环境徽标：显示当前页面是测试部署还是本地接管。
// 由 Whistle 的 htmlAppend 注入，脚本本身和状态文件都经同一域名转发，避免混合内容与 CSP 外域问题。
(() => {
  'use strict';
  if (window.__cafeBadgeLoaded) return;
  window.__cafeBadgeLoaded = true;
  if (window.top !== window.self) return;

  const match = /^\/cybercafe-([a-z0-9-]+)\//.exec(window.location.pathname);
  if (!match) return;
  const project = match[1];

  const CONSOLE_URL = 'http://127.0.0.1:8899/plugin.cafe-projects/';
  const ENTRY_URL = 'https://cloudgametest2.migufun.com:18443/cybercafe-power/#/amsportal';
  const STALE_AFTER = 30000;
  const COLLAPSED_KEY = 'cafe-badge-collapsed';

  const host = document.createElement('div');
  host.setAttribute('data-cafe-badge', project);
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = '/__cafe/badge.css';

  const wrap = document.createElement('div');
  wrap.className = 'wrap';
  wrap.innerHTML = `
    <button class="mini" type="button" title="展开环境徽标"><span class="dot"></span></button>
    <button class="pill" type="button" aria-expanded="false">
      <span class="dot"></span><span class="pill-label">检测环境</span>
    </button>
    <section class="card" hidden aria-live="polite">
      <h2 class="card-title">调试环境</h2>
      <div class="row"><span class="row-label">项目</span><span class="row-value" data-key="project"></span></div>
      <div class="row"><span class="row-label">状态</span><span class="row-value" data-key="status"></span></div>
      <div class="row" data-when="local"><span class="row-label">端口</span><span class="row-value" data-key="port"></span></div>
      <div class="row" data-when="local"><span class="row-label">接管时间</span><span class="row-value" data-key="since"></span></div>
      <div class="row"><span class="row-label">最近同步</span><span class="row-value" data-key="checked"></span></div>
      <p class="hint" data-key="hint" hidden></p>
      <div class="actions">
        <a data-action="console" target="_blank" rel="noreferrer">打开控制台</a>
        <a data-action="entry" target="_blank" rel="noreferrer">测试入口</a>
        <button class="collapse" type="button">收起</button>
      </div>
    </section>
  `;
  shadow.append(style, wrap);
  document.documentElement.append(host);

  const pill = wrap.querySelector('.pill');
  const mini = wrap.querySelector('.mini');
  const card = wrap.querySelector('.card');
  const label = wrap.querySelector('.pill-label');
  const field = key => wrap.querySelector(`[data-key="${key}"]`);
  const localRows = wrap.querySelectorAll('[data-when="local"]');
  wrap.querySelector('[data-action="console"]').href =
    CONSOLE_URL + '?project=' + encodeURIComponent(project);
  wrap.querySelector('[data-action="entry"]').href = ENTRY_URL;

  let state = null;
  let failed = false;
  let timer = null;
  let refreshing = false;
  let localConfirmed = false;

  const isCollapsed = () => {
    try {
      return window.localStorage.getItem(COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  };
  const setCollapsed = collapsed => {
    wrap.classList.toggle('collapsed', collapsed);
    try {
      window.localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
    } catch {
      // 隐私模式下忽略。
    }
  };

  function ago(iso) {
    const ms = Date.now() - Date.parse(iso);
    if (!Number.isFinite(ms)) return '未知';
    if (ms < 0) return '刚刚';
    if (ms < 10000) return '刚刚';
    if (ms < 60000) return `${Math.round(ms / 1000)} 秒前`;
    if (ms < 3600000) return `${Math.round(ms / 60000)} 分钟前`;
    return `${Math.round(ms / 3600000)} 小时前`;
  }

  function clock(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '未知';
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }

  function describe() {
    if (!state || !state.updatedAt) {
      return { kind: 'offline', label: '同步未运行' };
    }
    if (state.proxyEnabled === false) return { kind: 'test', label: '测试部署' };
    const age = Date.now() - Date.parse(state.updatedAt);
    const local = state.projects && state.projects[project];
    if (!Number.isFinite(age) || age > STALE_AFTER) {
      return local
        ? { kind: 'stale', label: `状态过期 · :${local.port}`, local, stale: true }
        : { kind: 'offline', label: '同步未运行' };
    }
    if (local && localConfirmed) return { kind: 'local', label: `本地 · ${project} · :${local.port}`, local };
    if (local) return { kind: 'stale', label: '规则就绪 · 页面待确认', local, pending: true };
    return { kind: 'test', label: '测试部署' };
  }

  function render() {
    if (!state && !failed) return;
    const info = describe();
    wrap.classList.remove('state-local', 'state-test', 'state-stale', 'state-offline');
    wrap.classList.add('state-' + info.kind);
    label.textContent = info.label;
    pill.title = info.kind === 'local'
      ? `当前页面来自本机开发服务（${project}，端口 ${info.local.port}）`
      : info.kind === 'test'
        ? '当前页面来自测试部署；本地服务就绪后会自动接管'
        : info.pending ? '规则已就绪，但尚未确认本地页面响应' : '代理同步状态已过期';

    field('project').textContent = 'cybercafe-' + project;
    field('status').textContent = info.kind === 'local'
      ? '本地接管'
      : info.kind === 'test'
        ? '测试部署'
        : info.kind === 'stale'
          ? info.pending ? '本地页面待确认' : '接管状态已过期'
          : '同步未运行';
    field('checked').textContent = state && state.updatedAt ? ago(state.updatedAt) : '未知';

    for (const row of localRows) row.hidden = !info.local;
    if (info.local) {
      field('port').textContent = ':' + info.local.port;
      field('since').textContent = clock(info.local.since);
    }

    const hint = field('hint');
    if (info.kind === 'local') {
      hint.hidden = true;
    } else if (info.kind === 'test') {
      hint.hidden = false;
      hint.textContent = '本地服务就绪且浏览器代理启用后，刷新页面切到本机。';
    } else {
      hint.hidden = false;
      hint.textContent = info.pending ? '请确认浏览器代理已启用，并刷新当前页面；仅服务启动不代表当前页面已切到本地。' : '打开本地项目面板查看同步状态。';
    }
  }

  async function refresh() {
    if (refreshing || document.hidden) return;
    refreshing = true;
    try {
      const response = await fetch('/__cafe/state.json?t=' + Date.now(), { cache: 'no-store', signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      state = await response.json();
      localConfirmed = false;
      const local = state.projects?.[project];
      if (local && state.proxyEnabled !== false) {
        const probe = await fetch(`/cybercafe-${project}/`, { method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout(5000) });
        const proof = probe.headers.get('x-cafe-local');
        if (probe.ok && proof === `${project}-${local.port}-${local.pid || 0}`) {
          const query = new URLSearchParams({ project, proof, since: local.since, workspace: state.workspaceId });
          const report = await fetch('/__cafe/confirm?' + query, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
          localConfirmed = report.ok;
        }
      }
      failed = false;
    } catch {
      failed = true;
      localConfirmed = false;
    } finally { refreshing = false; }
    render();
  }

  pill.addEventListener('click', () => {
    const open = card.hidden;
    card.hidden = !open;
    pill.setAttribute('aria-expanded', String(open));
  });
  mini.addEventListener('click', () => {
    setCollapsed(false);
    card.hidden = false;
    pill.setAttribute('aria-expanded', 'true');
  });
  wrap.querySelector('.collapse').addEventListener('click', () => {
    card.hidden = true;
    pill.setAttribute('aria-expanded', 'false');
    setCollapsed(true);
  });
  document.addEventListener('click', event => {
    if (!event.composedPath().includes(host)) {
      card.hidden = true;
      pill.setAttribute('aria-expanded', 'false');
    }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      card.hidden = true;
      pill.setAttribute('aria-expanded', 'false');
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh();
  });

  setCollapsed(isCollapsed());
  refresh();
  timer = window.setInterval(refresh, 5000);
  window.addEventListener('pagehide', () => window.clearInterval(timer), { once: true });
})();
