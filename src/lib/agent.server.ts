import { commitChanges, listTree, readFile, type Change, type RepoRef } from "./github.server";

const BASE_URL = "https://apihub.agnes-ai.com/v1";
const MODEL = "agnes-2.5-flash";
const AGNES_TIMEOUT_MS = 180_000;
const MAX_API_ATTEMPTS = 3;
const MAX_ROUNDS = 12;

export type Attachment = {
  name: string;
  mimeType: string;
  isImage: boolean;
  dataBase64: string;
  text?: string | undefined;
};

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type AgentStep = { tool: string; detail: string; ok: boolean };

export type CommitInfo = { sha: string; url: string; files: string[]; branch: string };

export type AgentStreamEmit = (type: string, data: Record<string, unknown>) => void;

type AgnesMessage = {
  content?: string | null;
  tool_calls?: { id: string; type?: string; function: { name: string; arguments: string } }[];
};

type AgnesToolCall = NonNullable<AgnesMessage["tool_calls"]>[number];

type AgnesStreamChunk = {
  choices?: {
    delta?: {
      content?: string | null;
      tool_calls?: {
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }[];
    };
  }[];
};

type ToolOutcome = { call: AgnesToolCall; result: unknown; ok: boolean; detail: string };

/** Erro definitivo da API (4xx exceto 429) — não vale a pena tentar novamente. */
class ApiFatalError extends Error {}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function agnesChat(apiKey: string, payload: Record<string, unknown>): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_API_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${BASE_URL}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(AGNES_TIMEOUT_MS),
      });
      if (res.ok) return res;
      const raw = await res.text();
      const message = `Agnes AI falhou [${res.status}]: ${raw.slice(0, 500)}`;
      // 429 e 5xx são transitórios (rate limit/instabilidade do provedor) → retry com backoff
      if (res.status !== 429 && res.status < 500) throw new ApiFatalError(message);
      lastError = new Error(message);
    } catch (error) {
      if (error instanceof ApiFatalError) throw error;
      lastError = error; // timeout de rede ou instabilidade
    }
    if (attempt < MAX_API_ATTEMPTS) await sleep(1_200 * 2 ** (attempt - 1));
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function requestChat(apiKey: string, payload: Record<string, unknown>): Promise<AgnesMessage> {
  const res = await agnesChat(apiKey, payload);
  const raw = await res.text();
  const data = JSON.parse(raw) as { choices?: { message?: AgnesMessage }[] };
  const msg = data.choices?.[0]?.message;
  if (!msg) throw new Error("Resposta inválida da Agnes AI.");
  return msg;
}

/**
 * Chama a Agnes em modo streaming (SSE), repassa cada fragmento de texto via
 * onDelta e devolve a mensagem agregada (content + tool_calls acumuladas).
 * Retry com backoff enquanto nenhum delta foi emitido; após o primeiro delta
 * não há como recomeçar limpo, então a falha é propagada.
 */
