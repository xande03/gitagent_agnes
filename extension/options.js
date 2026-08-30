import { getAppUrl, DEFAULT_APP_URL } from "./app.js";

const input = document.getElementById("url");
input.value = await getAppUrl();
input.placeholder = DEFAULT_APP_URL;

document.getElementById("save").addEventListener("click", async () => {
  const value = input.value.trim().replace(/\/+$/, "");
  if (!/^https:\/\//i.test(value)) {
    document.getElementById("ok").textContent = "Use uma URL https://";
    return;
  }
  await chrome.storage.local.set({ appUrl: value });
  document.getElementById("ok").textContent = "Salvo";
});
