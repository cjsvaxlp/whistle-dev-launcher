let toast;
let toastTimer;
const reportedErrors = new Map();

function showToast(message, kind) {
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'error-toast';
    toast.setAttribute('role', 'alert');
    toast.setAttribute('popover', 'manual');
    toast.hidden = true;
    document.body.append(toast);
  }
  clearTimeout(toastTimer);
  toast.dataset.kind = kind;
  toast.setAttribute('role', kind === 'info' ? 'status' : 'alert');
  toast.textContent = message;
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
