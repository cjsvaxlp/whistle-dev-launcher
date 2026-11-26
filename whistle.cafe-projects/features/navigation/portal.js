// Runtime adapter for tool-opened tabs. Observe the existing profile check, then use a visible portal entry.
(() => {
  'use strict';
  const navigation = window.__cafeReturn;
  if (!navigation?.read() || location.pathname !== '/cybercafe-power/') return;
  const PROFILE = '/cybercafe-ruiyun-api/cmsapi/v2/street/account/profile';
  const labels = {
    power: '算力管理模块v2.0', hub: '云网吧服务模块', open: '算力开放模块',
    service: '运营分析模块', store: '门店运营模块', inter: '娱乐版权益模块', monitor: '运维监控模块',
  };
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalFetch = window.fetch;
  let profileReady = false;
  let generation = 0;
  let timer;
  let disposed = false;
  let automaticClick = false;
  let observer;

  function isProfile(value) {
    try {
      const url = new URL(typeof value === 'string' ? value : value?.url, location.href);
      return url.origin === location.origin && url.pathname === PROFILE;
    } catch { return false; }
  }
  function cleanup() {
    if (disposed) return;
    disposed = true;
    observer?.disconnect();
    clearTimeout(timer);
    clearTimeout(expiryTimer);
    document.removeEventListener('click', onMenuClick, true);
    window.removeEventListener('hashchange', schedule);
    if (XMLHttpRequest.prototype.open === openWrapper) XMLHttpRequest.prototype.open = originalOpen;
    if (window.fetch === fetchWrapper) window.fetch = originalFetch;
  }
  function onPortalEntry() {
    const route = location.hash.split('?')[0];
    return route === '#/freeLogin' || route === '#/amsportal';
  }
  function visible(element) {
    return !element.hidden && element.getClientRects().length > 0;
  }
  function resume() {
    if (disposed) return;
    const target = navigation.read();
    if (!target) { cleanup(); return; }
    if (!profileReady || !onPortalEntry()) return;
    // Account review, forced password changes and other active dialogs retain their original flow.
    if ([...document.querySelectorAll('[role="dialog"], .el-dialog__wrapper, .v-modal')].some(visible)) return;
    const label = labels[target.project];
    if (!label) return;
    const buttons = [...document.querySelectorAll('.business-portal button.service-entry')];
    const matches = buttons.filter(button => button.textContent.trim() === label && visible(button)
      && !button.disabled && button.getAttribute('aria-disabled') !== 'true');
    if (matches.length !== 1 || !navigation.beginExchange(target.project)) return;
    automaticClick = true;
    try { matches[0].click(); } finally { automaticClick = false; cleanup(); }
  }
  function schedule() {
    if (disposed || !profileReady || !onPortalEntry()) return;
    clearTimeout(timer);
    timer = setTimeout(resume, 0);
  }
  function acceptProfile(id, status, body) {
    if (disposed || id !== generation) return;
    profileReady = status >= 200 && status < 300 && body?.returnCode === '000000'
      && body.resultData != null && Number(body.resultData.forceChangePassword) !== 1;
    if (profileReady) schedule();
  }
  function openWrapper(method, url, ...rest) {
    const result = originalOpen.call(this, method, url, ...rest);
    if (isProfile(url)) {
      const id = ++generation;
      profileReady = false;
      this.addEventListener('loadend', () => {
        try {
          const body = this.responseType === 'json' ? this.response : JSON.parse(this.responseText);
          acceptProfile(id, this.status, body);
        } catch { /* Unknown response format never triggers automatic navigation. */ }
      }, { once: true });
    }
    return result;
  }
  function fetchWrapper(...args) {
    const promise = originalFetch.apply(this, args);
    if (isProfile(args[0])) {
      const id = ++generation;
      profileReady = false;
      promise.then(response => response.clone().json().then(body => acceptProfile(id, response.status, body))).catch(() => {});
    }
    return promise;
  }
  function onMenuClick(event) {
    if (automaticClick) return;
    const button = event.target.closest?.('.business-portal button.service-entry');
    if (!button) return;
    const target = navigation.read();
    if (target && button.textContent.trim() === labels[target.project]) navigation.beginExchange(target.project);
    else navigation.cancel();
    cleanup();
  }
  const expiryTimer = setTimeout(cleanup, 15 * 60 * 1000);
  XMLHttpRequest.prototype.open = openWrapper;
  if (typeof originalFetch === 'function') window.fetch = fetchWrapper;
  document.addEventListener('click', onMenuClick, true);
  window.addEventListener('hashchange', schedule);
  window.addEventListener('pagehide', cleanup, { once: true });
  observer = new MutationObserver(schedule);
  observer.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'disabled'] });
})();
