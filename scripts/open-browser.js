// Runs in macOS JavaScript for Automation.
ObjC.import('AppKit');

function run(args) {
  const url = args[0];
  const target = $.NSWorkspace.sharedWorkspace.URLForApplicationToOpenURL($.NSURL.URLWithString(url));
  if (!target) throw new Error('找不到默认浏览器。');
  const bundle = $.NSBundle.bundleWithURL(target).bundleIdentifier.js;
  const safari = ['com.apple.Safari', 'com.apple.SafariTechnologyPreview'].includes(bundle);
  const chromium = [
    'com.google.Chrome', 'com.google.Chrome.canary', 'com.microsoft.edgemac',
    'com.brave.Browser', 'com.vivaldi.Vivaldi', 'org.chromium.Chromium',
  ].includes(bundle);
  if (!safari && !chromium) {
    throw new Error('当前默认浏览器暂不支持标签页复用，请使用 Safari、Chrome、Edge、Brave、Vivaldi 或 Chromium。');
  }

  const browser = Application(bundle);
  if (!browser.running()) browser.launch();
  const windows = browser.windows();
  for (let w = 0; w < windows.length; w++) {
    const tabs = windows[w].tabs();
    for (let t = 0; t < tabs.length; t++) {
      if (tabs[t].url() !== url) continue;
      if (safari) windows[w].currentTab = tabs[t];
      else windows[w].activeTabIndex = t + 1;
      windows[w].index = 1;
      browser.activate();
      return;
    }
  }

  if (!windows.length) {
    if (safari) browser.Document().make();
    else browser.Window().make();
  }
  const window = browser.windows[0];
  window.tabs.push(browser.Tab({ url: url }));
  const tabs = window.tabs();
  if (safari) window.currentTab = tabs[tabs.length - 1];
  else window.activeTabIndex = tabs.length;
  browser.activate();
}
