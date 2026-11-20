let toast;
let toastTimer;
const reportedErrors = new Map();

export function showError(message) {
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'error-toast';
    toast.setAttribute('role', 'alert');
    toast.hidden = true;
    document.body.append(toast);
  }
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 2000);
}

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
