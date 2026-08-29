import { commitChanges, listTree, readFile, type Change, type RepoRef } from "./github.server";

const BASE_URL = "https://apihub.agnes-ai.com/v1";
const MODEL = "agnes-2.5-flash";

export type Attachment = {
  name: string;
  mimeType: string;
  isImage: boolean;
  dataBase64: string;
  text?: string;
};

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type AgentStep = { tool: string; detail: string; ok: boolean };

const tools = [
  {
    type: "function",
    function: {
      name: "list_project_files",
      description:
        "Lista a estrutura completa de arquivos do repositório conectado. Use SEMPRE antes de alterar algo.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "read_project_file",
      description: "Lê o conteúdo de um arquivo do repositório.",
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
        "Grava arquivos no repositório e faz commit + push automático. Envie o conteúdo COMPLETO final de cada arquivo.",
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

Regras obrigatórias:
- NUNCA faça perguntas ao usuário e nunca peça confirmação. Aja imediatamente.
- Primeiro inspecione a estrutura com list_project_files e leia os arquivos relevantes com read_project_file antes de qualquer mudança.
- Aplique a mudança exatamente no local correto do código, preservando o restante do arquivo intacto (envie sempre o conteúdo completo final do arquivo).
- Sempre finalize aplicando commit_and_push com uma mensagem de commit clara e descritiva.
- Se o usuário anexar arquivos/imagens, use-os: analise o conteúdo e, quando fizer sentido, adicione-os ao projeto via commit_and_push usando "attachment:<nome>".
- Responda em português, de forma curta e objetiva, listando o que mudou e o commit gerado.`;
}

export async function runAgent(input: {
  repo: RepoRef;
  history: ChatTurn[];
  message: string;
  attachments: Attachment[];
}) {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) throw new Error("Chave da API Agnes não configurada.");

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

  const steps: AgentStep[] = [];
  let commit: { sha: string; url: string; files: string[]; branch: string } | undefined;

  for (let i = 0; i < 12; i++) {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, messages, tools, tool_choice: "auto" }),
    });
    const raw = await res.text();
    if (!res.ok) throw new Error(`Agnes AI falhou [${res.status}]: ${raw}`);
    const data = JSON.parse(raw) as {
      choices: {
        message: {
          content?: string | null;
          tool_calls?: { id: string; function: { name: string; arguments: string } }[];
        };
      }[];
    };
    const msg = data.choices?.[0]?.message;
    if (!msg) throw new Error("Resposta inválida da Agnes AI.");
    messages.push(msg as unknown as Record<string, unknown>);

    const calls = msg.tool_calls ?? [];
    if (calls.length === 0) {
      return { reply: msg.content ?? "", steps, commit, branch, repoLabel };
    }

    for (const call of calls) {
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
              const att = input.attachments.find((a) => a.name === name);
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
      steps.push({ tool: call.function.name, detail, ok });
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result).slice(0, 100_000),
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
