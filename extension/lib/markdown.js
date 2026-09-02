/**
 * Renderizador markdown leve — espelho do MarkdownContent de chat-view.tsx.
 * Suporta: títulos (#..####), negrito, itálico, código inline, blocos de
 * código com etiqueta de linguagem e listas ordenadas/não ordenadas.
 * Toda saída é escapada (defesa contra XSS vindo do texto do modelo).
 */

export function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInlineHtml(text) {
  return text
    .split(/(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`)/g)
    .filter(Boolean)
    .map((part) => {
      if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
        return `<strong>${esc(part.slice(2, -2))}</strong>`;
      }
      if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
        return `<em>${esc(part.slice(1, -1))}</em>`;
      }
      if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
        return `<code class="md-inline-code">${esc(part.slice(1, -1))}</code>`;
      }
      return esc(part);
    })
    .join("");
}

function parseMarkdown(source) {
  const blocks = [];
  const lines = source.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^```(\w*)/);
    if (fence) {
      const lang = fence[1] ?? "";
      const content = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i])) {
        content.push(lines[i]);
        i += 1;
      }
      i += 1;
      blocks.push({ type: "code", lang, content: content.join("\n") });
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2] });
      i += 1;
      continue;
    }
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || ordered) {
      const items = [];
      const isOrdered = Boolean(ordered);
      while (i < lines.length) {
        const item =
          lines[i].match(/^\s*[-*•]\s+(.*)$/) ?? lines[i].match(/^\s*\d+[.)]\s+(.*)$/);
        if (!item) break;
        items.push(item[1]);
        i += 1;
      }
      blocks.push({ type: "list", ordered: isOrdered, items });
      continue;
    }
    if (line.trim() === "") {
      i += 1;
      continue;
    }
    const paragraph = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^```/.test(lines[i]) &&
      !/^#{1,4}\s+/.test(lines[i]) &&
      !/^\s*[-*•]\s+/.test(lines[i]) &&
      !/^\s*\d+[.)]\s+/.test(lines[i])
    ) {
      paragraph.push(lines[i]);
      i += 1;
    }
    blocks.push({ type: "paragraph", text: paragraph.join("\n") });
  }
  return blocks;
}

/** @returns {string} HTML seguro pronto para innerHTML */
export function renderMarkdownHtml(content) {
  const blocks = parseMarkdown(content ?? "");
  return blocks
    .map((block) => {
      if (block.type === "code") {
        const lang = block.lang
          ? `<p class="md-code-lang">${esc(block.lang)}</p>`
          : "";
        return `<div class="md-code">${lang}<pre><code>${esc(block.content)}</code></pre></div>`;
      }
      if (block.type === "heading") {
        const level = Math.min(4, Math.max(1, block.level));
        return `<p class="md-h md-h${level}">${renderInlineHtml(block.text)}</p>`;
      }
      if (block.type === "list") {
        const tag = block.ordered ? "ol" : "ul";
        const items = block.items
          .map((item) => `<li>${renderInlineHtml(item)}</li>`)
          .join("");
        return `<${tag} class="md-list">${items}</${tag}>`;
      }
      return `<p class="md-p">${renderInlineHtml(block.text)}</p>`;
    })
    .join("");
}
