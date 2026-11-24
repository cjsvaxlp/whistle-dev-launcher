// Pure planning is shared with tests; only run() writes macOS preferences.
function planRestore(rows, services, managedPAC) {
  if (!Array.isArray(rows)) throw new Error('代理备份格式无效');
  const changes = [];
  for (const row of rows) {
    if (typeof row.service !== 'string' || typeof row.url !== 'string'
      || ['pac', 'web', 'secureweb', 'discovery'].some(key => typeof row[key] !== 'boolean')) {
      throw new Error('代理备份字段无效');
    }
    const ids = Object.keys(services);
    const exact = ids.filter(id => services[id].UserDefinedName === row.service);
    const matches = exact.length ? exact : ids.filter(id => services[id].Interface?.UserDefinedName === row.service);
    if (matches.length !== 1) continue;
    const id = matches[0];
    const current = services[id].Proxies || {};
    if (current.ProxyAutoConfigURLString !== managedPAC) continue;
    const proxy = Object.assign({}, current);
    if (row.url) proxy.ProxyAutoConfigURLString = row.url;
    else delete proxy.ProxyAutoConfigURLString;
    proxy.ProxyAutoConfigEnable = row.pac ? 1 : 0;
    proxy.HTTPEnable = row.web ? 1 : 0;
    proxy.HTTPSEnable = row.secureweb ? 1 : 0;
    proxy.ProxyAutoDiscoveryEnable = row.discovery ? 1 : 0;
    changes.push({ path: '/NetworkServices/' + id + '/Proxies', proxy });
  }
  return changes;
}

function run(argv) {
  ObjC.import('SystemConfiguration');
  const prefs = $.SCPreferencesCreate(null, $('Restore Cybercafe proxy'), null);
  if (!$.SCPreferencesLock(prefs, true)) throw new Error('无法锁定网络配置');
  try {
    const services = ObjC.deepUnwrap(ObjC.castRefToObject($.SCPreferencesGetValue(prefs, $('NetworkServices'))));
    const changes = planRestore(JSON.parse(argv[0]), services, argv[1]);
    for (const change of changes) {
      if (!$.SCPreferencesPathSetValue(prefs, $(change.path), $(change.proxy))) throw new Error('无法恢复网络代理');
    }
    if (changes.length && (!$.SCPreferencesCommitChanges(prefs) || !$.SCPreferencesApplyChanges(prefs))) throw new Error('无法保存网络代理');
    return String(changes.length);
  } finally { $.SCPreferencesUnlock(prefs); }
}
if (typeof module !== 'undefined') module.exports = { planRestore };
