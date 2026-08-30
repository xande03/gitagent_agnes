// Abre o painel lateral ao clicar no icone (quando suportado) e mantem o popup como fallback.
chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "open-side-panel") {
    chrome.windows.getCurrent().then((win) => {
      chrome.sidePanel.open({ windowId: win.id }).catch(() => {});
      sendResponse({ ok: true });
    });
    return true;
  }
  if (message?.type === "open-tab") {
    chrome.tabs.create({ url: message.url });
    sendResponse({ ok: true });
    return false;
  }
  return false;
});
