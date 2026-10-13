# WhatsApp AI Chatbot — Inventário completo de recursos

*[Read in English](./FEATURE_INVENTORY.md)*

> **Última atualização:** 17 de dezembro de 2025
> **Versão:** 1.0
> **Projeto:** AI-chat-bot-whatsapp

---

## Sumário

1. [Arquitetura do sistema](#arquitetura-do-sistema)
2. [Recursos principais](#recursos-principais)
   - [Conexão com o WhatsApp](#-recursos-de-conexão-com-o-whatsapp)
   - [Processamento de mensagens](#-sistema-de-processamento-de-mensagens)
   - [Proteção anti-ban](#️-sistema-de-proteção-anti-ban)
   - [Logs de atividade](#-sistema-de-logs-de-atividade)
   - [API REST](#-rotas-da-api-rest)
   - [Painel administrativo](#️-painel-administrativo-web)
   - [Configurações](#️-configurações-e-ajustes)
   - [Segurança](#-recursos-de-segurança)
3. [Problemas de negócio resolvidos](#problemas-de-negócio-resolvidos)
   - [Principais problemas](#-principais-problemas-resolvidos)
   - [Soluções por setor](#-problemas-resolvidos-por-setor)
   - [Problemas técnicos](#-problemas-técnicos-resolvidos)
   - [Problemas de operação](#-problemas-de-operação-do-negócio-resolvidos)
4. [Métricas dos recursos](#métricas-dos-recursos)

---

## Arquitetura do sistema

### Stack tecnológica

| Componente | Tecnologia | Versão | Finalidade |
|------------|-----------|--------|------------|
| **Runtime** | Node.js | v18+ | Servidor da aplicação |
| **WhatsApp** | @whiskeysockets/baileys | v7.0.0-rc.9 | Conexão direta com o WA |
| **Servidor web** | Express.js | v4.18.2 | API e painel administrativo |
| **Tempo real** | WebSocket (ws) | v8.14.2 | Atualização ao vivo da interface |
| **Cliente HTTP** | axios | v1.6.0 | Chamadas ao webhook do n8n |
| **Geração de QR** | qrcode | v1.5.3 | Exibição do QR Code |
| **Configuração** | dotenv | v16.3.1 | Variáveis de ambiente |
| **Orquestração da IA** | n8n | Externo | Motor de workflows |
| **RAG** | Cloudflare AutoRAG | Nuvem | Base de conhecimento |
| **LLM** | OpenAI/Gemini | via n8n | Respostas da IA |
| **Gerenciador de processos** | PM2 | Mais recente | Hospedagem em produção |

### Diagrama da arquitetura

```
┌─────────────────────────────────────────────────────────────────┐
│                Painel administrativo (navegador)                │
│                      http://localhost:3000                      │
└─────────────────────────────────────────────────────────────────┘
                              │ WebSocket
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Servidor Node.js (Express)                   │
│  ┌─────────────┐  ┌─────────────┐  ┌────────────────────────┐   │
│  │ API REST    │  │ Servidor    │  │ Gerenciador anti-ban   │   │
│  │ (17 rotas)  │  │ WebSocket   │  │ (limites, atrasos)     │   │
│  └─────────────┘  └─────────────┘  └────────────────────────┘   │
│                              │                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                 Cliente WhatsApp (Baileys)                 │ │
│  │  - Autenticação por QR      - Tratamento de mensagens      │ │
│  │  - Gestão da conexão        - Atualizações de presença     │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │ HTTP POST
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Motor de workflows n8n                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐ │
│  │ Gatilho  │→ │ Checa a  │→ │ Consulta │→ │ LLM (GPT/Gemini) │ │
│  │ Webhook  │  │ memória  │  │ AutoRAG  │  │ Resposta         │ │
│  └──────────┘  └──────────┘  └──────────┘  └──────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## Recursos principais

### 📱 Recursos de conexão com o WhatsApp

| Recurso | Descrição | Status |
|---------|-----------|--------|
| Autenticação por QR Code | QR exibido no navegador (sem precisar de terminal) | ✅ |
| Reconexão automática | Nova tentativa 5 segundos depois de cair | ✅ |
| Persistência das credenciais | Estado de autenticação em vários arquivos, em `auth_info/` | ✅ |
| Gestão do estado da conexão | 3 estados: desconectado → conectando → conectado | ✅ |
| Identificação do número | Mostra automaticamente o número conectado | ✅ |
| Logout limpo | Desconexão correta + limpeza da autenticação | ✅ |

**Estados da conexão:**
```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ Desconectado │ ──▶ │  Conectando  │ ──▶ │  Conectado   │
│  (vermelho)  │     │  (amarelo)   │     │   (verde)    │
└──────────────┘     └──────────────┘     └──────────────┘
       ▲                                          │
       └──────────────────────────────────────────┘
                   (quando desconecta)
```

---

### 🤖 Sistema de processamento de mensagens

| Recurso | Descrição | Status |
|---------|-----------|--------|
| Tratador de mensagens recebidas | Extrai o texto de conversation/extendedText | ✅ |
| Filtro das próprias mensagens | Ignora as mensagens enviadas pelo bot (`msg.key.fromMe`) | ✅ |
| Filtro de status | Ignora atualizações de status | ✅ |
| Formatação do número | Remove o sufixo `@s.whatsapp.net` | ✅ |
| Integração com o webhook do n8n | Faz POST das mensagens com o contexto completo | ✅ |
| Tempo limite de 30 segundos | Evita travar quando o n8n está lento | ✅ |
| Checagem de transferência para humano | Respeita o `skip: true` vindo do n8n | ✅ |
| Mensagens de erro em vários idiomas | Respostas de reserva em EN/BM/mandarim | ✅ |

**Dados da mensagem enviados ao n8n:**
```javascript
{
  from: "60123456789",           // Número de telefone
  fromJid: "60123456789@s.whatsapp.net",  // JID completo
  message: "User's text message",
  timestamp: "2025-12-17T10:30:00.000Z",
  messageId: "BAE5ABC123..."
}
```

**Fluxo da mensagem:**
```
O usuário manda uma mensagem no WhatsApp
        │
        ▼
┌──────────────────────────────────┐
│ O Baileys recebe a mensagem      │
│ (evento messages.upsert)         │
└──────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────┐
│ Filtros:                         │
│ - ignora as próprias mensagens   │
│ - ignora atualizações de status  │
└──────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────┐
│ Checagem do limite anti-ban      │
│ → bloqueia se passou do limite   │
└──────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────┐
│ Envia o indicador de digitação   │
│ (presença composing)             │
└──────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────┐
│ POST no webhook do n8n           │
│ (tempo limite de 30 segundos)    │
└──────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────┐
│ Checa a transferência p/ humano  │
│ (skip: true = não responde)      │
└──────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────┐
│ Calcula o atraso humanizado      │
│ (2 a 45 segundos)                │
└──────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────┐
│ Envia a resposta pelo Baileys    │
│ + registra para o limite de taxa │
└──────────────────────────────────┘
```

---

### 🛡️ Sistema de proteção anti-ban

> **Tamanho do módulo:** 372 linhas
> **Local:** `/app/src/utils/anti-ban.js`

#### Por que o anti-ban importa

O WhatsApp detecta e bane ativamente contas com comportamento de robô:
- Respostas instantâneas (nenhuma pessoa responde em 0,1 segundo)
- Tempos de resposta sempre iguais (pessoas variam)
- Alto volume de mensagens
- Nenhum indicador de digitação
- Padrão de atividade 24/7

Este sistema imita o comportamento humano para evitar a detecção.

#### Perfis de limite de taxa

| Perfil | Msgs/hora | Msgs/dia | Conversas/hora | Conversas/dia | Uso |
|--------|-----------|----------|----------------|---------------|-----|
| **new** | 30 | 150 | 15 | 50 | Contas novas (<1 mês) |
| **balanced** | 50 | 300 | 25 | 100 | Padrão (1 a 3 meses) |
| **higher** | 80 | 500 | 40 | 150 | Estabelecidas (3+ meses) |
| **custom** | Definido pelo usuário | Definido pelo usuário | Definido pelo usuário | Definido pelo usuário | Configuração própria |

#### Cálculo do atraso humanizado

| Fator | Cálculo | Finalidade |
|-------|---------|------------|
| Atraso base | 2000ms no mínimo | Ponto de partida |
| Tempo de leitura | `palavras × 200ms` | Simula a leitura da mensagem recebida |
| Tempo de digitação | `caracteres × 50ms` | Simula a digitação da resposta |
| Multiplicador de horário | 1,0x a 2,0x | Varia conforme o horário do dia |
| Variação aleatória | ±30% | Evita padrões detectáveis |
| **Faixa final** | 2 a 45 segundos | Resultado limitado |

**Fórmula:**
```
baseDelay = MIN_DELAY + readingTime + typingTime
adjustedDelay = baseDelay × timeOfDayMultiplier
finalDelay = adjustedDelay × (1 ± 0.3 random)
output = clamp(finalDelay, 2000, 45000)
```

#### Multiplicadores por horário do dia

| Período | Multiplicador | Comportamento |
|---------|---------------|---------------|
| 00:00-06:00 | 2,0x | Madrugada — bem mais lento |
| 06:00-09:00 | 1,3x | Começo da manhã — mais lento |
| 09:00-12:00 | 1,0x | Manhã — horário comercial normal |
| 12:00-14:00 | 1,2x | Almoço — um pouco mais lento |
| 14:00-18:00 | 1,0x | Tarde — horário comercial normal |
| 18:00-22:00 | 1,1x | Começo da noite — um pouco mais lento |
| 22:00-00:00 | 1,5x | Noite — mais lento |

#### Recursos adicionais de proteção

| Recurso | Implementação | Finalidade |
|---------|---------------|------------|
| Indicadores de digitação | `sendPresenceUpdate('composing')` | Mostra "digitando..." ao usuário |
| Pausas na digitação | Pausa no meio da escrita em mensagens longas | Mais realista |
| Atualizações de presença | composing → paused → available | Fluxo natural |
| Zera o contador da hora | Automático depois de 60 minutos | Limites novos a cada hora |
| Zera o contador do dia | Automático depois de 24 horas | Limites novos a cada dia |
| Bloqueio por limite de taxa | Bloqueia o envio quando o limite estoura | Evita banimento |
| Contagem de conversas distintas | Limites separados para conversas novas | Evita marcação como spam |

#### Métodos da classe AntiBanManager

| Método | Finalidade | Retorno |
|--------|------------|---------|
| `canSendMessage(chatId)` | Confere se os limites permitem enviar | `{ allowed, reason?, waitTime? }` |
| `calculateDelay(inMsg, outMsg)` | Calcula o atraso humanizado | Milissegundos |
| `recordMessage(chatId)` | Incrementa os contadores depois do envio | void |
| `checkAndResetCounters()` | Zera os contadores da hora/do dia | void |
| `getStats()` | Estatísticas atuais e horários de reinício | Objeto de estatísticas |
| `getHealth()` | Percentual de uso + avisos | Objeto de saúde |
| `updateLimits(newLimits)` | Atualiza os limites em tempo de execução | void |
| `getLimits()` | Limites atuais | Objeto de limites |

---

### 📊 Sistema de logs de atividade

| Recurso | Descrição |
|---------|-----------|
| Armazenamento em memória | No máximo 1000 entradas (as mais antigas saem sozinhas) |
| Persistência em arquivo | `logs/activity.json` |
| Gravação automática | Agrupada — grava a cada 10 entradas |
| Backup automático a cada 30 dias | Move automaticamente para `logs/backups/` |
| Backup manual | Pelo botão no painel administrativo |
| Exportação em JSON | Baixa todos os logs como arquivo JSON |
| Exportação em CSV | Baixa em formato compatível com planilha |
| Sincronização com o Google Drive | Integração opcional de backup na nuvem |

#### Níveis de log

| Nível | Ícone | Cor | Uso |
|-------|-------|-----|-----|
| `info` | ℹ️ | Azul | Atualizações da conexão, respostas do n8n |
| `success` | ✅ | Verde | Conexão estabelecida, mensagens enviadas |
| `warning` | ⚠️ | Amarelo | Limite de taxa se aproximando, n8n não configurado |
| `error` | ❌ | Vermelho | Falhas de conexão, erros no envio de mensagem |

#### Estrutura de uma entrada de log

```javascript
{
  id: "1702816245000",              // ID baseado no horário
  timestamp: "2025-12-17T10:30:45.000Z",
  message: "Message sent to +60123456789",
  level: "success"
}
```

#### Estrutura dos arquivos de backup

```
logs/
├── activity.json           # Log ativo atual
└── backups/
    ├── backup-2025-11-17.json
    ├── backup-2025-10-17.json
    └── ...
```

---

### 🌐 Rotas da API REST

> **Total de rotas:** 17

#### Gestão da conexão

| Rota | Método | Descrição | Resposta |
|------|--------|-----------|----------|
| `/api/status` | GET | Estado atual da conexão + QR | `{ status, qr, phone, connectedAt }` |
| `/api/connect` | POST | Inicia a conexão com o WhatsApp | `{ success, message }` |
| `/api/disconnect` | POST | Desconecta o dispositivo | `{ success, message }` |
| `/api/clear-auth` | POST | Apaga as credenciais + faz logout | `{ success, message }` |

#### Logs e exportação

| Rota | Método | Descrição | Resposta |
|------|--------|-----------|----------|
| `/api/logs` | GET | Busca os logs de atividade | `{ logs: [...] }` |
| `/api/logs?limit=50` | GET | Busca com limite (máx. 100) | `{ logs: [...] }` |
| `/api/logs/export?format=json` | GET | Exporta em JSON | Download do arquivo |
| `/api/logs/export?format=csv` | GET | Exporta em CSV | Download do arquivo |
| `/api/logs/backup` | POST | Backup manual + limpeza | `{ success, backupFile, googleDrive }` |
| `/api/logs/backups` | GET | Lista todos os backups | `{ local: [...], googleDrive: [...] }` |
| `/api/logs/backups/:filename` | GET | Baixa um backup específico | Download do arquivo |

#### Gestão do anti-ban

| Rota | Método | Descrição | Resposta |
|------|--------|-----------|----------|
| `/api/anti-ban/stats` | GET | Contagem atual de mensagens | `{ messagesThisHour, messagesThisDay, ... }` |
| `/api/anti-ban/health` | GET | Percentuais de uso + avisos | `{ status, hourlyUsage%, warnings[] }` |
| `/api/anti-ban/settings` | GET | Configuração atual + perfis | `{ current: {...}, presets: {...} }` |
| `/api/anti-ban/settings` | POST | Atualiza os limites de taxa | `{ success, settings }` |

#### Configurações e saúde

| Rota | Método | Descrição | Resposta |
|------|--------|-----------|----------|
| `/api/settings` | GET | URL do webhook, se há senha | `{ webhookUrl, hasPassword }` |
| `/api/health` | GET | Verificação de saúde + tempo no ar | `{ status: 'ok', uptime }` |
| `/` | GET | Entrega o HTML do painel administrativo | Página HTML |

---

### 🖥️ Painel administrativo web

> **Local:** `/app/public/index.html`
> **Tamanho:** 1.192 linhas (HTML + CSS + JS)

#### Seções visuais

A interface do painel é em inglês; o desenho abaixo mostra os textos como aparecem nela.

```
┌─────────────────────────────────────────────────────────────────┐
│  WhatsApp AI Bot                              ● Connected       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────┐  ┌─────────────────────────────────┐  │
│  │     QR CODE         │  │        CONTROLS                 │  │
│  │                     │  │  [Connect] [Disconnect] [Clear] │  │
│  │   [QR Image or      │  │                                 │  │
│  │    Status Text]     │  │  CONNECTION INFO                │  │
│  │                     │  │  Status: Connected              │  │
│  │                     │  │  Phone: +60 12-345 6789         │  │
│  │                     │  │  Since: 12/17/2025, 10:30 AM    │  │
│  └─────────────────────┘  └─────────────────────────────────┘  │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  ANTI-BAN SETTINGS                                      │   │
│  │  [New Account] [Balanced] [Higher] [Custom]             │   │
│  │                                                         │   │
│  │  Custom: Msgs/Hour [50] Msgs/Day [300]                 │   │
│  │          Chats/Hour [25] Chats/Day [100]  [Save]       │   │
│  │                                                         │   │
│  │  CURRENT USAGE                          ● Healthy       │   │
│  │  Messages This Hour:  ████░░░░░░  12/50 (24%)          │   │
│  │  Messages Today:      ██░░░░░░░░  45/300 (15%)         │   │
│  │  Unique Chats/Hour:   ███░░░░░░░  8/25 (32%)           │   │
│  │  Unique Chats Today:  █░░░░░░░░░  15/100 (15%)         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  ACTIVITY LOG (127 entries)    [JSON] [CSV] [Backup]   │   │
│  │  ─────────────────────────────────────────────────────  │   │
│  │  10:30:45  ✅  Message sent to +60123456789            │   │
│  │  10:30:40  ℹ️  n8n response received (1.2s)            │   │
│  │  10:30:38  ℹ️  Message received from +60123456789      │   │
│  │  10:25:12  ✅  Connected to WhatsApp                    │   │
│  │  ...                                                    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                      ● Live    │
└─────────────────────────────────────────────────────────────────┘
```

#### Recursos da interface

| Recurso | Descrição |
|---------|-----------|
| Tema escuro | Fundo preto/cinza com texto claro |
| Grade responsiva | 2 colunas no computador, 1 coluna no celular |
| Selo de status animado | Ponto pulsante (verde/amarelo/vermelho) |
| QR atualizado em tempo real | Via WebSocket, sem precisar recarregar |
| Barras de progresso | Uso por cores (verde → amarelo → vermelho) |
| Diálogos de confirmação | Antes de ações destrutivas |
| Estado de carregamento nos botões | Desabilita + troca o texto durante a operação |
| WebSocket com reconexão automática | Nova tentativa a cada 3 segundos |

#### Tipos de mensagem do WebSocket

| Tipo | Direção | Finalidade |
|------|---------|------------|
| `init` | Servidor → Cliente | Estado completo ao conectar |
| `status` | Servidor → Cliente | Mudanças no estado da conexão |
| `log` | Servidor → Cliente | Novas entradas de atividade |
| `antiBanStats` | Servidor → Cliente | Atualização dos percentuais de uso |
| `antiBanSettings` | Servidor → Cliente | Sincronização das configurações |

---

### ⚙️ Configurações e ajustes

#### Variáveis de ambiente (`.env`)

```env
# Configuração do servidor
PORT=3000                              # Porta do servidor (padrão: 3000)

# Integração com o n8n (OBRIGATÓRIO)
N8N_WEBHOOK_URL=https://n8n.example.com/webhook/whatsapp

# Segurança (OPCIONAL)
ADMIN_PASSWORD=your-secret-password    # Bearer token para autenticar na API

# Backup no Google Drive (OPCIONAL)
GOOGLE_CREDENTIALS_FILE=./google-credentials.json
GOOGLE_DRIVE_FOLDER_ID=1abc123xyz...
```

#### Configurações persistentes (`settings.json`)

```javascript
{
  "antiBan": {
    "preset": "balanced",
    "messagesPerHour": 50,
    "messagesPerDay": 300,
    "uniqueChatsPerHour": 25,
    "uniqueChatsPerDay": 100
  }
}
```

#### Funções do módulo de configurações

| Função | Finalidade |
|--------|------------|
| `loadSettings()` | Carrega do arquivo ou cria os padrões |
| `saveSettings()` | Grava no `settings.json` |
| `getSettings()` | Retorna todas as configurações |
| `getSetting(path)` | Retorna um valor aninhado (ex.: `'antiBan.preset'`) |
| `updateSettings(section, updates)` | Atualiza uma seção + grava |
| `updateAntiBanSettings(updates)` | Tratamento especial para o anti-ban |
| `getAntiBanSettings()` | Retorna a configuração atual do anti-ban |

---

### 🔐 Recursos de segurança

| Recurso | Implementação |
|---------|---------------|
| Autenticação opcional na API | Bearer token pela variável `ADMIN_PASSWORD` |
| Variáveis de ambiente | Segredos nunca fixos no código |
| Validação de caminhos de arquivo | Nomes de arquivo de backup saneados |
| Suporte a HTTPS | Detecção automática do protocolo `wss://` |
| Credenciais no gitignore | `auth_info/` fica fora do git |
| Autenticação por Service Account | Google Drive com escopos limitados |

#### Autenticação na API

Quando o `ADMIN_PASSWORD` está definido:
```bash
# Todas as chamadas à API exigem o Bearer token
curl -H "Authorization: Bearer your-password" \
     http://localhost:3000/api/status
```

---

### 🚀 Inicialização e encerramento

#### Sequência de inicialização

```
1. Carrega a configuração do .env
         │
         ▼
2. Inicializa os servidores Express + HTTP + WebSocket
         │
         ▼
3. Carrega os logs de atividade do arquivo
         │
         ▼
4. Inicializa o gerenciador anti-ban com as configurações
         │
         ▼
5. Inicializa o Google Drive (se configurado)
         │
         ▼
6. Inicia a conexão com o WhatsApp automaticamente
         │
         ▼
7. Escuta na PORT (padrão: 3000)
```

#### Saída no console

```
╔════════════════════════════════════════════════════╗
║       WhatsApp AI Bot - Admin Panel                ║
╚════════════════════════════════════════════════════╝

🌐 Web UI:      http://localhost:3000
🔗 n8n Webhook: https://n8n.example.com/webhook/whatsapp
🔐 Password:    ENABLED
📁 Logs:        /app/logs/activity.json

Initializing...
```

#### Tratamento do encerramento

| Sinal | Comportamento |
|-------|---------------|
| SIGINT (Ctrl+C) | Desconecta de forma limpa + encerra |
| Exceção não capturada | Registra o erro + continua |
| Promise rejeitada sem tratamento | Registra o erro + continua |

---

## Problemas de negócio resolvidos

### 🎯 Principais problemas resolvidos

| Problema | Solução | Impacto no negócio |
|----------|---------|--------------------|
| **Atendimento 24/7** | O bot de IA responde na hora, a qualquer momento | Nenhuma consulta perdida, clientes mais satisfeitos |
| **Perguntas frequentes repetitivas** | A base de conhecimento responde as dúvidas comuns | Equipe livre para tarefas complexas |
| **Barreiras de idioma** | Atendimento em três idiomas (EN/BM/mandarim) | Atende todos os públicos da Malásia |
| **Respostas lentas** | Resposta imediata da IA (2-45 s, humanizada) | Mais engajamento dos clientes |
| **Alto custo de atendimento** | Automatiza 80% das consultas | Menos necessidade de equipe |
| **Respostas desencontradas** | A base de conhecimento garante a precisão | Consistência da marca mantida |

---

### 💼 Problemas resolvidos por setor

#### 🍽️ Alimentação / restaurantes

| Problema | Solução |
|----------|---------|
| Perguntas repetidas sobre cardápio/preços | A IA responde pela base de conhecimento |
| Consultas sobre horário de funcionamento | Respostas imediatas e precisas 24/7 |
| Reservas | Coleta os dados e repassa à equipe |
| Divulgação de promoções | Mensagens dirigidas a clientes interessados |
| Dúvidas sobre dieta/alergia | Informação detalhada dos ingredientes na base |

#### 🛒 E-commerce / dropshipping

| Problema | Solução |
|----------|---------|
| Perguntas sobre disponibilidade de produtos | Estoque em tempo real via RAG |
| Acompanhamento de pedidos | Integração com a gestão de pedidos |
| Dúvidas sobre troca/reembolso | Explica a política + encaminha |
| Recomendação de produtos | A IA sugere com base na conversa |
| Dúvidas sobre tamanho/especificação | Informação detalhada do produto na base |

#### 🏠 Corretores de imóveis

| Problema | Solução |
|----------|---------|
| Enxurrada de consultas sobre anúncios | A IA pré-qualifica os interessados automaticamente |
| Agendamento de visitas | Coleta as preferências e combina os horários |
| Perguntas sobre detalhes do imóvel | Informação imediata do banco de anúncios |
| Consultas fora do horário | Resposta 24/7 para os interessados quentes |
| Perguntas sobre a região/bairro | Informação de localização da base de conhecimento |

#### 🏥 Clínicas / saúde

| Problema | Solução |
|----------|---------|
| Marcação de consultas | Coleta os dados e confere a disponibilidade |
| Horário/endereço da clínica | Respostas imediatas e precisas |
| Consultas sobre preços de serviços | Informação de preços transparente |
| Acompanhamento pós-consulta | Mensagens automáticas de retorno |
| Dúvidas sobre convênio/pagamento | Detalhes das políticas na base |

#### 📚 Cursos e reforço escolar

| Problema | Solução |
|----------|---------|
| Pedidos de informação sobre cursos | Respostas detalhadas sobre o conteúdo |
| Consultas sobre valores | Tabela de preços clara |
| Vagas nas turmas | Horários em tempo real |
| Agendamento de aula experimental | Workflow de agendamento automático |
| Perguntas sobre a formação dos professores | Informação da equipe na base de conhecimento |

---

### 🔧 Problemas técnicos resolvidos

| Problema | Solução | Benefício |
|----------|---------|-----------|
| **Banimento de contas de WhatsApp** | Sistema anti-ban completo | Operação sustentável no longo prazo |
| **Detecção de robô** | Atrasos humanizados + indicadores de digitação | Evita a detecção por comportamento |
| **Limite de taxa** | Perfis configuráveis conforme a idade da conta | Caminho seguro para crescer |
| **Estabilidade da conexão** | Reconexão automática + logout limpo | Mínimo de tempo fora do ar |
| **Leitura do QR Code** | Interface no navegador (sem terminal) | Entrada fácil para o cliente |
| **Monitoramento das atividades** | Logs em tempo real + exportação | Transparência e depuração |
| **Gestão da configuração** | Configurações persistentes + controle pela API | Ajustes fáceis com o sistema rodando |
| **Hospedagem de vários clientes** | Pastas de autenticação separadas + PM2 | Escala para muitos clientes |
| **Backup na nuvem** | Integração com o Google Drive | Proteção dos dados |

---

### 💰 Problemas de operação do negócio resolvidos

| Problema | Solução | Impacto no retorno |
|----------|---------|--------------------|
| **Vendas perdidas fora do horário** | Resposta da IA 24/7 | Captura clientes que seriam perdidos |
| **Equipe sobrecarregada** | Automatiza as consultas repetitivas | Equipe focada em fechar vendas |
| **Respostas desencontradas** | Precisão da base de conhecimento | Consistência da marca |
| **Sem histórico de conversas** | Logs de atividade + memória | Retornos com contexto |
| **Descompasso de idioma** | Atendimento em três idiomas | Atende todo o mercado da Malásia |
| **Consultas complexas** | Sistema de transferência para humano | Encaminhamento sem atrito quando preciso |
| **Custo para crescer** | Automação em vez de contratação | Custo linear, capacidade exponencial |

---

### 📊 Resumo dos problemas resolvidos

```
┌─────────────────────────────────────────────────────────────────────┐
│                 PROBLEMAS DE EXPERIÊNCIA DO CLIENTE                 │
├─────────────────────────────────────────────────────────────────────┤
│ ✅ Resposta lenta ou nenhuma às consultas no WhatsApp              │
│ ✅ Barreiras de idioma (EN/BM/mandarim)                            │
│ ✅ Informação desencontrada entre atendentes diferentes            │
│ ✅ Clientes perdidos por consultas fora do horário                 │
│ ✅ Espera longa para perguntas simples                             │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                   PROBLEMAS DE OPERAÇÃO DO NEGÓCIO                  │
├─────────────────────────────────────────────────────────────────────┤
│ ✅ Alto custo com equipe de atendimento                            │
│ ✅ Esgotamento da equipe com perguntas repetitivas                 │
│ ✅ Impossível crescer sem contratar                                │
│ ✅ Nenhuma visibilidade das conversas com clientes                 │
│ ✅ Dificuldade de acompanhar os padrões de consulta                │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                          PROBLEMAS TÉCNICOS                         │
├─────────────────────────────────────────────────────────────────────┤
│ ✅ Banimento de contas de WhatsApp por automação                   │
│ ✅ Configuração complexa da API do WhatsApp                        │
│ ✅ Falta de painel simples para clientes não técnicos              │
│ ✅ Estabilidade e recuperação da conexão                           │
│ ✅ Registro e backup das atividades                                │
└─────────────────────────────────────────────────────────────────────┘
```

---

### 🎯 Resumo da proposta de valor

**Para as pequenas e médias empresas da Malásia, este bot resolve:**

| # | Categoria do problema | Solução |
|---|-----------------------|---------|
| 1 | **Tempo** | Respostas imediatas 24/7 |
| 2 | **Custo** | Automatiza 80% das consultas |
| 3 | **Idioma** | Atendimento em três idiomas (EN/BM/ZH) |
| 4 | **Escala** | Atende conversas ilimitadas |
| 5 | **Consistência** | Precisão da base de conhecimento |
| 6 | **Visibilidade** | Logs de atividade e análises |
| 7 | **Técnico** | Proteção anti-ban embutida |
| 8 | **Transferência** | Encaminhamento para humano sem atrito |

**Resumindo:** pequenas e médias empresas conseguem oferecer atendimento de nível corporativo pelo WhatsApp, sem orçamento de nível corporativo.

---

## Métricas dos recursos

### Estatísticas do código

| Componente | Linhas de código |
|------------|------------------|
| Servidor principal (`server.js`) | 993 |
| Módulo anti-ban | 372 |
| Módulo de configurações | 175 |
| Painel administrativo (HTML/CSS/JS) | 1.192 |
| **Total** | **~2.732** |

### Contagem de recursos

| Categoria | Quantidade |
|-----------|------------|
| Rotas da API REST | 17 |
| Tipos de mensagem do WebSocket | 5 |
| Perfis do anti-ban | 4 |
| Níveis de log | 4 |
| Idiomas suportados | 3 |
| Multiplicadores por horário | 7 |
| Seções do painel administrativo | 7 |

### Dependências

| Pacote | Finalidade |
|--------|------------|
| `@whiskeysockets/baileys` | Conexão com o WhatsApp |
| `express` | Servidor web |
| `axios` | Cliente HTTP |
| `qrcode` | Geração de QR |
| `ws` | WebSocket |
| `dotenv` | Configuração |
| `googleapis` | Backup na nuvem |

---

## Apêndice: estrutura de arquivos

```
AI-chat-bot-whatsapp/
├── CLAUDE.md                           # Instruções de desenvolvimento
├── README.md                           # Visão geral do projeto
│
├── app/                                # Aplicação principal
│   ├── package.json                    # Dependências
│   ├── server.js                       # Servidor principal (993 linhas)
│   ├── settings.json                   # Configurações persistentes
│   ├── .env                            # Configuração (no gitignore)
│   ├── .env.example                    # Modelo de configuração
│   │
│   ├── src/
│   │   └── utils/
│   │       ├── anti-ban.js             # Módulo anti-ban
│   │       └── settings.js             # Gerenciador de configurações
│   │
│   ├── public/
│   │   └── index.html                  # Interface do painel
│   │
│   ├── auth_info/                      # Credenciais do WhatsApp (no gitignore)
│   │
│   └── logs/
│       ├── activity.json               # Logs atuais
│       └── backups/                    # Logs arquivados
│
├── docs/
│   ├── FEATURE_INVENTORY.md            # Este documento (em inglês)
│   ├── ANTI_BAN_PROTOCOL.md            # Guia de prevenção de banimento
│   ├── BUSINESS_MONETIZATION_RESEARCH.md
│   └── CLAUDE_SESSION_NOTES.md
│
├── knowledge-base/                     # Arquivos de exemplo da base
│
└── n8n-workflows/                      # Workflows exportados
```

---

*Documento gerado em: 17 de dezembro de 2025*
