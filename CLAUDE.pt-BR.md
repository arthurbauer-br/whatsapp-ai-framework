# Instruções do Claude Code para o WhatsApp AI Chatbot

*[Read in English](./CLAUDE.md)* · *O Claude Code lê o `CLAUDE.md`; esta tradução é só para leitura.*

> **Última atualização:** 17 de dezembro de 2025

Este arquivo traz instruções específicas do projeto para as sessões do Claude Code.

---

## Visão geral do projeto

Chatbot de IA para WhatsApp, pronto para produção, com:
- **Baileys** para a conexão com o WhatsApp (NÃO a Evolution API)
- **n8n** para a orquestração da IA (consultas RAG, chamadas ao LLM, memória, transferência para humano)
- **Cloudflare AutoRAG** para a base de conhecimento
- **Painel administrativo web** (exibição do QR, gestão do dispositivo, monitoramento do anti-ban)
- **Proteção anti-ban** (limite de taxa, atrasos humanizados)
- Suporte a vários idiomas (EN, BM, mandarim)

---

## Antes de começar a trabalhar

### 1. Leia o índice da documentação
```
Read /Volumes/External/gx/AI-chat-bot-whatsapp/docs/README.md
```
Ele tem links para toda a documentação do projeto.

### 2. Documentação principal

| Documento | Finalidade |
|-----------|------------|
| [docs/README.md](./docs/README.md) | Índice da documentação |
| [docs/FEATURE_INVENTORY.pt-BR.md](./docs/FEATURE_INVENTORY.pt-BR.md) | Lista completa de recursos |
| [docs/ANTI_BAN_PROTOCOL.pt-BR.md](./docs/ANTI_BAN_PROTOCOL.pt-BR.md) | Prevenção de banimento |
| [docs/CLAUDE_SESSION_NOTES.md](./docs/CLAUDE_SESSION_NOTES.md) | Histórico de desenvolvimento |

### 3. Projeto de referência
```
/Volumes/External/whatsapp-sender/
├── chatbot.js     # Baileys + padrão de webhook
├── send.js        # Baileys: QR + conexão
└── auth_info/     # Armazenamento das credenciais
```

### 4. Use o Context7 para a documentação das bibliotecas

```typescript
// Baileys (WhatsApp)
mcp__context7__resolve-library-id({ libraryName: "baileys whatsapp" })

// Express.js (servidor web)
mcp__context7__resolve-library-id({ libraryName: "express" })

// Geração de QR Code
mcp__context7__resolve-library-id({ libraryName: "qrcode npm" })
```

---

## Stack tecnológica

| Componente | Tecnologia |
|------------|------------|
| Runtime | Node.js v18+ |
| WhatsApp | @whiskeysockets/baileys v7.0.0 |
| Servidor web | Express.js v4.18.2 |
| Tempo real | WebSocket (ws v8.14.2) |
| Cliente HTTP | axios v1.6.0 |
| Exibição do QR | qrcode v1.5.3 |
| Configuração | dotenv v16.3.1 |
| Backup na nuvem | googleapis v169.0.0 |
| Gerenciador de processos | PM2 |
| Orquestração da IA | n8n (externo) |
| RAG | Cloudflare AutoRAG (externo) |
| LLM | OpenAI / Gemini (via n8n) |

---

## Estrutura do projeto

```
AI-chat-bot-whatsapp/
├── README.md                    # Visão geral do projeto
├── CLAUDE.md                    # Este arquivo (instruções de desenvolvimento)
│
├── app/                         # Aplicação Node.js principal
│   ├── package.json             # Dependências
│   ├── server.js                # Servidor principal (993 linhas)
│   ├── settings.json            # Configurações persistentes
│   ├── .env                     # Configuração (no gitignore)
│   ├── .env.example             # Modelo de configuração
│   ├── .gitignore               # Regras do git ignore
│   │
│   ├── src/
│   │   └── utils/
│   │       ├── anti-ban.js      # Módulo anti-ban (372 linhas)
│   │       └── settings.js      # Persistência das configurações (175 linhas)
│   │
│   ├── public/
│   │   └── index.html           # Interface do painel (1.192 linhas)
│   │
│   ├── auth_info/               # Credenciais do WhatsApp (no gitignore)
│   │
│   └── logs/
│       ├── activity.json        # Log de atividade atual
│       └── backups/             # Backups dos logs
│
├── docs/                        # Documentação
│   ├── README.md                # Índice da documentação
│   ├── FEATURE_INVENTORY.md     # Lista completa de recursos
│   ├── ANTI_BAN_PROTOCOL.md     # Guia de prevenção de banimento
│   ├── BUSINESS_MONETIZATION_RESEARCH.md  # Preços e mercado
│   ├── CLIENT_WHATSAPP_OPTIONS.md  # Opções de conexão do cliente
│   ├── META_API_SETUP_GUIDE.md  # Configuração da Meta Business API
│   └── CLAUDE_SESSION_NOTES.md  # Histórico de desenvolvimento
│
├── knowledge-base/              # Bases de conhecimento de exemplo
│   └── urbania-knowledge-base.md
│
├── n8n-workflows/               # Workflows exportados do n8n
│
├── cloudflare/                  # OBSOLETO (época da Evolution API)
└── evolution/                   # OBSOLETO
```

