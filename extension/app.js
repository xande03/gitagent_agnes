// Config unica do app hospedado. A chave da API Agnes e a URL base do provedor
// NUNCA vivem na extensao: elas ficam no servidor do app (server functions),
// que e chamado a partir desta URL. A extensao apenas embute a interface.
export const DEFAULT_APP_URL = "https://gitagent-agnes.lovable.app";

// URLs alternativas testadas automaticamente quando a principal nao responde.
const FALLBACK_URLS = ["https://project--263fba90-48cf-4930-bc9a-b508c4c20b83.lovable.app"];

export async function getAppUrl() {
  const { appUrl } = await chrome.storage.local.get("appUrl");
  const url = (appUrl || DEFAULT_APP_URL).trim().replace(/\/+$/, "");
  return /^https:\/\//i.test(url) ? url : DEFAULT_APP_URL;
}


// Verifica se a URL responde antes de embutir: se o app nao estiver publicado
// (403/404) o iframe fica em branco sem nenhuma pista para o usuario.
async function probe(url) {
  try {
    const response = await fetch(url, { method: "GET", credentials: "omit", cache: "no-store" });
    return { ok: response.ok, status: response.status };
  } catch (error) {
    return { ok: false, status: 0, message: String(error?.message || error) };
  }
}

function renderFallback(frame, url, result) {
  const box = document.createElement("div");
  box.className = "fallback";
  const reason =
    result.status === 403 || result.status === 401
      ? "O app ainda nao esta publicado (ou exige login). Publique o projeto no Lovable e a extensao carregara a mesma interface do PWA."
      : result.status === 404
        ? "URL nao encontrada. Ajuste o endereco do app em Config."
        : `Nao foi possivel conectar (${result.status || "rede"}). Verifique sua internet ou o endereco em Config.`;
  box.innerHTML = `
    <h1>Interface indisponivel</h1>
    <p>${reason}</p>
    <code>${url}</code>
    <div class="fallback-actions">
      <button id="retry">Tentar de novo</button>
      <button id="open">Abrir em aba</button>
      <button id="config">Config</button>
    </div>
  `;
  frame.replaceWith(box);
  box.querySelector("#retry").addEventListener("click", () => location.reload());
  box.querySelector("#open").addEventListener("click", () => chrome.tabs.create({ url }));
  box.querySelector("#config").addEventListener("click", () => chrome.runtime.openOptionsPage());
}

// Dentro da extensao o localStorage do iframe pode ser limpo/particionado, então
// guardamos a conexao em chrome.storage.local e a devolvemos ao app a cada carga.
const STORAGE_KEY = "agnesConnection";

function bridge(frame, url) {
  const origin = new URL(url).origin;

  const send = async () => {
    const { [STORAGE_KEY]: connection } = await chrome.storage.local.get(STORAGE_KEY);
    frame.contentWindow?.postMessage(
      { type: "agnes:restore", connection: connection ?? null, appUrl: url },
      origin,
    );
  };

  window.addEventListener("message", (event) => {
    if (event.origin !== origin) return;
    const data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.type === "agnes:ready") void send();
    if (data.type === "agnes:persist") {
      void chrome.storage.local.set({ [STORAGE_KEY]: data.connection ?? null });
    }
    if (data.type === "agnes:clear") {
      void chrome.storage.local.remove(STORAGE_KEY);
    }
  });

  frame.addEventListener("load", () => void send());
}

export async function mountApp(frameId, statusId) {
  let url = await getAppUrl();
  const frame = document.getElementById(frameId);
  const status = statusId ? document.getElementById(statusId) : null;
  if (status) status.textContent = new URL(url).host;

  let result = await probe(url);
  // Se a URL salva/padrao nao responder, tenta as alternativas conhecidas.
  for (const candidate of FALLBACK_URLS) {
    if (result.ok || candidate === url) break;
    const next = await probe(candidate);
    if (next.ok) {
      url = candidate;
      result = next;
      if (status) status.textContent = new URL(url).host;
    }
  }
  if (!result.ok) {
    renderFallback(frame, url, result);
    if (status) status.textContent = `${new URL(url).host} · offline`;
    return url;
  }


  bridge(frame, url);
  frame.src = url;
  return url;
}

