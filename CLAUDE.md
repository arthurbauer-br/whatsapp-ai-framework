# Claude Code Instructions for WhatsApp AI Chatbot

*[Leia em português](./CLAUDE.pt-BR.md)*

> **Last Updated:** December 17, 2025

This file provides project-specific instructions for Claude Code sessions.

---

## Project Overview

Production-ready WhatsApp AI chatbot with:
- **Baileys** for WhatsApp connection (NOT Evolution API)
- **n8n** for AI orchestration (RAG queries, LLM calls, memory, handoff)
- **Cloudflare AutoRAG** for knowledge base
- **Web Admin Panel** (QR display, device management, anti-ban monitoring)
- **Anti-Ban Protection** (rate limiting, human-like delays)
- Multi-language support (EN, BM, Mandarin)

---

## Before Starting Work

### 1. Read Documentation Index
```
Read /Volumes/External/gx/AI-chat-bot-whatsapp/docs/README.md
```
This links to all project documentation.

### 2. Key Documentation

| Document | Purpose |
|----------|---------|
| [docs/README.md](./docs/README.md) | Documentation index |
| [docs/FEATURE_INVENTORY.md](./docs/FEATURE_INVENTORY.md) | Complete feature list |
| [docs/ANTI_BAN_PROTOCOL.md](./docs/ANTI_BAN_PROTOCOL.md) | Ban prevention |
| [docs/CLAUDE_SESSION_NOTES.md](./docs/CLAUDE_SESSION_NOTES.md) | Development history |

### 3. Reference Project
```
/Volumes/External/whatsapp-sender/
├── chatbot.js     # Baileys + webhook pattern
├── send.js        # Baileys QR + connection
└── auth_info/     # Credential storage
```

### 4. Use Context7 for Library Documentation

```typescript
// Baileys (WhatsApp)
mcp__context7__resolve-library-id({ libraryName: "baileys whatsapp" })

// Express.js (Web Server)
mcp__context7__resolve-library-id({ libraryName: "express" })

// QRCode generation
mcp__context7__resolve-library-id({ libraryName: "qrcode npm" })
```

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Node.js v18+ |
| WhatsApp | @whiskeysockets/baileys v7.0.0 |
| Web Server | Express.js v4.18.2 |
| Real-time | WebSocket (ws v8.14.2) |
| HTTP Client | axios v1.6.0 |
| QR Display | qrcode v1.5.3 |
| Config | dotenv v16.3.1 |
| Process Manager | PM2 |
| AI Orchestration | n8n (external) |
| RAG | Cloudflare AutoRAG (external) |
| LLM | OpenAI / Gemini (via n8n) |

---

## Project Structure

```
AI-chat-bot-whatsapp/
├── README.md                    # Project overview
├── CLAUDE.md                    # This file (dev instructions)
│
├── app/                         # Main Node.js application
│   ├── package.json             # Dependencies
│   ├── server.js                # Main server (993 lines)
│   ├── settings.json            # Persistent settings
│   ├── .env                     # Configuration (gitignored)
│   ├── .env.example             # Config template
│   ├── .gitignore               # Git ignore rules
│   │
│   ├── src/
│   │   └── utils/
│   │       ├── anti-ban.js      # Anti-ban module (372 lines)
│   │       └── settings.js      # Settings persistence (175 lines)
│   │
│   ├── public/
│   │   └── index.html           # Admin panel UI (1,192 lines)
│   │
│   ├── auth_info/               # WhatsApp credentials (gitignored)
│   │
│   └── logs/
│       ├── activity.json        # Current activity log
│       └── backups/             # Log backups
│
├── docs/                        # Documentation
│   ├── README.md                # Documentation index
│   ├── FEATURE_INVENTORY.md     # Complete feature list
│   ├── ANTI_BAN_PROTOCOL.md     # Ban prevention guide
│   ├── BUSINESS_MONETIZATION_RESEARCH.md  # Pricing & market
│   ├── CLIENT_WHATSAPP_OPTIONS.md  # Client connection options
│   ├── META_API_SETUP_GUIDE.md  # Meta Business API setup
│   └── CLAUDE_SESSION_NOTES.md  # Development history
│
├── knowledge-base/              # Sample knowledge bases
│   └── urbania-knowledge-base.md
│
└── n8n-workflows/               # Exported n8n workflows
```

---

## Key Files

| File | Lines | Purpose |
|------|-------|---------|
| `app/server.js` | 993 | Main server (Baileys + Express + WebSocket) |
| `app/public/index.html` | 1,192 | Admin panel UI |
| `app/src/utils/anti-ban.js` | 372 | Anti-ban protection module |
| `app/src/utils/settings.js` | 175 | Settings persistence |

---

## API Endpoints (17 Total)

### Connection
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/status` | GET | Connection status + QR |
| `/api/connect` | POST | Start WhatsApp |
| `/api/disconnect` | POST | Disconnect |
| `/api/clear-auth` | POST | Delete credentials |

### Logs
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/logs` | GET | Get activity logs |
| `/api/logs/export` | GET | Export JSON/CSV |
| `/api/logs/backup` | POST | Backup + clear |
| `/api/logs/backups` | GET | List backups |
| `/api/logs/backups/:file` | GET | Download backup |

### Anti-Ban
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/anti-ban/stats` | GET | Message counts |
| `/api/anti-ban/health` | GET | Usage percentages |
| `/api/anti-ban/settings` | GET/POST | Configure limits |

### Settings
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/settings` | GET | Get settings |
| `/api/health` | GET | Health check |

---

## Code Standards

### JavaScript/Node.js
- ES6+ features (const, let, arrow functions, async/await)
- Error handling with try/catch
- Environment variables via dotenv
- JSDoc comments for functions

### Error Handling
```javascript
try {
    const result = await someOperation();
    return result;
} catch (error) {
    console.error('Operation failed:', error);
    // Handle gracefully, don't crash
}
```

---

## Testing Locally

```bash
# Navigate to app directory
cd app

# Install dependencies
npm install

# Start development server
npm start
# OR
node server.js

# Access admin panel
open http://localhost:3000
```

---

## Production (PM2)

```bash
# Start with PM2
pm2 start app/server.js --name whatsapp-bot

# Auto-start on boot
pm2 startup && pm2 save

# Monitor
pm2 monit

# View logs
pm2 logs whatsapp-bot
```

---

## Environment Variables

```env
# Server
PORT=3000

# n8n Integration (REQUIRED)
N8N_WEBHOOK_URL=https://n8n.example.com/webhook/whatsapp

# Security (OPTIONAL)
ADMIN_PASSWORD=your-password
```

---

## Skills & Agents

| When To Use | Tool |
|-------------|------|
| Building UI | `Skill: frontend-design` |
| Testing endpoints | `Skill: webapp-testing` |
| Before commits | `Task: code-reviewer agent` |
| Exploring code | `Task: code-explorer agent` |
| Architecture decisions | `Task: Plan agent` |

---

## Important Notes

1. **Architecture Changed**: Evolution API was dropped (its `evolution/` and `cloudflare/` folders were removed). Using Baileys directly.
2. **QR in Browser**: Display QR in web UI, not terminal
3. **n8n Webhook**: Node.js forwards to n8n, returns replies
4. **Human Handoff**: Handled in n8n, Node.js checks `response.skip`
5. **Anti-Ban**: Comprehensive protection built into server

---

## After Making Changes

Update `docs/CLAUDE_SESSION_NOTES.md` with:
- What was accomplished
- Any issues encountered
- Next steps