---

## Arquivos principais

| Arquivo | Linhas | Finalidade |
|---------|--------|------------|
| `app/server.js` | 993 | Servidor principal (Baileys + Express + WebSocket) |
| `app/public/index.html` | 1.192 | Interface do painel administrativo |
| `app/src/utils/anti-ban.js` | 372 | Módulo de proteção anti-ban |
| `app/src/utils/settings.js` | 175 | Persistência das configurações |

---

## Rotas da API (17 no total)

### Conexão
| Rota | Método | Finalidade |
|------|--------|------------|
| `/api/status` | GET | Status da conexão + QR |
| `/api/connect` | POST | Inicia o WhatsApp |
| `/api/disconnect` | POST | Desconecta |
| `/api/clear-auth` | POST | Apaga as credenciais |

### Logs
| Rota | Método | Finalidade |
|------|--------|------------|
| `/api/logs` | GET | Busca os logs de atividade |
| `/api/logs/export` | GET | Exporta em JSON/CSV |
| `/api/logs/backup` | POST | Faz backup + limpa |
| `/api/logs/backups` | GET | Lista os backups |
| `/api/logs/backups/:file` | GET | Baixa um backup |

### Anti-ban
| Rota | Método | Finalidade |
|------|--------|------------|
| `/api/anti-ban/stats` | GET | Contagem de mensagens |
| `/api/anti-ban/health` | GET | Percentuais de uso |
| `/api/anti-ban/settings` | GET/POST | Configura os limites |

### Configurações
| Rota | Método | Finalidade |
|------|--------|------------|
| `/api/settings` | GET | Busca as configurações |
| `/api/health` | GET | Verificação de saúde |

---

## Padrões de código

### JavaScript/Node.js
- Recursos do ES6+ (const, let, arrow functions, async/await)
- Tratamento de erros com try/catch
- Variáveis de ambiente via dotenv
- Comentários JSDoc nas funções

### Tratamento de erros
```javascript
try {
    const result = await someOperation();
    return result;
} catch (error) {
    console.error('Operation failed:', error);
    // Trate com elegância, sem derrubar o processo
}
```

---

## Testando localmente

```bash
# Entre na pasta da aplicação
cd app

# Instale as dependências
npm install

# Inicie o servidor de desenvolvimento
npm start
# OU
node server.js

# Abra o painel administrativo
open http://localhost:3000
```

---

## Produção (PM2)

```bash
# Inicia com o PM2
pm2 start app/server.js --name whatsapp-bot

# Inicia sozinho no boot
pm2 startup && pm2 save

# Monitora
pm2 monit

# Mostra os logs
pm2 logs whatsapp-bot
```

---

## Variáveis de ambiente

```env
# Servidor
PORT=3000

# Integração com o n8n (OBRIGATÓRIO)
N8N_WEBHOOK_URL=https://n8n.example.com/webhook/whatsapp

# Segurança (OPCIONAL)
ADMIN_PASSWORD=your-password

# Backup no Google Drive (OPCIONAL)
GOOGLE_CREDENTIALS_FILE=./google-credentials.json
GOOGLE_DRIVE_FOLDER_ID=folder-id
```

---

## Skills e agentes

| Quando usar | Ferramenta |
|-------------|------------|
| Construir interface | `Skill: frontend-design` |
| Testar rotas | `Skill: webapp-testing` |
| Antes de commits | `Task: code-reviewer agent` |
| Explorar o código | `Task: code-explorer agent` |
| Decisões de arquitetura | `Task: Plan agent` |

---

## Observações importantes

1. **A arquitetura mudou**: a Evolution API está obsoleta. Usamos o Baileys diretamente.
2. **QR no navegador**: mostre o QR na interface web, não no terminal
3. **Webhook do n8n**: o Node.js repassa ao n8n e devolve as respostas
4. **Transferência para humano**: tratada no n8n; o Node.js confere o `response.skip`
5. **Anti-ban**: proteção completa embutida no servidor

---

## Depois de fazer alterações

Atualize o `docs/CLAUDE_SESSION_NOTES.md` com:
- O que foi feito
- Problemas encontrados
- Próximos passos
