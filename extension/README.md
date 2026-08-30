# Agnes Code Agent — extensao de navegador

Funciona em Chrome, Edge, Brave, Arc e Opera (Chromium).

## Instalar

1. Descompacte o arquivo `agnes-code-agent-extension.zip`.
2. Abra `chrome://extensions`.
3. Ative o **Modo do desenvolvedor** (canto superior direito).
4. Clique em **Carregar sem compactacao** e selecione a pasta descompactada.

## Usar

- Clique no icone da extensao para abrir o chat no popup.
- Botao "Painel lateral" abre o agente fixo ao lado da pagina.
- Botao "Aba" abre o app em tela cheia.
- Em **Config** (pagina de opcoes) defina a URL do app publicado, caso use um dominio proprio.

## Seguranca

- A chave da API Agnes e a URL base `https://apihub.agnes-ai.com/v1` ficam **somente no servidor**
  do app (server functions). A extensao nao contem nem transmite segredos.
- O token do GitHub e digitado pelo usuario e permanece no armazenamento local do app.
- A extensao apenas embute a interface hospedada via HTTPS (`host_permissions` restrito).
