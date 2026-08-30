import { mountApp, getAppUrl } from "./app.js";

await mountApp("frame", "host");

document.getElementById("panel").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "open-side-panel" });
  window.close();
});
document.getElementById("tab").addEventListener("click", async () => {
  chrome.tabs.create({ url: await getAppUrl() });
  window.close();
});
document.getElementById("opts").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});
