const GH = "https://api.github.com";

export type RepoRef = { owner: string; repo: string; branch?: string | undefined; token: string };

async function gh<T>(ref: RepoRef, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${GH}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${ref.token}`,
      "Content-Type": "application/json",
      "User-Agent": "agnes-github-agent",
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GitHub ${init?.method ?? "GET"} ${path} failed [${res.status}]: ${text}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
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
  return { path, content: bytes.length > 120_000 ? bytes.slice(0, 120_000) : bytes };
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

  const tree: Record<string, unknown>[] = [];
  for (const change of changes) {
    if (change.delete) {
      tree.push({ path: change.path, mode: "100644", type: "blob", sha: null });
      continue;
    }
    const blob = await gh<{ sha: string }>(ref, `${base}/git/blobs`, {
      method: "POST",
      body: JSON.stringify({
        content: change.content ?? "",
        encoding: change.encoding === "base64" ? "base64" : "utf-8",
      }),
    });
    tree.push({ path: change.path, mode: "100644", type: "blob", sha: blob.sha });
  }

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
