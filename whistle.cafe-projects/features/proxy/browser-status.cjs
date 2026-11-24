// Reports are emitted by the injected badge only after a same-origin HEAD probe
// receives the local-forwarding marker. This is diagnostic state, not authorization.
const reports = new Map();
const MAX_AGE = 20000;
const identity = (project, local) => `${project}-${local.port}-${local.pid || 0}`;
function browserStatus(state, project, now = Date.now()) {
  const report = reports.get(project);
  const local = state?.projects?.[project];
  if (!report || !local || !state.proxyEnabled || now - report.at > MAX_AGE
    || report.workspace !== state.workspaceId || report.since !== local.since
    || report.proof !== identity(project, local)) return { confirmed: false };
  return { confirmed: true, lastSeenAt: new Date(report.at).toISOString() };
}
function recordBrowserReport(state, query, referer, now = Date.now()) {
  const project = query.get('project');
  const local = state?.projects?.[project];
  const age = now - Date.parse(state?.updatedAt);
  if (!local || !state.proxyEnabled || !Number.isFinite(age) || age < 0 || age > 30000) return false;
  try {
    const source = new URL(referer);
    if (source.origin !== 'https://cloudgametest2.migufun.com:18443'
      || !source.pathname.startsWith(`/cybercafe-${project}/`)) return false;
  } catch { return false; }
  const proof = query.get('proof');
  if (proof !== identity(project, local) || query.get('since') !== local.since
    || query.get('workspace') !== state.workspaceId) return false;
  reports.set(project, { proof, since: local.since, workspace: state.workspaceId, at: now });
  return true;
}
module.exports = { browserStatus, recordBrowserReport };
