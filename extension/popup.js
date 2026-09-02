/**
 * Agnes Code Agent — extensão de navegador (MV3).
 * Controlador da UI: conexão, chat, streaming em tempo real, tema, anexos.
 * Espelho funcional de routes/index.tsx + components/agent/* do app web.
 */

import { runAgentStream } from "./lib/agent.js";
import { getRepoInfo } from "./lib/github.js";
import { renderMarkdownHtml } from "./lib/markdown.js";
import { hydrateIcons, icons } from "./lib/icons.js";

const STORAGE_CONNECTION = "agnes-connection";
const STORAGE_THEME = "agnes-theme";

const SUGGESTIONS = [
  "Analise a estrutura do projeto e resuma a arquitetura",
  "Corrija erros de tipagem no arquivo principal",
  "Adicione um componente de rodapé responsivo",
  "Crie um README completo para este projeto",
];

const state = {
  theme: "dark",
  creds: null, // {token, owner, repo, branch, agnesKey}
  repoInfo: null, // {fullName, defaultBranch, private, url, description, avatarUrl}
  messages: [],
  sending: false,
  streamActive: false,
  attachments: [],
};

/* ===== Armazenamento (chrome.storage.local) ===== */

const storage = {
  async get(key) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(key, (items) => resolve(items?.[key]));
      } catch {
        resolve(JSON.parse(localStorage.getItem(key) ?? "null"));
      }
    });
  },
  async set(key, value) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.set({ [key]: value }, resolve);
      } catch {
        localStorage.setItem(key, JSON.stringify(value));
        resolve();
      }
    });
  },
  async remove(key) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.remove(key, resolve);
      } catch {
        localStorage.removeItem(key);
        resolve();
      }
    });
  },
};

/* ===== Utilitários DOM ===== */

const $ = (id) => document.getElementById(id);

function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

function setIcon(node, name) {
  node.innerHTML = icons[name] ?? "";
}

function svgIcon(name, className = "") {
  const span = document.createElement("span");
  span.className = className;
  span.innerHTML = icons[name] ?? "";
  return span;
}

/* ===== Tema ===== */

function applyTheme() {
  document.documentElement.classList.toggle("dark", state.theme === "dark");
  setIcon($("btn-theme"), state.theme === "dark" ? "sun" : "moon");
}

async function toggleTheme() {
  state.theme = state.theme === "dark" ? "light" : "dark";
  applyTheme();
  await storage.set(STORAGE_THEME, state.theme);
}

/* ===== Telas ===== */

function showConnect() {
  $("connect-screen").classList.remove("hidden");
  $("chat-screen").classList.add("hidden");
}

function showChat() {
  $("connect-screen").classList.add("hidden");
  $("chat-screen").classList.remove("hidden");
  renderHeader();
  renderThread();
}

function renderHeader() {
  const repo = state.repoInfo;
  if (!repo) return;
  const avatar = $("repo-avatar");
  if (repo.avatarUrl) avatar.src = repo.avatarUrl;
  else avatar.removeAttribute("src");
  $("repo-name").textContent = repo.fullName;
  const branch = state.creds.branch || repo.defaultBranch;
  $("repo-sub").textContent = `${branch} · ${repo.private ? "privado" : "público"} · agnes-2.5-flash`;
  $("btn-github").href = repo.url;
}

/* ===== Thread ===== */

function renderThread() {
  const thread = $("thread");
  thread.innerHTML = "";

  if (state.messages.length === 0) {
    const empty = el("div", "empty-state");
    empty.appendChild(el("h2", null, "O que vamos mudar no projeto?"));
    empty.appendChild(
      el(
        "p",
        null,
        "O agente inspeciona a estrutura, aplica a alteração no ponto exato do código e faz commit + push automaticamente.",
      ),
    );
    const grid = el("div", "suggestions");
    for (const suggestion of SUGGESTIONS) {
      const btn = el("button", "suggestion");
      btn.type = "button";
      btn.textContent = suggestion;
      btn.addEventListener("click", () => {
        $("composer-input").value = suggestion;
        $("composer-input").focus();
        updateSendState();
      });
      grid.appendChild(btn);
    }
    empty.appendChild(grid);
    thread.appendChild(empty);
    return;
  }

  for (const message of state.messages) {
    thread.appendChild(renderMessage(message));
  }
  scrollToBottom();
}

