# Agnes Code Agent — extensão de navegador

Extensão Manifest V3 que roda o agente **ancorado no painel lateral** do navegador,
dividindo a tela com a página que você está vendo.

## Instalar (Chrome, Edge, Brave, Opera, Arc)

1. Descompacte o arquivo `agnes-code-agent-extension.zip`.
2. Abra `chrome://extensions`.
3. Ative o **Modo do desenvolvedor** (canto superior direito).
4. Clique em **Carregar sem compactação** e escolha a pasta descompactada.
5. Fixe o ícone na barra. Um clique abre/fecha o painel lateral ancorado.

Na primeira instalação a extensão tenta abrir o painel automaticamente; se o
navegador exigir um gesto, basta clicar no ícone.

## Configuração

O painel embute a interface do app publicado por HTTPS. Para apontar para outro
domínio, abra **Config** (ou a página de opções) e informe a URL `https://...`.

## Segurança

- A chave da API Agnes e a URL base do provedor (`https://apihub.agnes-ai.com/v1`)
  ficam **somente no servidor do app** (server functions) — nunca na extensão.
- O token do GitHub permanece no armazenamento local do próprio app.
- `host_permissions` limitado a `https://*.lovable.app/*`; só URLs HTTPS são aceitas.

## Ícones

`icons/icon-16.png`, `icon-32.png`, `icon-48.png`, `icon-128.png`, `icon-512.png`.
