import { confirmAction, post } from './api.mjs';

const rulePage = document.querySelector('#rule-page');
const ruleState = document.querySelector('#rule-state');
const ruleText = document.querySelector('#rule-text');
const doctorModal = document.querySelector('#doctor-modal');
const doctorState = document.querySelector('#doctor-state');
const doctorList = document.querySelector('#doctor-list');

export function bindDialogs({ load }) {

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
    doctorState.textContent = '正在处理…';
    try {
      const response = await post(`./api/fix/${action}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || '操作失败。');
      if (!doctorModal.hidden && action !== 'open-ca') await showDoctor();
      doctorState.textContent = data.message;
      await load();
    } catch (error) {
      doctorState.textContent = error.message;
    } finally {
      repairing = false;
    }
  }

  function renderChecks(data) {
    doctorList.replaceChildren();
    for (const check of data.checks) {
      const item = document.createElement('li');
      const badge = document.createElement('span');
      badge.className = 'badge ' + check.status;
      badge.textContent = { ok: '正常', warn: '注意', fail: '异常', unknown: '待确认' }[check.status] || check.status;
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
      doctorState.textContent = error.message;
    }
  }

  const projectPage = document.querySelector('#project-page');
  const ruleEditor = document.querySelector('#rule-editor');
  const ruleCrumb = document.querySelector('#rule-crumb');
  const editorCrumb = document.querySelector('#rule-editor-crumb');
  const ruleTitle = document.querySelector('#rule-title');
  const ruleActions = document.querySelector('#rule-actions');
  const ruleNotice = document.querySelector('#rule-notice');

  function renderRoute() {
    const editing = location.hash === '#/rules/whistle';
    const viewing = location.hash === '#/rules';
    projectPage.hidden = editing || viewing;
    rulePage.hidden = !projectPage.hidden;
    ruleTitle.textContent = editing ? 'Whistle 规则' : 'Cafe 自动代理';
    editorCrumb.hidden = !editing;
    if (viewing) ruleCrumb.setAttribute('aria-current', 'page');
    else ruleCrumb.removeAttribute('aria-current');
    ruleState.hidden = !viewing;
    ruleText.hidden = !viewing;
    ruleActions.hidden = !viewing;
    ruleEditor.hidden = !editing;
    ruleNotice.textContent = '';

    if (editing) {
      if (ruleEditor.firstChild) return;
      const frame = document.createElement('iframe');
      frame.title = 'Whistle 规则管理';
      // Whistle reserves this prefix for its own UI, even from a plugin page.
      frame.src = new URL('/whistle/#rules', location.origin).href;
      ruleEditor.append(frame);
    } else {
      ruleEditor.replaceChildren();
      if (viewing) loadRulePreview();
    }
  }

  window.addEventListener('hashchange', renderRoute);
  if (!location.hash && new URLSearchParams(location.search).get('rule') === '1') {
    history.replaceState(null, '', '#/rules');
  }
  renderRoute();

  async function loadRulePreview() {
    ruleText.textContent = '正在读取…';
    ruleState.textContent = '';
    try {
      const response = await fetch('./api/rule', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || '读取失败。');
      if (data.value === null) {
        ruleText.textContent = `Whistle 里暂时没有「${data.name}」规则。`;
        return;
      }
      ruleText.textContent = data.value;
      ruleState.textContent = data.selected ? '已启用' : '未启用';
    } catch (error) {
      ruleText.textContent = error.message;
    }
  }

  document.querySelector('#copy-rule').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(ruleText.textContent);
      ruleNotice.textContent = '已复制到剪贴板。';
    } catch {
      ruleNotice.textContent = '复制失败，请手动选择规则内容。';
    }
  });

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
