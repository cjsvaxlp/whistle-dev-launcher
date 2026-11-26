// Tool-opened navigation only. Keep return metadata in this tab across login redirects.
(() => {
  'use strict';
  if (window.top !== window.self || window.__cafeReturn) return;
  const ORIGIN = 'https://cloudgametest2.migufun.com:18443';
  if (location.origin !== ORIGIN) return;
  const PREFIX = '__cafe_return__:';
  const PARAM = '__cafe_return';
  const STORAGE_KEY = '__cafe_return_state';
  const TTL = 15 * 60 * 1000;
  const bootstrap = /\/(?:login(?:_4A)?|testLogin|freeLogin|amsportal|noPower|404|review|accountCenter|register|forgotPassword|changePhone|certification)(?:\/|$)/i;
  let state;
  let previousName = window.name || '';
  let pushWrapper;
  let replaceWrapper;
  let storage;
  let clearWrapper;
  let originalClear;
  try { storage = window.sessionStorage; originalClear = window.Storage?.prototype.clear; } catch { /* Storage may be unavailable. */ }

  function targetOf(value) {
    try {
      if (typeof value !== 'string' || value.length > 4096) return null;
      const url = new URL(value, ORIGIN);
      const match = /^\/cybercafe-([a-z0-9-]+)\//.exec(url.pathname);
      if (url.origin !== ORIGIN || url.username || url.password || !match) return null;
      url.searchParams.delete(PARAM);
      return { url: url.href, project: match[1] };
    } catch { return null; }
  }
  function save() {
    const value = JSON.stringify({ ...state, previousName });
    try { window.name = PREFIX + value; } catch { /* Keep the sessionStorage fallback. */ }
    try { storage?.setItem(STORAGE_KEY, value); } catch { /* Keep the window.name fallback. */ }
  }
  function cancel() {
    state = null;
    try { if (window.name.startsWith(PREFIX)) window.name = previousName; } catch { /* No authentication state is stored here. */ }
    try { storage?.removeItem(STORAGE_KEY); } catch { /* Storage may be unavailable. */ }
    if (clearWrapper && window.Storage.prototype.clear === clearWrapper) window.Storage.prototype.clear = originalClear;
    window.removeEventListener('hashchange', check);
    window.removeEventListener('popstate', check);
    if (history.pushState === pushWrapper) history.pushState = originalPush;
    if (history.replaceState === replaceWrapper) history.replaceState = originalReplace;
  }
  function read() {
    if (!state || Date.now() > state.expiresAt) return null;
    return targetOf(state.url);
  }
  const originalPush = history.pushState;
  const originalReplace = history.replaceState;
  try {
    const stored = window.name.startsWith(PREFIX) ? window.name.slice(PREFIX.length) : storage?.getItem(STORAGE_KEY);
    if (stored) {
      const saved = JSON.parse(stored);
      previousName = typeof saved.previousName === 'string' ? saved.previousName : '';
      if (saved.expiresAt > Date.now() && saved.expiresAt <= Date.now() + TTL && targetOf(saved.url)) state = saved;
      else { window.name = previousName; storage?.removeItem(STORAGE_KEY); }
    }
  } catch { /* Unavailable storage or damaged metadata must not prevent a new tool entry. */ }
  try {
    const url = new URL(location.href);
    if (url.searchParams.has(PARAM)) {
      const target = targetOf(url.searchParams.get(PARAM));
      if (target) {
        state = { ...target, expiresAt: Date.now() + TTL, loginSeen: false, attempted: false };
        save();
      }
      url.searchParams.delete(PARAM);
      originalReplace.call(history, history.state, '', url.href);
    }
  } catch { /* Invalid or expired return metadata never changes the application's navigation. */ }
  if (!state) return;
  // Login clears business session data. Preserve only our expiring return URL,
  // never account credentials; mirror it because window.name can be reset on navigation.
  if (originalClear) {
    clearWrapper = window.Storage.prototype.clear = function (...args) {
      const result = originalClear.apply(this, args);
      if (this === storage && read()) save();
      return result;
    };
  }

  window.__cafeReturn = {
    read,
    cancel,
    beginExchange(project) {
      const target = read();
      if (!target || target.project !== project || state.attempted) return false;
      state.attempted = true;
      state.loginSeen = true;
      save();
      return true;
    },
  };
  function check() {
    const target = read();
    if (!target) { cancel(); return; }
    const current = /^\/cybercafe-([a-z0-9-]+)\//.exec(location.pathname)?.[1];
    if (current && current !== target.project && current !== 'power' && !(current === 'cms' && target.project === 'newcms')) { cancel(); return; }
    const route = location.hash.slice(1).split('?')[0] || '/';
    // CMS / New CMS have their own login, but the unified SSO may land on the
    // power portal. Only this CMS target is returned to CMS; portal projects
    // continue to use portal.js, and all other projects keep their own flow.
    if (current === 'power' && route === '/amsportal' && state.loginSeen
        && target.project === 'cms' && !state.powerReturned
        && !new URL(target.url).hash) {
      state.loginSeen = false;
      state.powerReturned = true;
      save();
      location.replace(target.url);
      return;
    }
    const isBootstrap = route === '/' || bootstrap.test(route);
    if (isBootstrap) {
      if (!state.loginSeen) { state.loginSeen = true; save(); }
    } else if (state.loginSeen && current === target.project) {
      const targetRoute = new URL(target.url).hash.slice(1).split('?')[0] || '/';
      state.loginSeen = false;
      state.attempted = false;
      state.handoff = false;
      // Entry/login routes mean "this module"; do not bounce back from its first authorized page.
      if (targetRoute !== '/' && !bootstrap.test(targetRoute) && location.href !== target.url) {
        save();
        location.replace(target.url);
        return;
      }
      state.url = location.href;
      save();
    } else if (!state.loginSeen && current === target.project) {
      // Follow normal in-module navigation, so a later login resumes the latest page.
      state.url = location.href;
      save();
    }
  }
  function schedule() { check(); }
  pushWrapper = history.pushState = function (...args) { const result = originalPush.apply(this, args); schedule(); return result; };
  replaceWrapper = history.replaceState = function (...args) { const result = originalReplace.apply(this, args); schedule(); return result; };
  window.addEventListener('hashchange', check);
  window.addEventListener('popstate', check);
  window.addEventListener('DOMContentLoaded', check, { once: true });
  check();
})();
