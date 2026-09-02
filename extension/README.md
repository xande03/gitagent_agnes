# Agnes Code Agent — Extensão de Navegador

Extensão **Manifest V3** multiplataforma (Chrome, Edge, Brave, Opera e Firefox 115+) com
**exatamente as mesmas funções** do app web, rodando 100% no navegador — **sem depender
do servidor do app** e sem depender do app para nada.

## Funções (paridade 1:1 com o app web)

| Função | Extensão |
|--------|----------|
| Conectar repositório GitHub (token + dono/projeto + branch opcional) | ✅ |
| Chat com o agente `agnes-2.5-flash` | ✅ |
| Streaming da resposta em tempo real (delta, etapas, commit, done) | ✅ |
| Etapas "Ações no repositório" com status ok/falha | ✅ |
| Commit + push automático com pill clicável | ✅ |
| Anexos (até 6 arquivos/imagens, texto + base64) | ✅ |
| Renderização markdown (títulos, negrito, código, listas) | ✅ |
| Tema claro/escuro persistente | ✅ |
| Botão **Desconectar** vermelho | ✅ |
| Limpar conversa + sugestões iniciais | ✅ |
| Retry com backoff, timeouts, leituras paralelas, commits em série | ✅ |

**Única diferença arquitetural**: no app web a chave da Agnes fica no servidor; na extensão
**você informa a chave da API Agnes no painel de conexão** e ela fica armazenada apenas
no seu dispositivo (`chrome.storage.local`), junto com o token do GitHub.

## Instalação (Chrome / Edge / Brave / Opera)

1. Baixe/clone este repositório
2. Abra `chrome://extensions`
3. Ative **Modo do desenvolvedor** (canto superior direito)
4. Clique em **Carregar sem compactação** e selecione a pasta `extension/`
5. Clique no ícone da extensão na barra — pronto!

**Dica**: no pop-up, clique no botão ⧉ (canto superior direito) para abrir em **aba cheia** —
mesma experiência do app web/PWA.

## Instalação (Firefox)

1. Abra `about:debugging#/runtime/this-firefox`
2. Clique em **Carregar extensão temporária...**
3. Selecione o arquivo `extension/manifest.json`

> No Firefox, se algum pedido falhar, verifique se a extensão tem permissão de acesso
> aos domínios `api.github.com` e `apihub.agnes-ai.com` no painel de permissões da extensão.

## Credenciais necessárias

1. **Token do GitHub** — fine-grained ou classic com permissão de conteúdo (leitura/escrita)
2. **Chave da API Agnes** — a mesma `OPENAI_API_KEY` usada pelo app (base `https://apihub.agnes-ai.com/v1`)
3. **Repositório** — no formato `dono/projeto` (ou URL do GitHub) + branch opcional

## Arquitetura

```
extension/
├── manifest.json      → MV3 multi-navegador + host_permissions (CORS liberado)
├── popup.html/.css    → UI (design system idêntico ao app, paleta oklch)
├── popup.js           → controlador: conexão, chat, streaming, tema, anexos
└── lib/
    ├── github.js      → espelho de src/lib/github.server.ts (retry, timeout, blobs paralelos)
    ├── agent.js       → espelho de src/lib/agent.server.ts (loop, tools, SSE, retries)
    ├── markdown.js    → renderizador markdown com escape anti-XSS
    └── icons.js       → ícones inline (lucide)
```

Sem build, sem dependências, sem servidor: JavaScript puro com ES Modules.
