// Config unica do app hospedado. A chave da API Agnes e a URL base do provedor
// NUNCA vivem na extensao: elas ficam no servidor do app (server functions),
// que e chamado a partir desta URL. A extensao apenas embute a interface.
export const DEFAULT_APP_URL =
  "https://project--263fba90-48cf-4930-bc9a-b508c4c20b83.lovable.app";

export async function getAppUrl() {
  const { appUrl } = await chrome.storage.local.get("appUrl");
  const url = (appUrl || DEFAULT_APP_URL).trim().replace(/\/+$/, "");
  return /^https:\/\//i.test(url) ? url : DEFAULT_APP_URL;
}

export async function mountApp(frameId, statusId) {
  const url = await getAppUrl();
  const frame = document.getElementById(frameId);
  const status = statusId ? document.getElementById(statusId) : null;
  frame.src = url;
  if (status) status.textContent = new URL(url).host;
  return url;
}
