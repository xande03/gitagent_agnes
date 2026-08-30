import { useState } from "react";
import { Chrome, Download, GitBranch, KeyRound, Loader2, Lock, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function downloadExtension() {
  fetch("/agnes-code-agent-extension.zip")
    .then((res) => {
      if (!res.ok) throw new Error(`Falha no download: ${res.status}`);
      return res.blob();
    })
    .then((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "agnes-code-agent-extension.zip";
      a.click();
      URL.revokeObjectURL(a.href);
    })
    .catch((err: unknown) => alert(err instanceof Error ? err.message : String(err)));
}

export type Credentials = {
  token: string;
  owner: string;
  repo: string;
  branch?: string;
};

export function ConnectPanel({
  onConnect,
  pending,
}: {
  onConnect: (creds: Credentials) => void;
  pending: boolean;
}) {
  const [token, setToken] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const cleaned = repoUrl
      .trim()
      .replace(/^https?:\/\/(www\.)?github\.com\//i, "")
      .replace(/\.git$/i, "")
      .replace(/^\/+|\/+$/g, "");
    const [owner, repo] = cleaned.split("/");
    if (!token.trim()) return setError("Informe o token de acesso do GitHub.");
    if (!owner || !repo) return setError("Informe o repositório no formato dono/projeto.");
    onConnect({
      token: token.trim(),
      owner,
      repo,
      ...(branch.trim() ? { branch: branch.trim() } : {}),
    });
  }

  return (
    <div className="bg-grid flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-xl">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-[var(--shadow-glow)]">
            <GitBranch className="h-7 w-7" />
          </div>
          <h1 className="text-3xl font-bold sm:text-4xl">Agnes Code Agent</h1>
          <p className="mt-3 text-sm text-muted-foreground sm:text-base">
            Conecte suas credenciais para liberar o chat com o agente que analisa, edita e faz
            commit + push automático no seu projeto do GitHub.
          </p>
        </div>

        <form onSubmit={submit} className="panel space-y-5 rounded-3xl p-6 sm:p-8">
          <div className="space-y-2">
            <Label htmlFor="token" className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-primary" /> Token de acesso do GitHub
            </Label>
            <Input
              id="token"
              type="password"
              autoComplete="off"
              placeholder="ghp_..."
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Fine-grained token ou classic com permissão de leitura e escrita de conteúdo.
            </p>
          </div>

          <div className="grid gap-5 sm:grid-cols-[1.6fr_1fr]">
            <div className="space-y-2">
              <Label htmlFor="repo">Repositório</Label>
              <Input
                id="repo"
                placeholder="dono/projeto"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                className="font-mono"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="branch">Branch (opcional)</Label>
              <Input
                id="branch"
                placeholder="main"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                className="font-mono"
              />
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-muted/50 p-4 text-xs text-muted-foreground">
            <p className="flex items-center gap-2 font-medium text-foreground">
              <ShieldCheck className="h-4 w-4 text-primary" /> Chave da API Agnes já configurada
            </p>
            <p className="mt-1">
              O modelo <span className="font-mono">agnes-2.5-flash</span> roda no servidor. Suas
              credenciais do GitHub ficam apenas neste dispositivo.
            </p>
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <Button type="submit" size="lg" className="w-full" disabled={pending}>
            {pending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Conectando...
              </>
            ) : (
              <>
                <Lock className="h-4 w-4" /> Conectar projeto
              </>
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}
