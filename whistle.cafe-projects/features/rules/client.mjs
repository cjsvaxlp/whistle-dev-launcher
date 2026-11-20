import { showError } from '../../shared/toast/toast.mjs';

const ruleState = document.querySelector('#rule-state');
const ruleText = document.querySelector('#rule-text');

export function bindRules() {
  const dialog = document.querySelector('#rule-dialog');
  const editor = document.querySelector('#rule-editor');
  const title = document.querySelector('#rule-title');
  const edit = document.querySelector('#edit-rule');
  const preview = document.querySelector('#preview-rule');
  const copy = document.querySelector('#copy-rule');
  const ruleNotice = document.querySelector('#rule-notice');

  function showEditor(editing) {
    title.textContent = editing ? 'Whistle 规则管理' : 'Cafe 自动代理';
    ruleText.hidden = editing;
    ruleState.hidden = editing;
    editor.hidden = !editing;
    edit.hidden = editing;
    preview.hidden = !editing;
    copy.hidden = editing;
    ruleNotice.textContent = '';
    editor.replaceChildren();
    if (editing) {
      const frame = document.createElement('iframe');
      frame.title = 'Whistle 规则管理';
      frame.src = new URL('/whistle/#rules', location.origin).href;
      editor.append(frame);
    } else {
      loadRulePreview();
    }
  }

  document.querySelector('#rules').addEventListener('click', () => {
    dialog.showModal();
    showEditor(false);
  });
  document.querySelector('#close-rule').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => editor.replaceChildren());
  dialog.addEventListener('click', event => {
    const bounds = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right
      || event.clientY < bounds.top || event.clientY > bounds.bottom)) dialog.close();
  });
  edit.addEventListener('click', () => showEditor(true));
  preview.addEventListener('click', () => showEditor(false));

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
