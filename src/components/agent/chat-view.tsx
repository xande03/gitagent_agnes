import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowUp,
  CheckCircle2,
  ExternalLink,
  FileCode2,
  GitCommitHorizontal,
  ImageIcon,
  Loader2,
  LogOut,
  Moon,
  Paperclip,
  Sparkles,
  Sun,
  Terminal,
  Trash2,
  X,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

export type AttachmentUsage = "reference" | "add";

export type Attachment = {
  name: string;
  mimeType: string;
  isImage: boolean;
  dataBase64: string;
  text?: string;
  usage: AttachmentUsage;
};


export type AgentStep = { tool: string; detail: string; ok: boolean };

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  steps?: AgentStep[];
  commit?: { sha: string; url: string; files: string[]; branch: string };
  attachments?: { name: string; isImage: boolean }[];
  error?: boolean;
  streaming?: boolean;
};

export type RepoInfo = {
  fullName: string;
  defaultBranch: string;
  private: boolean;
  url: string;
  description: string | null;
  avatarUrl: string;
};

const SUGGESTIONS = [
  "Analise a estrutura do projeto e resuma a arquitetura",
  "Corrija erros de tipagem no arquivo principal",
  "Adicione um componente de rodapé responsivo",
  "Crie um README completo para este projeto",
];

type MdBlock =
  | { type: "code"; lang: string; content: string }
  | { type: "heading"; level: number; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "paragraph"; text: string };

function parseMarkdown(source: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  const lines = source.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const fence = line.match(/^```(\w*)/);
    if (fence) {
      const lang = fence[1] ?? "";
      const content: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i]!)) {
        content.push(lines[i]!);
        i += 1;
      }
      i += 1;
      blocks.push({ type: "code", lang, content: content.join("\n") });
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1]!.length, text: heading[2]! });
      i += 1;
      continue;
    }
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || ordered) {
      const items: string[] = [];
      const isOrdered = Boolean(ordered);
      while (i < lines.length) {
        const item =
          lines[i]!.match(/^\s*[-*•]\s+(.*)$/) ?? lines[i]!.match(/^\s*\d+[.)]\s+(.*)$/);
        if (!item) break;
        items.push(item[1]!);
        i += 1;
      }
      blocks.push({ type: "list", ordered: isOrdered, items });
      continue;
    }
    if (line.trim() === "") {
      i += 1;
      continue;
    }
    const paragraph: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() !== "" &&
      !/^```/.test(lines[i]!) &&
      !/^#{1,4}\s+/.test(lines[i]!) &&
      !/^\s*[-*•]\s+/.test(lines[i]!) &&
      !/^\s*\d+[.)]\s+/.test(lines[i]!)
    ) {
      paragraph.push(lines[i]!);
      i += 1;
    }
    blocks.push({ type: "paragraph", text: paragraph.join("\n") });
  }
  return blocks;
}

