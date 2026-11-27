import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, '.cafe-tools/site');
await rm(output, { recursive: true, force: true });
await mkdir(join(output, 'assets'), { recursive: true });
for (const name of ['index.html', 'style.css', 'app.js']) {
  await cp(join(root, 'docs/site', name), join(output, name));
}
for (const name of ['main-panel.png', 'environment-check.png', 'browser-proxy-help.png']) {
  await cp(join(root, 'docs/images', name), join(output, 'assets', name));
}
await cp(join(root, 'desktop/icons/icon.png'), join(output, 'assets/icon.png'));
await writeFile(join(output, '.nojekyll'), '');

function git(...args) {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return ''; }
}
const remote = git('remote', 'get-url', 'origin');
const repository = process.env.GITHUB_REPOSITORY || remote.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/)?.[1];
if (!repository || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('无法识别 GitHub 仓库，请设置 GITHUB_REPOSITORY。');
let defaultBranch = process.env.GITHUB_DEFAULT_BRANCH || git('symbolic-ref', '--short', 'refs/remotes/origin/HEAD').replace(/^origin\//, '') || 'main';
let webBranch = git('show-ref', '--verify', 'refs/remotes/origin/myler') ? 'myler' : defaultBranch;
async function api(path) {
  const headers = { Accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const response = await fetch(`https://api.github.com/repos/${repository}${path}`, { headers, signal: AbortSignal.timeout(15000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`读取 GitHub 信息失败：HTTP ${response.status}`);
  return response.json();
}
const downloads = { version: null, macos: null, windows: null };
if (process.env.GITHUB_ACTIONS === 'true') {
  const [metadata, branch, release] = await Promise.all([api(''), api('/branches/myler'), api('/releases/latest')]);
  defaultBranch = metadata?.default_branch || defaultBranch;
  webBranch = branch ? 'myler' : defaultBranch;
  if (release) {
    downloads.version = release.tag_name;
    for (const [platform, pattern] of [['macos', /-macOS-(arm64|aarch64)\.dmg$/i], ['windows', /-Windows-x64-Setup\.exe$/i]]) {
      const asset = release.assets.find(item => pattern.test(item.name));
      if (asset) downloads[platform] = { name: asset.name, url: asset.browser_download_url };
    }
  }
}
await writeFile(join(output, 'downloads.json'), JSON.stringify(downloads, null, 2) + '\n');
// Fail early if local resources referenced by HTML were omitted from deployment.
const [owner, name] = repository.split('/');
const siteURL = process.env.GITHUB_PAGES_URL || `https://${owner.toLowerCase()}.github.io${name.toLowerCase() === `${owner.toLowerCase()}.github.io` ? '/' : `/${name}/`}`;
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
let html = await readFile(join(output, 'index.html'), 'utf8');
for (const [token, value] of Object.entries({
  __REPOSITORY__: repository,
  __DEFAULT_BRANCH__: encodeURIComponent(defaultBranch),
  __WEB_BRANCH__: encodeURIComponent(webBranch),
  __WEB_BRANCH_LABEL__: webBranch,
  __SITE_URL__: siteURL,
})) html = html.replaceAll(token, escape(value));
if (/__[A-Z_]+__/.test(html)) throw new Error('官网模板仍有未替换的配置。');
await writeFile(join(output, 'index.html'), html);
for (const [, path] of html.matchAll(/(?:src|href)="\.\/([^"#]+)"/g)) await readFile(join(output, path));
console.log('官网已生成：.cafe-tools/site');
