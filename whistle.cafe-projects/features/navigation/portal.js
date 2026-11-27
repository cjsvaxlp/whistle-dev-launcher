// Runtime adapter for tool-opened tabs. Observe the existing profile check, then use a visible portal entry.
(function initializePortal() {
  'use strict';
  const navigation = window.__cafeReturn;
  if (location.origin !== 'https://cloudgametest2.migufun.com:18443'
    || !navigation?.read() || location.pathname !== '/cybercafe-power/') return;
  if (!['#/freeLogin', '#/amsportal'].includes(location.hash.split('?')[0])) {
    // A later in-app login redirect needs adaptation too, without polling normal pages.
    const activate = () => {
      if (!['#/freeLogin', '#/amsportal'].includes(location.hash.split('?')[0])) return;
      window.removeEventListener('hashchange', activate);
      window.removeEventListener('pagehide', dispose);
      initializePortal();
    };
    const dispose = () => window.removeEventListener('hashchange', activate);
    window.addEventListener('hashchange', activate);
    window.addEventListener('pagehide', dispose, { once: true });
    return;
  }
  const PROFILE = '/cybercafe-ruiyun-api/cmsapi/v2/street/account/profile';
  const LOGIN = /\/(?:login|logon|signin|sign-in|sso|auth|passport|token)(?:[\/?]|$)/i;
  const labels = {
    power: '算力管理模块v2.0', hub: '云网吧服务模块', open: '算力开放模块',
    service: '运营分析模块', store: '门店运营模块', inter: '娱乐版权益模块', monitor: '运维监控模块',
  };
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalFetch = window.fetch;
  let profileReady = false;
  let loginReady = false;
  let generation = 0;
  let profileTimer;
  let profilePolls = 0;
  let profilePending = false;
  let portal;
  let discoveryObserver;
  let profileController;
  const dialogObservers = new Map();
  let timer;
  let disposed = false;
  let automaticClick = false;
  let observer;

  function loggedIn() {
    return profileReady || loginReady;
  }
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
    discoveryObserver?.disconnect();
    for (const item of dialogObservers.values()) item.disconnect();
    dialogObservers.clear();
    profileController?.abort();
    clearTimeout(timer);
    clearTimeout(profileTimer);
    clearTimeout(expiryTimer);
    document.removeEventListener('click', onMenuClick, true);
    document.removeEventListener('DOMContentLoaded', initializeObserver);
    window.removeEventListener('hashchange', routeChanged);
    window.removeEventListener('error', reloadAfterChunkFailure, true);
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
    if (!loggedIn() || !onPortalEntry()) return;
    // Account review, forced password changes and other active dialogs retain their original flow.
    const dialogs = [...document.querySelectorAll('[role="dialog"], .el-dialog__wrapper, .v-modal')].filter(visible);
    for (const dialog of dialogs) {
      if (dialogObservers.has(dialog)) continue;
      const watcher = new MutationObserver(schedule);
      watcher.observe(dialog, { attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
      dialogObservers.set(dialog, watcher);
    }
    if (dialogs.length) return;
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
    if (disposed || !loggedIn() || !onPortalEntry()) return;
    clearTimeout(timer);
    timer = setTimeout(resume, 0);
  }
  function acceptProfile(id, status, body) {
    if (disposed || id !== generation) return;
    profileReady = status >= 200 && status < 300 && body?.returnCode === '000000'
      && body.resultData != null && Number(body.resultData.forceChangePassword) !== 1;
    if (profileReady) { clearTimeout(profileTimer); schedule(); }
  }
  function acceptLogin(status, body) {
    if (disposed || status < 200 || status >= 300) return;
    if (body && typeof body.returnCode === 'string' && body.returnCode !== '000000') return;
    loginReady = true;
    clearTimeout(profileTimer);
    schedule();
  }
  function routeChanged() {
    if (!onPortalEntry()) { cleanup(); return; }
    schedule();
  }
  async function pollProfile() {
    if (disposed || !onPortalEntry() || !navigation.read()) { cleanup(); return; }
    if (loggedIn() || profilePolls >= 40 || typeof originalFetch !== 'function' || profilePending) return;
    profilePolls++;
    profilePending = true;
    const id = ++generation;
    profileController = new AbortController();
    const requestTimeout = setTimeout(() => profileController?.abort(), 5000);
    try {
      const response = await originalFetch.call(window, PROFILE, { credentials: 'include', cache: 'no-store', signal: profileController.signal });
      acceptProfile(id, response.status, await response.clone().json());
    } catch { /* Keep original manual login available when the profile check fails. */ }
    finally {
      clearTimeout(requestTimeout);
      profileController = null;
      profilePending = false;
      if (!disposed && onPortalEntry() && !loggedIn() && profilePolls < 40) profileTimer = setTimeout(pollProfile, 1200);
    }
  }
  function observePortal() {
    const next = document.querySelector('.business-portal');
    if (!next || next === portal) return;
    portal = next;
    observer?.disconnect();
    observer = new MutationObserver(schedule);
    observer.observe(portal, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'disabled'] });
    discoveryObserver?.disconnect();
    // Only direct child changes on the portal's parent detect a replaced portal.
    discoveryObserver = new MutationObserver(observePortal);
    if (portal.parentNode) discoveryObserver.observe(portal.parentNode, { childList: true });
    schedule();
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
    } else if (typeof url === 'string' && LOGIN.test(url)) {
      this.addEventListener('loadend', () => {
        try {
          const body = this.responseType === 'json' ? this.response : JSON.parse(this.responseText || 'null');
          acceptLogin(this.status, body);
        } catch { acceptLogin(this.status, null); }
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
    } else if (typeof args[0] === 'string' && LOGIN.test(args[0])) {
      promise.then(response => response.clone().json().then(body => acceptLogin(response.status, body)).catch(() => acceptLogin(response.status, null))).catch(() => {});
    }
    return promise;
  }
  function reloadAfterChunkFailure(event) {
    const target = event.target;
    const source = target && target.src;
    const message = String(event.message || '');
    if (!((source && /\.js(?:\?|$)/.test(source)) || /chunk|src_views/i.test(message))) return;
    try {
      if (sessionStorage.getItem('__cafe_chunk_retry')) return;
      sessionStorage.setItem('__cafe_chunk_retry', '1');
    } catch { return; }
    location.reload();
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
  window.addEventListener('hashchange', routeChanged);
  window.addEventListener('error', reloadAfterChunkFailure, true);
  window.addEventListener('pagehide', cleanup, { once: true });
  function initializeObserver() {
    if (disposed) return;
    observePortal();
    if (!portal && !discoveryObserver) {
      // Before Vue mounts, observe structural changes on its root only.
      const root = document.querySelector('#app') || document.body;
      if (root) {
        discoveryObserver = new MutationObserver(observePortal);
        discoveryObserver.observe(root, { childList: true, subtree: true });
      }
    }
  }
  initializeObserver();
  if (!portal) document.addEventListener('DOMContentLoaded', initializeObserver, { once: true });
  profileTimer = setTimeout(pollProfile, 1200);
})();
