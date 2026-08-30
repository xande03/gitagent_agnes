const GH = "https://api.github.com";
const GH_TIMEOUT_MS = 30_000;
const GH_ATTEMPTS = 3;
const GH_RETRYABLE = new Set([429, 500, 502, 503, 504]);

/** Erro definitivo do GitHub (404, 401 etc.) — não vale a pena tentar novamente. */
class GitHubFatalError extends Error {}

export type RepoRef = { owner: string; repo: string; branch?: string | undefined; token: string };

async function gh<T>(ref: RepoRef, path: string, init?: RequestInit): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= GH_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${GH}${path}`, {
        ...init,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${ref.token}`,
          "Content-Type": "application/json",
          "User-Agent": "agnes-github-agent",
          ...(init?.headers ?? {}),
        },
        signal: AbortSignal.timeout(GH_TIMEOUT_MS),
      });
      const text = await res.text();
      if (res.ok) return (text ? JSON.parse(text) : {}) as T;
      const message = `GitHub ${init?.method ?? "GET"} ${path} failed [${res.status}]: ${text}`;
      const rateLimited = res.status === 403 && /rate limit|secondary/i.test(text);
      if (!GH_RETRYABLE.has(res.status) && !rateLimited) throw new GitHubFatalError(message);
      lastError = new Error(message);
    } catch (error) {
      if (error instanceof GitHubFatalError) throw error;
      lastError = error; // timeout ou erro retentável
    }
    if (attempt < GH_ATTEMPTS) await new Promise((r) => setTimeout(r, 600 * 2 ** (attempt - 1)));
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function getRepoInfo(ref: RepoRef) {
  const repo = await gh<{
    full_name: string;
    default_branch: string;
    private: boolean;
    html_url: string;
    description: string | null;
    owner: { login: string; avatar_url: string };
  }>(ref, `/repos/${ref.owner}/${ref.repo}`);
  return repo;
}

async function resolveBranch(ref: RepoRef) {
  if (ref.branch) return ref.branch;
  const info = await getRepoInfo(ref);
  return info.default_branch;
}

export async function listTree(ref: RepoRef) {
  const branch = await resolveBranch(ref);
  const data = await gh<{ tree: { path: string; type: string; size?: number }[]; truncated: boolean }>(
    ref,
    `/repos/${ref.owner}/${ref.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
  );
  return {
    branch,
    truncated: data.truncated,
    files: data.tree
      .filter((n) => n.type === "blob")
      .map((n) => ({ path: n.path, size: n.size ?? 0 })),
  };
}

export async function readFile(ref: RepoRef, path: string) {
  const branch = await resolveBranch(ref);
  const data = await gh<{ content?: string; encoding?: string; size: number }>(
    ref,
    `/repos/${ref.owner}/${ref.repo}/contents/${path
      .split("/")
      .map(encodeURIComponent)
      .join("/")}?ref=${encodeURIComponent(branch)}`,
  );
  if (!data.content) return { path, content: "", note: "empty or binary file" };
  const bytes = atob(data.content.replace(/\n/g, ""));
  if (bytes.length > 120_000) {
    return {
      path,
      content: bytes.slice(0, 120_000),
      note: "AVISO: conteúdo truncado em 120.000 caracteres — o restante do arquivo NÃO foi mostrado. Não presuma que esta é a versão completa; se precisar editar além do limite, recrie o arquivo apenas com as partes necessárias preservadas.",
    };
  }
  return { path, content: bytes };
}

export type Change = {
  path: string;
  content?: string | undefined;
  encoding?: "utf8" | "base64" | undefined;
  delete?: boolean | undefined;
};

export async function commitChanges(ref: RepoRef, message: string, changes: Change[]) {
  const branch = await resolveBranch(ref);
  const base = `/repos/${ref.owner}/${ref.repo}`;
  const refData = await gh<{ object: { sha: string } }>(
    ref,
    `${base}/git/ref/heads/${encodeURIComponent(branch)}`,
  );
  const headSha = refData.object.sha;
  const headCommit = await gh<{ tree: { sha: string } }>(ref, `${base}/git/commits/${headSha}`);

  const tree: Record<string, unknown>[] = await Promise.all(
    changes.map(async (change) => {
      if (change.delete) {
        return { path: change.path, mode: "100644", type: "blob", sha: null };
      }
      const blob = await gh<{ sha: string }>(ref, `${base}/git/blobs`, {
        method: "POST",
        body: JSON.stringify({
          content: change.content ?? "",
          encoding: change.encoding === "base64" ? "base64" : "utf-8",
        }),
      });
      return { path: change.path, mode: "100644", type: "blob", sha: blob.sha };
    }),
  );

  const newTree = await gh<{ sha: string }>(ref, `${base}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ base_tree: headCommit.tree.sha, tree }),
  });

  const commit = await gh<{ sha: string; html_url: string }>(ref, `${base}/git/commits`, {
    method: "POST",
    body: JSON.stringify({ message, tree: newTree.sha, parents: [headSha] }),
  });

  await gh(ref, `${base}/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: commit.sha, force: false }),
  });

  return { committed: true, branch, sha: commit.sha, url: commit.html_url, files: changes.map((c) => c.path) };
}
