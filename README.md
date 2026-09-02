# Code Companion

utilizando o modelo "agnes-2.5-flash", crie uma agente de ia que modifique projetos do GitHub mediante a interação usuários pelo chat. O usuário primeiramente informa em um painel, as credenciais de token e chave api para que o app se conecte com com o projeto para assim abrir o chat de interação entre o agente e usuário. O usuário solicita uma correção ajuste, modificação ou adição de componentes ou elementos ao projeto e o agente entra em ação vendo primeiramente a estrutura atual do projeto para depois  fazer as mudanças; O agente deve fazer de forma precisa as mudanças de forma que seja no local exato onde o código da solicitação foi enviado,, por isso o agente não deve solicitar ou perguntar nada ao usuário e sim realizar as mudanças e FAZER O COMIT COM O PUSH automáticos para o GitHub. 

A interface deve ser premium, intuitiva e dinâmica, tendo alternância entre o modo claro escuro, identificação do projeto que foi conectado, botão de desconectar e outras funções. No chat deve ter botão de anexar arquivos e imagens e o agente responsável deve conseguir entender, visualizar e modificar estes arquivos pagos o projeto 

Adicione botão de anexar arquivos e imagens para que usuários possam enviar os agentes para que eles possam manipular, alterar ou incluir ara dentro do projeto

Deve ter um layout responsivo e adaptado para qualquer dispositivo
Aqui está api key: @secret:OPENAI_API_KEY 
Url base:  https://apihub.agnes-ai.com/v1

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/263fba90-48cf-4930-bc9a-b508c4c20b83).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Extensão de navegador

O projeto também existe como **extensão MV3 independente** (Chrome, Edge, Brave, Opera, Firefox)
com as mesmas funções do app web — streaming, anexos, temas, commit + push automático —
sem depender do servidor. Veja [`extension/README.md`](extension/README.md) para instalar.
