# WhatsApp AI Framework (Community Edition)

*[Read in English](./README.md)*

> **Um framework de automação de WhatsApp pronto para produção, com proteção anti-ban, integração com n8n e suporte a RAG.**

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Status](https://img.shields.io/badge/status-stable-green.svg)
![Node](https://img.shields.io/badge/node-v18%2B-green)

> ### 🔀 Este é um fork
>
> Feito para **instalação própria em VPS**. Acrescenta três coisas ao projeto
> original:
>
> - **Saída por proxy residencial**, injetada no Baileys do jeito que a v7 de
>   fato exige — e fail-closed: o bot se recusa a subir em vez de conectar a
>   partir de um IP de datacenter.
> - **`POST /api/send`**, para que um agendador externo envie mensagens ativas
>   passando pelo pipeline anti-ban, em vez de contorná-lo.
> - **Silêncio quando não configurado**, no lugar da resposta genérica fixa no
>   código que era enviada a contatos reais.
>
> Todos os detalhes, incluindo a pegadinha do `agent` vs `fetchAgent` no
> Baileys v7 que faz muita gente perder a transferência de mídia: **[O que muda neste fork](./docs/FORK_CHANGES.pt-BR.md)** · **[In English](./docs/FORK_CHANGES.md)**

**Projeto original:** este projeto é um fork da community edition, de código aberto, do framework interno desenvolvido pela [GX Automation Tech](https://gxautomation.tech). O motor anti-ban, o painel administrativo e a arquitetura com n8n são deles. Para soluções de WhatsApp de nível empresarial e totalmente em conformidade (verificação com selo verde), fale com eles sobre os serviços oficiais de implantação do **respond.io**.

---

## ⚠️ Aviso e alerta de risco

**Este projeto usa a API não oficial do WhatsApp Web (`@whiskeysockets/baileys`).**

1.  **Risco de banimento:** usar esta biblioteca traz o risco de o seu número de WhatsApp ser banido permanentemente.
2.  **Lógica anti-ban:** embora este projeto inclua uma simulação sofisticada de comportamento "humano" (atrasos de digitação variáveis, limite de taxa, ciclos de sono), **nenhuma proteção é 100% infalível**.
3.  **Responsabilidade:** os autores não se responsabilizam por números banidos, perda de dados ou interrupção de negócios resultantes do uso deste software.
4.  **Recomendação:** para números críticos para o negócio, use a [WhatsApp Business API](https://developers.facebook.com/docs/whatsapp) oficial (ou o nosso serviço gerenciado).

---

## 🌟 Principais recursos

*   **🛡️ Sistema anti-ban avançado:**
    *   **Atrasos variáveis:** calcula o "tempo humano de leitura" + "tempo de digitação" antes de responder.
    *   **Simulação de digitação:** mostra o status "Digitando..." ao usuário durante o atraso.
    *   **Limite de taxa:** limites configuráveis (ex.: no máximo 50 mensagens/hora), com barras visuais de saúde.
    *   **Lógica por horário do dia:** respostas mais lentas à noite, imitando o ciclo de sono humano.
*   **🧠 Integração com n8n:**
    *   Toda a lógica fica no n8n (editor visual de workflows).
    *   Suporta OpenAI, Google Gemini, Anthropic ou LLMs locais via n8n.
    *   Suporta RAG (Retrieval Augmented Generation) para consultas a uma base de conhecimento.
*   **🔌 Arquitetura plug-and-play:** construída sobre Node.js + Express.
*   **📊 Painel administrativo web:**
    *   Leitura do QR Code direto no navegador.
    *   Status da conexão em tempo real.
    *   Logs de atividade ao vivo.
    *   Configuração dinâmica (troque a URL do webhook sem reiniciar).
*   **🌍 Suporte a vários idiomas:** pronto para inglês, malaio (Bahasa Malaysia) e mandarim.

---

## 📋 Pré-requisitos

Antes de começar, garanta que você tem:

1.  **Node.js (v18 ou superior):** [baixe aqui](https://nodejs.org/)
2.  **Uma instância do n8n:**
    *   **Nuvem:** [crie uma conta no n8n Cloud](https://n8n.io/) (o mais fácil)
    *   **Instalação própria:** `npm install n8n -g` (gratuito)
3.  **Um número de WhatsApp:** recomendamos testar primeiro com um número secundário.

---

## 🚀 Guia de instalação e configuração

### Passo 1: instalar o bot

1.  **Clone o repositório:**
    ```bash
    git clone https://github.com/arthurbauer-br/whatsapp-ai-framework.git
    cd whatsapp-ai-framework
    ```

2.  **Instale as dependências:**
    ```bash
    cd app
    npm install
    ```

3.  **Defina a variável de proxy obrigatória.** Este fork não sobe sem ela —
    veja o motivo em [FORK_CHANGES.pt-BR.md](./docs/FORK_CHANGES.pt-BR.md#1-suporte-a-proxy-residencial-fail-closed).
    ```bash
    cp .env.example .env
    # depois edite o .env e defina P2SPEED_PROXY=http://seu-host-de-proxy:porta
    ```

4.  **Inicie o servidor:**
    ```bash
    npm start
    ```
    Vai aparecer a mensagem: `🌐 Web UI: http://localhost:3000`

---

### Passo 2: configurar o "cérebro" (n8n)

O bot precisa de um "cérebro" que decida o que responder. Para isso usamos o **n8n**.

1.  **Abra o n8n:** entre no painel do seu n8n.
2.  **Importe o workflow:**
    *   Clique em **Add Workflow** > **Import from File**.
    *   Selecione `n8n-workflows/advanced-chat-gemini.json`, na pasta deste projeto.
3.  **Configure as credenciais:**
    *   Dê dois cliques no nó **Google Gemini** (ou no nó da OpenAI).
    *   Escolha "Create New Credential" e cole a sua chave de API.
4.  **Ative o webhook:**
    *   Dê dois cliques no nó **Webhook**.
    *   Confira se o "HTTP Method" está como `POST`.
    *   **IMPORTANTE:** se o bot roda localmente e o n8n na nuvem, o n8n vai te dar uma URL como `https://your-n8n.cloud/webhook/whatsapp-webhook`. Copie essa URL.
    *   *Obs.: se o n8n roda localmente, use um túnel como `ngrok` ou `tunnelmole` para deixá-lo acessível.*
5.  **Salve e ative:** clique em **Save** e ligue a chave **Active**.

---

### Passo 3: ligar o bot ao cérebro

1.  Abra o **painel administrativo do bot** em `http://localhost:3000`.
2.  Role até o cartão **AI Configuration**.
3.  Cole a **URL do webhook do n8n** (do passo 2) no campo.
4.  Clique em **Save Webhook URL**.
    *   *Isso grava a URL no `settings.json`, então ela continua valendo mesmo depois de reiniciar.*

---

### Passo 4: conectar o WhatsApp

1.  No painel administrativo, procure o cartão **Connection Info**.
2.  Clique no botão verde **Connect**.
3.  Espere um instante até o **QR Code** aparecer.
4.  Abra o WhatsApp no celular:
    *   **iOS:** Configurações > Dispositivos conectados > Conectar um dispositivo.
    *   **Android:** três pontinhos > Dispositivos conectados > Conectar um dispositivo.
5.  Leia o QR Code.
6.  O status deve mudar para **Connected** (verde).

🎉 **O seu bot está no ar!** Mande uma mensagem para o seu número de WhatsApp a partir de outro celular para testar.

---

## 🛡️ Configuração do anti-ban

O bot vem com perfis de "comportamento humano" já configurados. Você pode trocá-los no cartão **Anti-Ban Settings**.

| Perfil | Mensagens/hora | Descrição |
|--------|----------------|-----------|
| **New Account** | 30 | Limites rígidos. Use para números com menos de 1 mês. |
| **Balanced** | 50 | Padrão recomendado. Bom equilíbrio entre velocidade e segurança. |
| **Higher** | 80 | Para números comerciais já estabelecidos (mais de 6 meses). |
| **Custom** | ??? | Defina os seus próprios limites. |

**Como funciona:**
1.  **Limite atingido:** se o bot chega ao limite por hora (ex.: a 51ª mensagem), ele **para de responder** até a hora seguinte, para proteger o seu número. Os logs mostram "Rate Limited".
2.  **Barras de saúde:** acompanhe as barras de "Current Usage" no painel.
    *   **Verde:** zona segura.
    *   **Amarelo:** atenção.
    *   **Vermelho:** limite atingido.

---

## ☁️ Backup no Google Drive (opcional)

Para fazer backup automático dos logs de conversa no Google Drive:

1.  Coloque o seu `google-credentials.json` (chave de Service Account) na pasta `app/`.
2.  Acrescente `GOOGLE_DRIVE_FOLDER_ID=id_da_sua_pasta` ao arquivo `.env`.
3.  O bot passa a sincronizar os logs com a nuvem a cada 30 dias, ou quando você clica em "Backup" manualmente.

---

## ❓ Solução de problemas

**P: O QR Code não carrega.**
R: Clique em "Disconnect", espere 5 segundos e clique em "Connect" de novo. Se não resolver, clique em "Clear Auth" para zerar a sessão.

**P: O bot não responde.**
R:
1.  Confira o **Activity Log** no painel. Aparece "Sending to n8n..."?
2.  Se sim, olhe a aba **Executions** do n8n. O workflow rodou?
3.  Se não, confira se a **URL do webhook do n8n** está correta no painel administrativo.

**P: A resposta demora demais.**
R: Isso é um recurso, não um defeito! O bot calcula quanto tempo uma pessoa levaria para ler a mensagem e digitar a resposta. Você pode ajustar a conta em `app/src/utils/anti-ban.js` se quiser mais rapidez (mas isso aumenta o risco de banimento).

---

## Licença

Licença MIT. Livre para usar e modificar.
