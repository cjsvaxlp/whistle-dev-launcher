let toast;
let toastMessage;
let toastTimer;
const reportedErrors = new Map();

function positionToast() {
  const toolbar = document.querySelector('body > header');
  const top = toolbar ? Math.max(24, toolbar.getBoundingClientRect().bottom + 12) : 24;
  toast.style.setProperty('--toast-top', `${Math.ceil(top)}px`);
}

function showToast(message, kind) {
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'error-toast';
    toast.setAttribute('role', 'alert');
    toast.setAttribute('popover', 'manual');
    toast.hidden = true;
    toastMessage = document.createElement('span');
    toastMessage.className = 'toast-message';
    toast.append(toastMessage);
    document.body.append(toast);
    const toolbar = document.querySelector('body > header');
    if (toolbar) new ResizeObserver(positionToast).observe(toolbar);
    window.addEventListener('resize', positionToast);
  }
  clearTimeout(toastTimer);
  toast.dataset.kind = kind;
  toast.setAttribute('role', kind === 'info' ? 'status' : 'alert');
  toastMessage.textContent = message;
  positionToast();
  toast.hidden = false;
  toast.showPopover?.();
  toastTimer = setTimeout(() => {
    toast.hidePopover?.();
    toast.hidden = true;
  }, 2000);
}

export function showError(message) { showToast(message, 'error'); }
export function showInfo(message) { showToast(message, 'info'); }

// Polling callers pass an empty message after recovery to allow future alerts.
export function reportError(source, message) {
  if (!message) {
    reportedErrors.delete(source);
    return;
  }
  if (reportedErrors.get(source) === message) return;
  reportedErrors.set(source, message);
  showError(message);
}
