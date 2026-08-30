// A extensao vive ancorada no painel lateral do navegador: um clique no icone
// abre/fecha o painel, que divide a tela junto da pagina atual.
function enableSidePanelOnClick() {
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
}

chrome.runtime.onStartup?.addListener(enableSidePanelOnClick);

chrome.runtime.onInstalled.addListener(async () => {
  enableSidePanelOnClick();
  try {
    const win = await chrome.windows.getCurrent();
    await chrome.sidePanel.open({ windowId: win.id });
  } catch {
    // Alguns navegadores exigem gesto do usuario para abrir o painel.
  }
});

enableSidePanelOnClick();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "open-side-panel") {
    chrome.windows
      .getCurrent()
      .then((win) => chrome.sidePanel.open({ windowId: win.id }))
      .catch(() => {})
      .finally(() => sendResponse({ ok: true }));
    return true;
  }
  if (message?.type === "open-tab") {
    chrome.tabs.create({ url: message.url });
    sendResponse({ ok: true });
    return false;
  }
  return false;
});
