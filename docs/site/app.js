// Release data is resolved at build time, including for private repositories.
// No GitHub credentials or authenticated API calls are sent to the browser.
const repository = document.documentElement.dataset.repository;
fetch('./downloads.json', { cache: 'no-cache' })
  .then(response => {
    if (!response.ok) throw new Error('release data unavailable');
    return response.json();
  })
  .then(release => {
    for (const platform of ['macos', 'windows']) {
      const asset = release[platform];
      if (!asset) continue;
      const url = new URL(asset.url);
      if (url.origin !== 'https://github.com' || !url.pathname.startsWith(`/${repository}/releases/download/`)) continue;
      const button = document.querySelector(`[data-download="${platform}"]`);
      button.href = url.href;
      button.textContent = `下载 ${platform === 'macos' ? 'macOS' : 'Windows'} 安装包 ↓`;
      button.setAttribute('aria-label', `下载 ${asset.name}`);
    }
    if (release.version) document.querySelector('#release-status').textContent = `最新版本 ${release.version} · 安装包来自 GitHub Releases`;
  })
  .catch(() => { /* Keep working Release links when metadata is unavailable. */ });
