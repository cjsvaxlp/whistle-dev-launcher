const { existsSync, readdirSync } = require('node:fs');
const { homedir } = require('node:os');
const { join } = require('node:path');

const DOWNLOAD_SKIP = new Set([
  'node_modules', '.git', '.idea', '.vscode', '.cafe-tools', 'dist', 'build',
  'target', 'AppData', 'Windows', 'Program Files', 'Program Files (x86)',
  'ProgramData', '$Recycle.Bin', 'System Volume Information', 'Library',
  '.Trash', 'Chrome开发配置', 'logs', 'temp', 'tmp',
]);

function isWorkspace(directory) {
  try {
    return readdirSync(directory, { withFileTypes: true }).some(entry => entry.isDirectory()
      && /^cybercafe-[a-z0-9-]+$/.test(entry.name)
      && existsSync(join(directory, entry.name, 'package.json')));
  } catch {
    return false;
  }
}

function candidateRoots(home) {
  const roots = [
    join(home, 'Desktop', 'work'),
    join(home, 'Desktop', 'code'),
    join(home, 'Desktop'),
    join(home, 'work'),
    join(home, 'Documents', 'work'),
    join(home, 'source', 'repos'),
    join(home, 'projects'),
    join(home, 'dev'),
    join(home, 'OneDrive', 'Desktop', 'work'),
    join(home, 'OneDrive', 'Desktop'),
  ];
  for (const letter of ['C', 'D', 'E', 'F', 'G', 'H']) {
    for (const child of ['work', 'Desktop\\work', 'code', 'projects', 'project', 'dev', 'workspace']) {
      roots.push(letter + ':\\' + child);
    }
  }
  return [...new Set(roots)].filter(root => existsSync(root));
}

function findWorkspace({ home = homedir(), maxDepth = 3, maxVisited = 2500 } = {}) {
  const roots = candidateRoots(home);
  const direct = [];
  for (const root of roots) {
    direct.push(
      join(root, 'cloudgame-cybercafe', 'cybercafe-front'),
      join(root, 'cybercafe-front'),
      root,
    );
  }
  for (const directory of direct) {
    if (isWorkspace(directory)) return directory;
  }

  const queue = roots.map(directory => ({ directory, depth: 0 }));
  let visited = 0;
  while (queue.length && visited < maxVisited) {
    const { directory, depth } = queue.shift();
    if (depth > maxDepth) continue;
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || DOWNLOAD_SKIP.has(entry.name) || entry.name.startsWith('.')) continue;
      const child = join(directory, entry.name);
      visited += 1;
      if (entry.name === 'cybercafe-front' && isWorkspace(child)) return child;
      if (depth < maxDepth) queue.push({ directory: child, depth: depth + 1 });
      if (visited >= maxVisited) break;
    }
  }
  return '';
}

module.exports = { findWorkspace, isWorkspace };
