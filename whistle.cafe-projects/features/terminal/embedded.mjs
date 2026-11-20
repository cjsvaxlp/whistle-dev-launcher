const container = document.querySelector('#inline-terminal');
const frame = document.querySelector('#terminal-frame');
let current = '';

export function showTerminal(project, visible) {
  if (!project || !visible) {
    container.hidden = true;
    if (current) frame.removeAttribute('src');
    current = '';
    return;
  }
  container.hidden = false;
  if (current === project) return;
  current = project;
  frame.src = './terminal.html?' + new URLSearchParams({ project, embedded: '1' });
}

export function focusTerminal(project) {
  showTerminal(project, true);
  container.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  frame.focus();
}
