const container = document.querySelector('#inline-terminal');
const frame = document.querySelector('#terminal-frame');
let current = '';
let workspace = '';
document.addEventListener('cafe-projects-updated', event => {
  if (workspace !== event.detail.workspace) {
    workspace = event.detail.workspace || '';
    current = '';
    frame.removeAttribute('src');
  }
});

export function showTerminal(project, visible, state) {
  if (state) container.dataset.state = state;
  if (!project || !visible) {
    container.hidden = true;
    if (current) frame.removeAttribute('src');
    current = '';
    return;
  }
  container.hidden = false;
  if (current === project) return;
  current = project;
  frame.src = './terminal.html?' + new URLSearchParams({ project, embedded: '1', workspace });
}

export function focusTerminal(project) {
  showTerminal(project, true);
  container.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  frame.focus();
}

function updateMotion() {
  container.dataset.motion = document.hidden ? 'paused' : 'running';
}
document.addEventListener('visibilitychange', updateMotion);
updateMotion();