function renderInline(text: string): ReactNode[] {
  return text
    .split(/(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`)/g)
    .filter(Boolean)
    .map((part, index) => {
      if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
        return <strong key={index} className="font-semibold">{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
        return <em key={index}>{part.slice(1, -1)}</em>;
      }
      if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
        return (
          <code
            key={index}
            className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[0.85em]"
          >
            {part.slice(1, -1)}
          </code>
        );
      }
      return <span key={index}>{part}</span>;
    });
}

function MarkdownContent({ content }: { content: string }) {
  const blocks = useMemo(() => parseMarkdown(content), [content]);

  return (
    <div className="space-y-3.5">
      {blocks.map((block, index) => {
        if (block.type === "code") {
          return (
            <div
              key={index}
              className="overflow-hidden rounded-xl border border-border bg-muted/60"
            >
              {block.lang ? (
                <p className="border-b border-border bg-muted/70 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                  {block.lang}
                </p>
              ) : null}
              <pre className="overflow-x-auto p-3 font-mono text-[13px] leading-6">
                <code>{block.content}</code>
              </pre>
            </div>
          );
        }
        if (block.type === "heading") {
          const sizeClass =
            block.level <= 1
              ? "text-lg sm:text-xl"
              : block.level === 2
                ? "text-base sm:text-lg"
                : "text-[15px] sm:text-base";
          return (
            <p
              key={index}
              className={`font-display ${sizeClass} font-semibold tracking-tight text-foreground`}
            >
              {renderInline(block.text)}
            </p>
          );
        }
        if (block.type === "list") {
          const ListTag = block.ordered ? "ol" : "ul";
          return (
            <ListTag
              key={index}
              className={`ml-5 space-y-1.5 text-[15px] leading-7 sm:text-base ${block.ordered ? "list-decimal" : "list-disc"} marker:text-primary`}
            >
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex} className="pl-1">
                  {renderInline(item)}
                </li>
              ))}
            </ListTag>
          );
        }
        return (
          <p
            key={index}
            className="whitespace-pre-wrap text-[15px] leading-7 text-foreground/95 sm:text-base"
          >
            {renderInline(block.text)}
          </p>
        );
      })}
    </div>
  );
}

export function ChatView({
  repo,
  branch,
  messages,
  onSend,
  onDisconnect,
  onClear,
  sending,
  streaming = false,
  theme,
  onToggleTheme,
}: {
  repo: RepoInfo;
  branch: string;
  messages: ChatMessage[];
  onSend: (text: string, attachments: Attachment[]) => void;
  onDisconnect: () => void;
  onClear: () => void;
  sending: boolean;
  streaming?: boolean;
  theme: "light" | "dark";
  onToggleTheme: () => void;
}) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  useEffect(() => {
    if (!sending) {
      setElapsed(0);
      return;
    }
    const timer = setInterval(() => setElapsed((seconds) => seconds + 1), 1_000);
    return () => clearInterval(timer);
  }, [sending]);

  async function addFiles(files: ArrayLike<File> | null) {
    if (!files) return;
    const next: Attachment[] = [];
    for (const file of Array.from(files).slice(0, 6)) {
      const buffer = await file.arrayBuffer();
      let binary = "";
      const bytes = new Uint8Array(buffer);
      for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!);
      const dataBase64 = btoa(binary);
      const isImage = file.type.startsWith("image/");
      const isText =
        !isImage &&
        (file.type.startsWith("text/") ||
          /\.(txt|md|json|ts|tsx|js|jsx|css|scss|html|yml|yaml|py|java|rb|go|rs|php|sql|env|sh|toml|xml|csv)$/i.test(
            file.name,
          ));
      next.push({
        name: file.name || `colado-${Date.now()}.${(file.type.split("/")[1] ?? "bin")}`,
        mimeType: file.type || "application/octet-stream",
        isImage,
        dataBase64,
        usage: isImage ? "reference" : "add",
        ...(isText ? { text: new TextDecoder().decode(bytes) } : {}),
      });
    }
    setAttachments((prev) => [...prev, ...next].slice(0, 6));
    if (fileRef.current) fileRef.current.value = "";
  }

  function handlePaste(event: React.ClipboardEvent) {
    const items = Array.from(event.clipboardData?.items ?? []);
    const files = items
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    if (!files.length) return;
    event.preventDefault();
    void addFiles(files);
  }

  function toggleUsage(index: number) {
    setAttachments((prev) =>
      prev.map((a, i) =>
        i === index ? { ...a, usage: a.usage === "reference" ? "add" : "reference" } : a,
      ),
    );
  }


  function submit() {
    if (!text.trim() || sending) return;
    onSend(text.trim(), attachments);
    setText("");
    setAttachments([]);
  }

  const empty = useMemo(() => messages.length === 0, [messages.length]);

  return (
    <div className="flex h-dvh flex-col bg-background">
      <header className="sticky top-0 z-20 border-b border-border bg-surface/80 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-3 px-3 py-3 sm:px-6">
          <img
            src={repo.avatarUrl}
            alt={`Avatar de ${repo.fullName}`}
            className="h-10 w-10 rounded-xl border border-border"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate font-display text-sm font-semibold sm:text-base">
                {repo.fullName}
              </p>
              <span className="hidden h-2 w-2 shrink-0 rounded-full bg-success sm:inline-block" />
            </div>
            <p className="truncate text-xs text-muted-foreground">
              <span className="font-mono">{branch}</span>
              {repo.private ? " · privado" : " · público"} · agnes-2.5-flash
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={onToggleTheme} aria-label="Alternar tema">
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="icon" asChild aria-label="Abrir no GitHub">
              <a href={repo.url} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClear}
              aria-label="Limpar conversa"
              className="hidden sm:inline-flex"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
            <Button variant="destructive" size="sm" onClick={onDisconnect} className="gap-2">
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Desconectar</span>
            </Button>
          </div>
        </div>
      </header>

      <ScrollArea className="flex-1">
        <div className="mx-auto w-full max-w-3xl px-3 py-6 sm:px-6 sm:py-10">
          {empty ? (
            <div className="text-center">
              <h2 className="text-2xl font-bold sm:text-3xl">O que vamos mudar no projeto?</h2>
              <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
                O agente inspeciona a estrutura, aplica a alteração no ponto exato do código e faz
                commit + push automaticamente.
              </p>
              <div className="mt-8 grid gap-3 sm:grid-cols-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setText(s)}
                    className="rounded-2xl border border-border bg-card p-4 text-left text-sm transition-colors hover:border-primary hover:bg-accent"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-8">
              {messages.map((message) => (
                <MessageRow key={message.id} message={message} />
              ))}
            </div>
          )}
          {sending && !streaming ? (
            <div className="mt-8 flex items-center gap-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span>
                Agente trabalhando no repositório...
                {elapsed > 0 ? <span className="ml-1.5 font-mono text-xs">{elapsed}s</span> : null}
              </span>
            </div>
          ) : null}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      <div className="border-t border-border bg-surface/80 backdrop-blur-xl">
        <div className="mx-auto w-full max-w-3xl px-3 py-3 sm:px-6 sm:py-4">
          {attachments.length ? (
            <div className="mb-3 flex flex-wrap gap-2">
              {attachments.map((a, index) => (
                <span
                  key={`${a.name}-${index}`}
                  className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs"
                >
                  {a.isImage ? (
                    <ImageIcon className="h-3.5 w-3.5 text-primary" />
                  ) : (
                    <FileCode2 className="h-3.5 w-3.5 text-primary" />
                  )}
                  <span className="max-w-[160px] truncate">{a.name}</span>
                  <button
                    type="button"
                    onClick={() => toggleUsage(index)}
                    title="Alternar entre usar como referência ou adicionar ao projeto"
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors ${
                      a.usage === "reference"
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-success/40 bg-success/10 text-success"
                    }`}
                  >
                    {a.usage === "reference" ? "referência" : "adicionar ao projeto"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== index))}
                    aria-label={`Remover ${a.name}`}
                  >
                    <X className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          <div
            className="flex items-end gap-2 rounded-3xl border border-border bg-card p-2 shadow-[var(--shadow-panel)] focus-within:border-primary"
            onPaste={handlePaste}
          >
            <input
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => void addFiles(e.target.files)}
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => fileRef.current?.click()}
              aria-label="Anexar arquivos e imagens"
            >
              <Paperclip className="h-4 w-4" />
            </Button>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onPaste={handlePaste}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              rows={1}
              placeholder="Descreva a mudança e cole (Ctrl+V) imagens ou arquivos..."
              className="max-h-40 min-h-11 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
            />

              className="max-h-40 min-h-11 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
            />
            <Button
              size="icon"
              onClick={submit}
              disabled={sending || !text.trim()}
              aria-label="Enviar"
              className="shrink-0 rounded-2xl"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
            </Button>
          </div>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            O agente executa e publica as mudanças sem pedir confirmação.
          </p>
        </div>
      </div>
    </div>
  );
}

