import { mountApp, getAppUrl } from "./app.js";

const url = await mountApp("frame", "host");

document.getElementById("tab").addEventListener("click", async () => {
  chrome.tabs.create({ url: await getAppUrl() });
});
document.getElementById("opts").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

void url;
