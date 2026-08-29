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
import { connectRepo, sendAgentMessage } from "@/lib/agent.functions";

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

  const connect = useServerFn(connectRepo);
  const send = useServerFn(sendAgentMessage);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored) as { creds: Credentials; repo: RepoInfo };
      setCreds(parsed.creds);
      setRepo(parsed.repo);
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  async function handleConnect(next: Credentials) {
    setConnecting(true);
    try {
      const info = await connect({ data: next });
      setCreds(next);
      setRepo(info);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ creds: next, repo: info }));
      toast.success(`Conectado a ${info.fullName}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao conectar ao repositório.");
    } finally {
      setConnecting(false);
    }
  }

  function handleDisconnect() {
    window.localStorage.removeItem(STORAGE_KEY);
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
        attachments: attachments.map((a) => ({ name: a.name, isImage: a.isImage })),
      },
    ]);
    setSending(true);
    try {
      const result = await send({
        data: { repo: creds, message: text, history, attachments },
      });
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: result.reply || "Alterações aplicadas.",
          steps: result.steps,
          ...(result.commit ? { commit: result.commit } : {}),
        },
      ]);
      if (result.commit) toast.success(`Commit enviado: ${result.commit.sha.slice(0, 7)}`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Erro inesperado.";
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "assistant", content: detail, error: true },
      ]);
      toast.error("O agente encontrou um erro.");
    } finally {
      setSending(false);
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
      theme={theme}
      onToggleTheme={toggle}
    />
  );
}
