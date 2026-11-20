import { showError } from '../../shared/toast/toast.mjs';

const rulePage = document.querySelector('#rule-page');
const ruleState = document.querySelector('#rule-state');
const ruleText = document.querySelector('#rule-text');

export function bindRules() {
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
      ruleText.textContent = '';
      showError(error.message);
    }
  }

  document.querySelector('#copy-rule').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(ruleText.textContent);
      ruleNotice.textContent = '已复制到剪贴板。';
    } catch {
      showError('复制失败，请手动选择规则内容。');
    }
  });

}
