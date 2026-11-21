import { showError } from '../../shared/toast/toast.mjs';
import { confirmAction, post } from '../../shared/http/client.mjs';

const doctorModal = document.querySelector('#doctor-modal');
const doctorState = document.querySelector('#doctor-state');
const doctorList = document.querySelector('#doctor-list');

export function bindDoctor({ load }) {

  const FIX_LABELS = {
    'install-ca': '安装 CA',
    'open-ca': '打开证书设置',
    'write-pac': '生成 PAC',
    'link-plugin': '链接插件',
    'clean-legacy': '清理旧规则',
    sync: '立即同步',
  };

  let repairing = false;

  async function applyFix(action) {
    if (repairing) return;
    if (action === 'clean-legacy' && !await confirmAction('删除体检列出的旧规则？')) return;
    if (action === 'install-ca' && !await confirmAction('在当前用户的系统证书库中信任本机 Whistle 的根证书？')) return;
    repairing = true;
    doctorList.querySelectorAll('button').forEach(button => { button.disabled = true; });
    doctorState.textContent = '正在处理…';
    try {
      const response = await post(`./api/fix/${action}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || '操作失败。');
      if (!doctorModal.hidden && action !== 'open-ca') await showDoctor();
      doctorState.textContent = data.message;
      await load();
    } catch (error) {
      doctorState.textContent = '';
      showError(error.message);
    } finally {
      repairing = false;
      doctorList.querySelectorAll('button').forEach(button => { button.disabled = false; });
    }
  }

  function renderChecks(data) {
    doctorList.replaceChildren();
    for (const check of data.checks) {
      const item = document.createElement('li');
      const badge = document.createElement('span');
      badge.className = 'badge ' + check.status;
      badge.textContent = check.id === 'pac' && check.status === 'unknown' ? '可选' : { ok: '正常', warn: '注意', fail: '异常', unknown: '待确认' }[check.status] || check.status;
      const text = document.createElement('div');
      text.className = 'check-text';
      const name = document.createElement('b');
      name.textContent = check.label;
      const detail = document.createElement('span');
      detail.textContent = check.detail || '';
      text.append(name, detail);
      if (check.action) {
        const action = document.createElement('span');
        action.className = 'check-action';
        action.textContent = check.action;
        text.append(action);
      }
      item.append(badge, text);
      if (FIX_LABELS[check.fix]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'secondary';
        button.textContent = FIX_LABELS[check.fix];
        button.addEventListener('click', () => applyFix(check.fix));
        item.append(button);
      }
      doctorList.append(item);
    }
    doctorState.textContent = data.ok ? '全部正常' : '有需要处理的项';
  }

  async function showDoctor({ auto = false } = {}) {
    doctorModal.hidden = false;
    doctorState.textContent = '检查中…';
    doctorList.replaceChildren();
    try {
      const response = await fetch('./api/doctor', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || '检查失败。');
      renderChecks(data);
      if (auto && data.ok) {
        doctorModal.hidden = true;
        localStorage.setItem('cafe-doctor-seen', '1');
      }
    } catch (error) {
      doctorState.textContent = '';
      showError(error.message);
    }
  }

  document.querySelector('#doctor').addEventListener('click', () => showDoctor());
  document.querySelector('#rerun-doctor').addEventListener('click', () => showDoctor());
  document.querySelector('#close-doctor').addEventListener('click', () => {
    doctorModal.hidden = true;
    localStorage.setItem('cafe-doctor-seen', '1');
  });
  doctorModal.addEventListener('click', event => {
    if (event.target === doctorModal) {
      doctorModal.hidden = true;
      localStorage.setItem('cafe-doctor-seen', '1');
    }
  });

  return { showDoctor };
}
