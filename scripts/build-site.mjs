import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';

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

const repository = process.env.GITHUB_REPOSITORY || 'Zephyr-Aether/whistle-dev-launcher';
const downloads = { version: null, macos: null, windows: null };
if (process.env.GITHUB_ACTIONS === 'true') {
  const response = await fetch(`https://api.github.com/repos/${repository}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${process.env.GITHUB_TOKEN}` },
    signal: AbortSignal.timeout(15000),
  });
  if (response.status !== 404 && !response.ok) throw new Error(`读取 Release 失败：HTTP ${response.status}`);
  if (response.ok) {
    const release = await response.json();
    downloads.version = release.tag_name;
    for (const [platform, pattern] of [['macos', /-macOS-(arm64|aarch64)\.dmg$/i], ['windows', /-Windows-x64-Setup\.exe$/i]]) {
      const asset = release.assets.find(item => pattern.test(item.name));
      if (asset) downloads[platform] = { name: asset.name, url: asset.browser_download_url };
    }
  }
}
await writeFile(join(output, 'downloads.json'), JSON.stringify(downloads, null, 2) + '\n');
// Fail early if local resources referenced by HTML were omitted from deployment.
const html = await readFile(join(output, 'index.html'), 'utf8');
for (const [, path] of html.matchAll(/(?:src|href)="\.\/([^"#]+)"/g)) await readFile(join(output, path));
console.log('官网已生成：.cafe-tools/site');