function renderMessage(message) {
  if (message.role === "user") {
    const wrap = el("div", "msg-user");
    const inner = el("div", "msg-user-inner");
    inner.appendChild(el("div", "user-bubble", esc2(message.content)));
    if (message.attachments?.length) {
      const chips = el("div", "user-attachments");
      for (const a of message.attachments) {
        chips.appendChild(
          el(
            "span",
            "badge",
            `${svgIcon(a.isImage ? "image" : "file-code").outerHTML}${escapeHtml(a.name)}`,
          ),
        );
      }
      inner.appendChild(chips);
    }
    wrap.appendChild(inner);
    return wrap;
  }
  return renderAgentMessage(message);
}

function esc2(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function escapeHtml(text) {
  return esc2(text);
}

function renderAgentMessage(message) {
  const root = el("div", "msg-agent");
  root.dataset.id = message.id;

  if (message.steps?.length) {
    const stepsBox = el("div", "steps");
    stepsBox.appendChild(
      el(
        "p",
        "steps-label",
        `${svgIcon("terminal").outerHTML}Ações no repositório`,
      ),
    );
    for (const step of message.steps) {
      stepsBox.appendChild(renderStep(step));
    }
    root.appendChild(stepsBox);
  }

  root.appendChild(renderAgentCard(message));

  if (message.commit) {
    root.appendChild(renderCommitPill(message.commit));
  }
  return root;
}

function renderStep(step) {
  return el(
    "p",
    "step-row",
    `${svgIcon(step.ok ? "check-circle" : "x-circle", step.ok ? "step-ok" : "step-fail").outerHTML}<span class="step-detail">${escapeHtml(step.detail)}</span>`,
  );
}

function renderAgentCard(message) {
  const card = el("div", "agent-card");

  const head = el("div", "agent-card-head");
  head.appendChild(svgIcon("sparkles"));
  head.appendChild(
    el(
      "p",
      "agent-card-label",
      message.error ? "Falha na solicitação" : message.streaming ? "Gerando resposta..." : "Resposta do agente",
    ),
  );
  if (message.streaming) {
    const spin = svgIcon("loader", "agent-card-spin");
    head.appendChild(spin);
  }
  card.appendChild(head);

  const body = el("div", "agent-card-body");
  if (message.error) {
    body.appendChild(el("p", "agent-error", escapeHtml(message.content)));
  } else {
    const md = el("div", "md");
    md.innerHTML = renderMarkdownHtml(message.content);
    body.appendChild(md);
  }
  if (message.streaming) {
    body.appendChild(el("span", "cursor"));
  }
  card.appendChild(body);
  return card;
}

function renderCommitPill(commit) {
  const a = el("a", "commit-pill");
  a.href = commit.url;
  a.target = "_blank";
  a.rel = "noreferrer";
  a.innerHTML =
    `${svgIcon("commit").outerHTML}` +
    `<span class="sha">${escapeHtml(commit.sha.slice(0, 7))}</span>` +
    `<span class="meta">${escapeHtml(`${commit.files.length} arquivo(s) enviados para ${commit.branch}`)}</span>`;
  return a;
}

function findMessageNode(id) {
  return $("thread").querySelector(`.msg-agent[data-id="${id}"]`);
}

function scrollToBottom() {
  const scroller = $("thread-scroll");
  scroller.scrollTop = scroller.scrollHeight;
}

/* ===== Fluxo de envio (espelho de handleSend em index.tsx) ===== */

function ensureAssistant(id) {
  if (state.messages.some((m) => m.id === id)) return;
  state.messages.push({
    id,
    role: "assistant",
    content: "",
    steps: [],
    streaming: true,
  });
  state.streamActive = true;
  updateSendingRow();
  const thread = $("thread");
  thread.querySelector(".empty-state")?.remove();
  const node = renderAgentMessage(state.messages.at(-1));
  thread.appendChild(node);
  scrollToBottom();
}

function patchAssistant(id, mutator) {
  const index = state.messages.findIndex((m) => m.id === id);
  if (index === -1) return;
  const updated = mutator({ ...state.messages[index] });
  state.messages[index] = updated;

  const node = findMessageNode(id);
  if (!node) return;
  node.innerHTML = "";
  const rebuilt = renderAgentMessage(updated);
  while (rebuilt.firstChild) node.appendChild(rebuilt.firstChild);
  scrollToBottom();
}

function updateSendState() {
  const hasText = $("composer-input").value.trim().length > 0;
  $("btn-send").disabled = state.sending || !hasText;
  $("btn-attach").disabled = state.sending;
}

let elapsedTimer = null;
let elapsedSeconds = 0;

function updateSendingRow() {
  const existing = document.querySelector(".sending-row");
  const shouldShow = state.sending && !state.streamActive;
  if (shouldShow && !existing) {
    const row = el("div", "sending-row");
    row.appendChild(svgIcon("loader"));
    const label = el("span");
    label.innerHTML = `Agente trabalhando no repositório...<span class="elapsed"></span>`;
    row.appendChild(label);
    $("thread").appendChild(row);
    scrollToBottom();
    elapsedSeconds = 0;
    elapsedTimer = setInterval(() => {
      elapsedSeconds += 1;
      const target = document.querySelector(".sending-row .elapsed");
      if (target) target.textContent = `${elapsedSeconds}s`;
    }, 1_000);
  } else if (!shouldShow && existing) {
    clearInterval(elapsedTimer);
    elapsedTimer = null;
    existing.remove();
  }
}

async function handleSend(text, attachments) {
  const creds = state.creds;
  if (!creds) return;

  const history = state.messages
    .filter((m) => !m.error)
    .map((m) => ({ role: m.role, content: m.content }));

  const userMessage = {
    id: crypto.randomUUID(),
    role: "user",
    content: text,
    attachments: attachments.map((a) => ({ name: a.name, isImage: a.isImage })),
  };
  state.messages.push(userMessage);
  renderThread();

  state.sending = true;
  state.streamActive = false;
  updateSendState();
  updateSendingRow();

  const assistantId = crypto.randomUUID();
  let created = false;
  let commitInfo = null;

  try {
    await runAgentStream(
      {
        repo: {
          owner: creds.owner,
          repo: creds.repo,
          branch: creds.branch,
          token: creds.token,
        },
        apiKey: creds.agnesKey,
        history,
        message: text,
        attachments,
      },
      (type, data) => {
        if (type === "delta" && data.text) {
          if (!created) ensureAssistant(assistantId);
          patchAssistant(assistantId, (m) => ({ ...m, content: m.content + data.text }));
        } else if (type === "step") {
          if (!created) ensureAssistant(assistantId);
          patchAssistant(assistantId, (m) => ({
            ...m,
            steps: [...(m.steps ?? []), { tool: data.tool, detail: data.detail, ok: data.ok }],
          }));
        } else if (type === "commit") {
          if (!created) ensureAssistant(assistantId);
          commitInfo = data;
          patchAssistant(assistantId, (m) => ({ ...m, commit: data }));
        } else if (type === "done") {
          if (!created) ensureAssistant(assistantId);
          patchAssistant(assistantId, (m) => ({
            ...m,
            streaming: false,
            content: m.content || data.reply || "Alterações aplicadas.",
          }));
        } else if (type === "error") {
          if (!created) ensureAssistant(assistantId);
          const detail = data.message ?? "Erro inesperado.";
          patchAssistant(assistantId, (m) => ({
            ...m,
            streaming: false,
            error: true,
            content: m.content ? `${m.content}\n\n${detail}` : detail,
          }));
        }
      },
      new AbortController().signal,
    );

    if (!created) {
      throw new Error("O agente não retornou resposta.");
    }
    patchAssistant(assistantId, (m) => ({ ...m, streaming: false }));
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Erro inesperado.";
    if (created) {
      patchAssistant(assistantId, (m) => ({
        ...m,
        streaming: false,
        error: true,
        content: m.content ? `${m.content}\n\n${detail}` : detail,
      }));
    } else {
      state.messages.push({ id: assistantId, role: "assistant", content: detail, error: true });
      renderThread();
    }
  } finally {
    state.sending = false;
    state.streamActive = false;
    updateSendState();
    updateSendingRow();
  }
}

/* ===== Anexos (espelho de addFiles em chat-view.tsx) ===== */

async function addFiles(files) {
  if (!files?.length) return;
  const next = [];
  for (const file of Array.from(files).slice(0, 6)) {
    const buffer = await file.arrayBuffer();
    let binary = "";
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    const dataBase64 = btoa(binary);
    const isImage = file.type.startsWith("image/");
    const isText =
      !isImage &&
      (file.type.startsWith("text/") ||
        /\.(txt|md|json|ts|tsx|js|jsx|css|scss|html|yml|yaml|py|java|rb|go|rs|php|sql|env|sh|toml|xml|csv)$/i.test(
          file.name,
        ));
    next.push({
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      isImage,
      dataBase64,
      ...(isText ? { text: new TextDecoder().decode(bytes) } : {}),
    });
  }
  state.attachments = [...state.attachments, ...next].slice(0, 6);
  renderAttachmentChips();
}

function renderAttachmentChips() {
  const wrap = $("attachment-chips");
  wrap.innerHTML = "";
  if (state.attachments.length === 0) {
    wrap.classList.add("hidden");
    return;
  }
  wrap.classList.remove("hidden");
  state.attachments.forEach((a, index) => {
    const chip = el(
      "span",
      "chip",
      `${svgIcon(a.isImage ? "image" : "file-code").outerHTML}<span class="chip-name">${escapeHtml(a.name)}</span>`,
    );
    const remove = document.createElement("button");
    remove.type = "button";
    remove.setAttribute("aria-label", `Remover ${a.name}`);
    remove.appendChild(svgIcon("x"));
    remove.addEventListener("click", () => {
      state.attachments.splice(index, 1);
      renderAttachmentChips();
    });
    chip.appendChild(remove);
    wrap.appendChild(chip);
  });
}

/* ===== Conexão ===== */

function parseRepoUrl(raw) {
  return raw
    .trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//i, "")
    .replace(/\.git$/i, "")
    .replace(/^\/+|\/+$/g, "");
}

async function handleConnect(event) {
  event.preventDefault();
  const errorEl = $("connect-error");
  errorEl.classList.add("hidden");

  const token = $("f-token").value.trim();
  const agnesKey = $("f-agnes").value.trim();
  const [owner, repo] = parseRepoUrl($("f-repo").value).split("/");
  const branch = $("f-branch").value.trim();

  if (!token) return showConnectError("Informe o token de acesso do GitHub.");
  if (!agnesKey) return showConnectError("Informe a chave da API Agnes.");
  if (!owner || !repo) return showConnectError("Informe o repositório no formato dono/projeto.");

  const creds = { token, owner, repo, agnesKey, ...(branch ? { branch } : {}) };

  const button = $("connect-btn");
  button.disabled = true;
  button.innerHTML = `${svgIcon("loader", "icon-sm spin").outerHTML} Conectando...`;
  try {
    const info = await getRepoInfo(creds);
    state.creds = creds;
    state.repoInfo = info;
    state.messages = [];
    await storage.set(STORAGE_CONNECTION, { creds, repo: info });
    showChat();
  } catch (error) {
    showConnectError(
      error instanceof Error
        ? `Falha ao conectar: ${error.message}`
        : "Falha ao conectar ao repositório.",
    );
  } finally {
    button.disabled = false;
    button.innerHTML = `${svgIcon("lock", "icon-sm").outerHTML} Conectar projeto`;
  }
}

function showConnectError(message) {
  const errorEl = $("connect-error");
  errorEl.textContent = message;
  errorEl.classList.remove("hidden");
}

async function handleDisconnect() {
  await storage.remove(STORAGE_CONNECTION);
  state.creds = null;
  state.repoInfo = null;
  state.messages = [];
  state.attachments = [];
  renderAttachmentChips();
  showConnect();
}

/* ===== Boot ===== */

async function boot() {
  hydrateIcons();
  setIcon($("btn-clear"), "trash");
  setIcon($("btn-attach"), "paperclip");
  setIcon($("btn-github"), "external-link");
  setIcon($("btn-open-tab"), "open-tab");
  applyTheme();

  const params = new URLSearchParams(location.search);
  if (params.get("mode") === "tab") {
    document.body.className = "mode-tab";
    $("btn-open-tab").classList.add("hidden");
    document.title = "Agnes Code Agent";
  } else {
    document.body.className = "mode-popup";
  }

  // Restaura conexão salva
  const saved = await storage.get(STORAGE_CONNECTION);
  if (saved?.creds && saved?.repo) {
    state.creds = saved.creds;
    state.repoInfo = saved.repo;
    showChat();
  } else {
    showConnect();
  }

  // Eventos de conexão
  $("connect-form").addEventListener("submit", handleConnect);

  // Eventos da topbar
  $("btn-theme").addEventListener("click", () => void toggleTheme());
  $("btn-disconnect").addEventListener("click", handleDisconnect);
  $("btn-clear").addEventListener("click", () => {
    state.messages = [];
    renderThread();
  });

  // Composer
  const input = $("composer-input");
  const sendBtn = $("btn-send");
  const fileInput = $("file-input");

  $("btn-attach").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    await addFiles(fileInput.files);
    fileInput.value = "";
  });

  input.addEventListener("input", () => {
    updateSendState();
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitComposer();
    }
  });
  sendBtn.addEventListener("click", submitComposer);

  function submitComposer() {
    const text = input.value.trim();
    if (!text || state.sending) return;
    const attachments = state.attachments;
    state.attachments = [];
    renderAttachmentChips();
    input.value = "";
    input.style.height = "auto";
    updateSendState();
    void handleSend(text, attachments);
  }

  updateSendState();
}

boot();