async function agnesChatStream(
  apiKey: string,
  payload: Record<string, unknown>,
  onDelta: (text: string) => void,
  signal: AbortSignal,
): Promise<AgnesMessage> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_API_ATTEMPTS; attempt++) {
    let emitted = false;
    try {
      const res = await fetch(`${BASE_URL}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, stream: true }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(AGNES_TIMEOUT_MS)]),
      });
      if (!res.ok) {
        const raw = await res.text();
        const message = `Agnes AI falhou [${res.status}]: ${raw.slice(0, 500)}`;
        if (res.status !== 429 && res.status < 500) throw new ApiFatalError(message);
        throw new Error(message);
      }
      if (!res.body) throw new Error("Resposta da Agnes AI sem corpo de streaming.");

      const content: string[] = [];
      const toolAccs = new Map<number, { id: string; name: string; arguments: string }>();
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith("data:")) continue;
          const json = line.slice(5).trim();
          if (!json || json === "[DONE]") continue;
          let chunk: AgnesStreamChunk;
          try {
            chunk = JSON.parse(json) as AgnesStreamChunk;
          } catch {
            continue;
          }
          const delta = chunk.choices?.[0]?.delta;
          if (!delta) continue;
          if (delta.content) {
            emitted = true;
            content.push(delta.content);
            onDelta(delta.content);
          }
          for (const tc of delta.tool_calls ?? []) {
            const index = tc.index ?? 0;
            const acc = toolAccs.get(index) ?? { id: "", name: "", arguments: "" };
            if (tc.id) acc.id = tc.id;
            if (tc.function?.name) acc.name += tc.function.name;
            if (tc.function?.arguments) acc.arguments += tc.function.arguments;
            toolAccs.set(index, acc);
          }
        }
      }

      const toolCalls = [...toolAccs.entries()]
        .sort(([a], [b]) => a - b)
        .map(([index, acc], order) => ({
          id: acc.id || `streamed_call_${order}`,
          type: "function",
          function: { name: acc.name, arguments: acc.arguments },
        }));
      if (toolCalls.length && toolCalls.some((tc) => !tc.function.name)) {
        throw new Error("Stream da Agnes AI terminou com tool_call incompleta.");
      }
      return {
        content: content.join("") || null,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      };
    } catch (error) {
      if (error instanceof ApiFatalError) throw error;
      if (emitted) throw error;
      lastError = error;
    }
    if (attempt < MAX_API_ATTEMPTS) await sleep(1_200 * 2 ** (attempt - 1));
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

const tools = [
  {
    type: "function",
    function: {
      name: "list_project_files",
      description:
        "Re-sincroniza a estrutura de arquivos do repositório. A estrutura inicial JÁ é fornecida no contexto do sistema — chame apenas depois de um commit ou se suspeitar que a estrutura mudou.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "read_project_file",
      description:
        "Lê o conteúdo de um arquivo do repositório. Faça todas as leituras necessárias em um único turno, com chamadas paralelas.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "commit_and_push",
      description:
        "Grava arquivos no repositório e faz commit + push automático. Envie o conteúdo COMPLETO final de cada arquivo. Um único commit por tarefa.",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string", description: "Mensagem de commit" },
          changes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                path: { type: "string" },
                content: {
                  type: "string",
                  description:
                    "Conteúdo final completo do arquivo, ou 'attachment:<nome-do-anexo>' para gravar um anexo enviado pelo usuário.",
                },
                encoding: { type: "string", enum: ["utf8", "base64"] },
                delete: { type: "boolean" },
              },
              required: ["path"],
            },
          },
        },
        required: ["message", "changes"],
      },
    },
  },
];

function systemPrompt(repoLabel: string, branch: string) {
  return `Você é um agente de engenharia de software autônomo conectado ao repositório GitHub ${repoLabel} (branch ${branch}).

Eficiência — siga à risca para responder rápido:
- A estrutura completa de arquivos JÁ está no seu contexto. NÃO chame list_project_files no início; use-a apenas para re-sincronizar após um commit.
- Leia os arquivos necessários em LOTE: num único turno, faça de uma vez todas as chamadas read_project_file relevantes. Leia somente o estritamente necessário para a tarefa.
- Minimize rodadas: 1º turno leia tudo que precisa; 2º turno faça o commit e responda.
- Se o alvo for óbvio (arquivo único citado pelo usuário, nome explícito, arquivo pequeno), vá direto ao ponto sem etapas extras.

Regras obrigatórias:
- NUNCA faça perguntas ao usuário e nunca peça confirmação. Aja imediatamente.
- Aplique a mudança exatamente no local correto do código, preservando o restante do arquivo intacto (envie sempre o conteúdo completo final do arquivo).
- Sempre finalize aplicando commit_and_push com uma mensagem de commit clara e descritiva.
- Se o usuário anexar arquivos/imagens, use-os: analise o conteúdo e, quando fizer sentido, adicione-os ao projeto via commit_and_push usando "attachment:<nome>".
- Responda em português, de forma curta e objetiva, listando o que mudou e o commit gerado.`;
}

async function prepareConversation(input: {
  repo: RepoRef;
  history: ChatTurn[];
  message: string;
  attachments: Attachment[];
}) {
  const tree = await listTree(input.repo);
  const repoLabel = `${input.repo.owner}/${input.repo.repo}`;
  const branch = input.repo.branch || tree.branch;
  const ref: RepoRef = { ...input.repo, branch };

  const attachmentNotes = input.attachments.length
    ? `\n\nAnexos enviados pelo usuário:\n${input.attachments
        .map(
          (a) =>
            `- ${a.name} (${a.mimeType})${a.text ? `\nconteúdo:\n\`\`\`\n${a.text.slice(0, 30_000)}\n\`\`\`` : ""}`,
        )
        .join("\n")}`
    : "";

  const userContent: unknown[] = [
    { type: "text", text: `${input.message}${attachmentNotes}` },
    ...input.attachments
      .filter((a) => a.isImage)
      .map((a) => ({
        type: "image_url",
        image_url: { url: `data:${a.mimeType};base64,${a.dataBase64}` },
      })),
  ];

  const messages: Record<string, unknown>[] = [
    { role: "system", content: systemPrompt(repoLabel, branch) },
    {
      role: "system",
      content: `Estrutura atual do projeto (${tree.files.length} arquivos):\n${tree.files
        .slice(0, 800)
        .map((f) => f.path)
        .join("\n")}`,
    },
    ...input.history.slice(-12).map((t) => ({ role: t.role, content: t.content })),
    { role: "user", content: userContent },
  ];

  return { messages, ref, branch, repoLabel };
}

async function executeCalls(
  calls: AgnesToolCall[],
  ref: RepoRef,
  attachments: Attachment[],
): Promise<{ outcomes: ToolOutcome[]; commit: CommitInfo | undefined }> {
  const outcomes: ToolOutcome[] = new Array(calls.length);
  let commit: CommitInfo | undefined;

  const runCall = async (index: number) => {
    const call = calls[index]!;
    let result: unknown;
    let ok = true;
    let detail = call.function.name;
    try {
      const args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      if (call.function.name === "list_project_files") {
        const t = await listTree(ref);
        result = { branch: t.branch, files: t.files.map((f) => f.path) };
        detail = `Estrutura lida (${t.files.length} arquivos)`;
      } else if (call.function.name === "read_project_file") {
        result = await readFile(ref, String(args.path));
        detail = `Leitura: ${args.path}`;
      } else if (call.function.name === "commit_and_push") {
        const changes: Change[] = (args.changes ?? []).map((c: Change) => {
          if (typeof c.content === "string" && c.content.startsWith("attachment:")) {
            const name = c.content.slice("attachment:".length).trim();
            const att = attachments.find((a) => a.name === name);
            if (!att) throw new Error(`Anexo não encontrado: ${name}`);
            return { path: c.path, content: att.dataBase64, encoding: "base64" as const };
          }
          return c;
        });
        const out = await commitChanges(ref, String(args.message), changes);
        commit = { sha: out.sha, url: out.url, files: out.files, branch: out.branch };
        result = out;
        detail = `Commit ${out.sha.slice(0, 7)} — ${out.files.join(", ")}`;
      } else {
        throw new Error("Ferramenta desconhecida");
      }
    } catch (error) {
      ok = false;
      result = { error: error instanceof Error ? error.message : String(error) };
      detail = `${call.function.name} falhou: ${(result as { error: string }).error}`;
    }
    outcomes[index] = { call, result, ok, detail };
  };

  // Leituras/listagens em paralelo (aceleram); commits em série (evita conflito de ref no GitHub)
  const writeIndexes: number[] = [];
  const readIndexes: number[] = [];
  calls.forEach((call, index) =>
    (call.function.name === "commit_and_push" ? writeIndexes : readIndexes).push(index),
  );
  await Promise.all(readIndexes.map((index) => runCall(index)));
  for (const index of writeIndexes) await runCall(index);

  return { outcomes, commit };
}

export async function runAgent(input: {
  repo: RepoRef;
  history: ChatTurn[];
  message: string;
  attachments: Attachment[];
}) {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) throw new Error("Chave da API Agnes não configurada.");

  const { messages, ref, branch, repoLabel } = await prepareConversation(input);

  const steps: AgentStep[] = [];
  let commit: CommitInfo | undefined;
  let parallelToolCalls = true;

  const callModel = async (): Promise<AgnesMessage> => {
    const build = (withParallel: boolean): Record<string, unknown> => {
      const payload: Record<string, unknown> = {
        model: MODEL,
        messages,
        tools,
        tool_choice: "auto",
        temperature: 0.2,
      };
      if (withParallel) payload["parallel_tool_calls"] = true;
      return payload;
    };
    try {
      return await requestChat(apiKey, build(parallelToolCalls));
    } catch (error) {
      // Gateway sem suporte a parallel_tool_calls → refaz sem o parâmetro e desativa para as próximas rodadas
      if (parallelToolCalls && error instanceof Error && error.message.includes("parallel")) {
        parallelToolCalls = false;
        return await requestChat(apiKey, build(false));
      }
      throw error;
    }
  };

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const msg = await callModel();
    messages.push(msg as unknown as Record<string, unknown>);

    const calls = msg.tool_calls ?? [];
    if (calls.length === 0) {
      return { reply: msg.content ?? "", steps, commit, branch, repoLabel };
    }

    const { outcomes, commit: batchCommit } = await executeCalls(calls, ref, input.attachments);
    if (batchCommit) commit = batchCommit;

    for (let i = 0; i < outcomes.length; i++) {
      const outcome = outcomes[i]!;
      steps.push({ tool: outcome.call.function.name, detail: outcome.detail, ok: outcome.ok });
      messages.push({
        role: "tool",
        tool_call_id: outcome.call.id,
        content: JSON.stringify(outcome.result).slice(0, 100_000),
      });
    }
  }

  return {
    reply: "Limite de etapas atingido. Verifique o repositório e envie um novo pedido.",
    steps,
    commit,
    branch,
    repoLabel,
  };
}

/**
 * Versão em streaming do runAgent: repassa ao cliente cada fragmento gerado
 * pelo modelo (delta), as etapas executadas (step), o commit (commit) e o
 * encerramento (done) via callbacks emit.
 */
export async function runAgentStream(
  input: {
    repo: RepoRef;
    history: ChatTurn[];
    message: string;
    attachments: Attachment[];
  },
  emit: AgentStreamEmit,
  signal: AbortSignal,
): Promise<void> {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) throw new Error("Chave da API Agnes não configurada.");

  const { messages, ref, branch, repoLabel } = await prepareConversation(input);

  let parallelToolCalls = true;

  const callModel = async (): Promise<AgnesMessage> => {
    const build = (withParallel: boolean): Record<string, unknown> => {
      const payload: Record<string, unknown> = {
        model: MODEL,
        messages,
        tools,
        tool_choice: "auto",
        temperature: 0.2,
      };
      if (withParallel) payload["parallel_tool_calls"] = true;
      return payload;
    };
    try {
      return await agnesChatStream(
        apiKey,
        build(parallelToolCalls),
        (text) => emit("delta", { text }),
        signal,
      );
    } catch (error) {
      // Gateway sem suporte a parallel_tool_calls → refaz sem o parâmetro e desativa para as próximas rodadas
      if (parallelToolCalls && error instanceof Error && error.message.includes("parallel")) {
        parallelToolCalls = false;
        return await agnesChatStream(
          apiKey,
          build(false),
          (text) => emit("delta", { text }),
          signal,
        );
      }
      throw error;
    }
  };

  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (signal.aborted) throw new Error("Cliente desconectou antes da conclusão.");
    const msg = await callModel();
    messages.push(msg as unknown as Record<string, unknown>);

    const calls = msg.tool_calls ?? [];
    if (calls.length === 0) {
      emit("done", { reply: msg.content ?? "", branch, repoLabel });
      return;
    }

    const { outcomes, commit } = await executeCalls(calls, ref, input.attachments);

    for (let i = 0; i < outcomes.length; i++) {
      const outcome = outcomes[i]!;
      emit("step", { tool: outcome.call.function.name, detail: outcome.detail, ok: outcome.ok });
      messages.push({
        role: "tool",
        tool_call_id: outcome.call.id,
        content: JSON.stringify(outcome.result).slice(0, 100_000),
      });
    }
    if (commit) emit("commit", commit);
  }

  emit("done", {
    reply: "Limite de etapas atingido. Verifique o repositório e envie um novo pedido.",
    branch,
    repoLabel,
  });
}