function MessageRow({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] space-y-2">
          <div className="rounded-3xl rounded-br-lg bg-primary px-4 py-3 text-sm whitespace-pre-wrap text-primary-foreground">
            {message.content}
          </div>
          {message.attachments?.length ? (
            <div className="flex flex-wrap justify-end gap-2">
              {message.attachments.map((a) => (
                <Badge key={a.name} variant="secondary" className="gap-1 font-normal">
                  {a.isImage ? <ImageIcon className="h-3 w-3" /> : <FileCode2 className="h-3 w-3" />}
                  {a.name}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {message.steps?.length ? (
        <div className="space-y-2 rounded-2xl border border-border bg-muted/40 p-3.5">
          <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Terminal className="h-3.5 w-3.5" /> Ações no repositório
          </p>
          {message.steps.map((step, index) => (
            <p key={index} className="flex items-start gap-2 font-mono text-[13px] leading-6">
              {step.ok ? (
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
              ) : (
                <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
              )}
              <span className="break-all">{step.detail}</span>
            </p>
          ))}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--shadow-panel)]">
        <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <span className="font-display text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {message.error
              ? "Falha na solicitação"
              : message.streaming
                ? "Gerando resposta..."
                : "Resposta do agente"}
          </span>
          {message.streaming ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          ) : null}
        </div>
        <div className="px-4 py-4 sm:px-5 sm:py-5">
          {message.error ? (
            <p className="whitespace-pre-wrap text-[15px] leading-7 text-destructive sm:text-base">
              {message.content}
            </p>
          ) : (
            <MarkdownContent content={message.content} />
          )}
          {message.streaming ? (
            <span
              aria-hidden
              className="mt-1 inline-block h-4 w-2 animate-pulse rounded-[2px] bg-primary align-middle"
            />
          ) : null}
        </div>
      </div>

      {message.commit ? (
        <a
          href={message.commit.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-2 text-[13px] transition-colors hover:border-primary"
        >
          <GitCommitHorizontal className="h-4 w-4 text-primary" />
          <span className="font-mono">{message.commit.sha.slice(0, 7)}</span>
          <span className="text-muted-foreground">
            {message.commit.files.length} arquivo(s) enviados para {message.commit.branch}
          </span>
        </a>
      ) : null}
    </div>
  );
}
