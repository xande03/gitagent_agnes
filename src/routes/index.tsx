import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { ConnectPanel, type Credentials } from "@/components/agent/connect-panel";
import {
  ChatView,
  type Attachment,
  type ChatMessage,
  type RepoInfo,
} from "@/components/agent/chat-view";
import { useTheme } from "@/hooks/use-theme";
import { connectRepo } from "@/lib/agent.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Agnes Code Agent — Edite projetos do GitHub por chat" },
      {
        name: "description",
        content:
          "Agente de IA que analisa seu repositório GitHub, aplica correções e novos componentes no ponto exato do código e faz commit com push automático.",
      },
      { property: "og:title", content: "Agnes Code Agent — Edite projetos do GitHub por chat" },
      {
        property: "og:description",
        content:
          "Conecte seu token do GitHub e converse com o agente agnes-2.5-flash para modificar o projeto com commit e push automáticos.",
      },
    ],
  }),
  component: Index,
});

const STORAGE_KEY = "agnes-connection";

function Index() {
  const { theme, toggle } = useTheme();
  const [creds, setCreds] = useState<Credentials | null>(null);
  const [repo, setRepo] = useState<RepoInfo | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [sending, setSending] = useState(false);
  const [streamActive, setStreamActive] = useState(false);

  const connect = useServerFn(connectRepo);

  // Persistencia: localStorage no PWA + ponte com a extensao (chrome.storage).
  const embedded = typeof window !== "undefined" && window.parent !== window;

  function persist(connection: { creds: Credentials; repo: RepoInfo } | null) {
    if (connection) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(connection));
    else window.localStorage.removeItem(STORAGE_KEY);
    if (window.parent !== window) {
      window.parent.postMessage(
        connection ? { type: "agnes:persist", connection } : { type: "agnes:clear" },
        "*",
      );
    }
  }

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as { creds: Credentials; repo: RepoInfo };
        setCreds(parsed.creds);
        setRepo(parsed.repo);
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }

    if (!embedded) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as
        | { type?: string; connection?: { creds: Credentials; repo: RepoInfo } | null }
        | null;
      if (!data || data.type !== "agnes:restore" || !data.connection) return;
      setCreds(data.connection.creds);
      setRepo(data.connection.repo);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data.connection));
    };
    window.addEventListener("message", onMessage);
    window.parent.postMessage({ type: "agnes:ready" }, "*");
    return () => window.removeEventListener("message", onMessage);
  }, [embedded]);

  async function handleConnect(next: Credentials) {
    setConnecting(true);
    try {
      const info = await connect({ data: next });
      setCreds(next);
      setRepo(info);
      persist({ creds: next, repo: info });
      toast.success(`Conectado a ${info.fullName}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao conectar ao repositório.");
    } finally {
      setConnecting(false);
    }
  }

  function handleDisconnect() {
    persist(null);
    setCreds(null);
    setRepo(null);
    setMessages([]);
  }


  async function handleSend(text: string, attachments: Attachment[]) {
    if (!creds) return;
    const history = messages
      .filter((m) => !m.error)
      .map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
        attachments: attachments.map((a) => ({ name: a.name, isImage: a.isImage, usage: a.usage })),
      },
    ]);
    setSending(true);
    setStreamActive(false);

    const assistantId = crypto.randomUUID();
    let created = false;
    let commitInfo: ChatMessage["commit"] | undefined;

    // Cria a mensagem do assistente assim que o primeiro evento chega
    const ensureMessage = () => {
      if (created) return;
      created = true;
      setStreamActive(true);
      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: "assistant", content: "", steps: [], streaming: true },
      ]);
    };
    const patch = (fn: (m: ChatMessage) => ChatMessage) =>
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? fn(m) : m)));

    try {
      const res = await fetch("/api/agent-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: creds, message: text, history, attachments }),
      });
      if (!res.ok || !res.body) {
        const detail = await res.text().catch(() => "");
        let message = `Falha na conexão com o agente [${res.status}].`;
        try {
          message = (JSON.parse(detail) as { error?: string }).error ?? message;
        } catch {
          // corpo não-JSON — mantém a mensagem padrão
        }
        throw new Error(message);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finished = false;

      while (!finished) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const json = trimmed.slice(5).trim();
          if (!json || json === "[DONE]") continue;
          let evt: {
            type: string;
            text?: string;
            tool?: string;
            detail?: string;
            ok?: boolean;
            sha?: string;
            url?: string;
            files?: string[];
            branch?: string;
            reply?: string;
            message?: string;
          };
          try {
            evt = JSON.parse(json);
          } catch {
            continue;
          }

          if (evt.type === "delta" && evt.text) {
            ensureMessage();
            patch((m) => ({ ...m, content: m.content + evt.text }));
          } else if (evt.type === "step" && evt.tool) {
            ensureMessage();
            patch((m) => ({
              ...m,
              steps: [
                ...(m.steps ?? []),
                { tool: evt.tool!, detail: evt.detail ?? "", ok: evt.ok ?? true },
              ],
            }));
          } else if (evt.type === "commit" && evt.sha && evt.url) {
            ensureMessage();
            const nextCommit: NonNullable<ChatMessage["commit"]> = {
              sha: evt.sha,
              url: evt.url,
              files: evt.files ?? [],
              branch: evt.branch ?? "",
            };
            commitInfo = nextCommit;
            patch((m) => ({ ...m, commit: nextCommit }));
          } else if (evt.type === "done") {
            finished = true;
            ensureMessage();
            patch((m) => ({
              ...m,
              streaming: false,
              content: m.content || evt.reply || "Alterações aplicadas.",
            }));
          } else if (evt.type === "error") {
            finished = true;
            ensureMessage();
            const detail = evt.message ?? "Erro inesperado.";
            patch((m) => ({
              ...m,
              streaming: false,
              error: true,
              content: m.content ? `${m.content}\n\n${detail}` : detail,
            }));
            toast.error("O agente encontrou um erro.");
          }
        }
      }

      if (!created) throw new Error("O agente não retornou resposta.");
      patch((m) => ({ ...m, streaming: false }));
      if (commitInfo) toast.success(`Commit enviado: ${commitInfo.sha.slice(0, 7)}`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Erro inesperado.";
      if (created) {
        patch((m) => ({
          ...m,
          streaming: false,
          error: true,
          content: m.content ? `${m.content}\n\n${detail}` : detail,
        }));
      } else {
        setMessages((prev) => [
          ...prev,
          { id: assistantId, role: "assistant", content: detail, error: true },
        ]);
      }
      toast.error("O agente encontrou um erro.");
    } finally {
      setSending(false);
      setStreamActive(false);
    }
  }

  if (!creds || !repo) {
    return <ConnectPanel onConnect={handleConnect} pending={connecting} />;
  }

  return (
    <ChatView
      repo={repo}
      branch={creds.branch || repo.defaultBranch}
      messages={messages}
      onSend={handleSend}
      onDisconnect={handleDisconnect}
      onClear={() => setMessages([])}
      sending={sending}
      streaming={streamActive}
      theme={theme}
      onToggleTheme={toggle}
    />
  );
}
