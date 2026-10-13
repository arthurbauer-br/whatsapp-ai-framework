# Protocolo anti-ban do WhatsApp

*[Read in English](./ANTI_BAN_PROTOCOL.md)*

> **Versão:** 1.0
> **Última atualização:** 17 de dezembro de 2025
> **Finalidade:** estratégias de redução de risco para automação de WhatsApp com Baileys

---

## Sumário

1. [Por que contas são banidas](#1-por-que-contas-são-banidas)
2. [Sistema de atrasos humanizados](#2-sistema-de-atrasos-humanizados)
3. [Configuração do limite de taxa](#3-configuração-do-limite-de-taxa)
4. [Simulação do indicador de digitação](#4-simulação-do-indicador-de-digitação)
5. [Protocolo de aquecimento da conta](#5-protocolo-de-aquecimento-da-conta)
6. [Requisitos do perfil](#6-requisitos-do-perfil)
7. [Módulo anti-ban em JavaScript](#7-módulo-anti-ban-em-javascript)
8. [Checklist de entrada do cliente](#8-checklist-de-entrada-do-cliente)
9. [Estratégias de redução de risco](#9-estratégias-de-redução-de-risco)
10. [Monitoramento e sinais de alerta](#10-monitoramento-e-sinais-de-alerta)

---

## 1. Por que contas são banidas

Os sistemas de detecção do WhatsApp marcam contas com base em vários padrões de comportamento:

### Comportamentos de alto risco
| Comportamento | Nível de risco | Método de detecção |
|---------------|----------------|--------------------|
| Respostas instantâneas (<1 segundo) | **Crítico** | Análise de tempo |
| Mensagens idênticas para muitos usuários | **Crítico** | Hash do conteúdo |
| Alto volume de mensagens (>100/hora) | **Alto** | Monitoramento de taxa |
| Conta nova + muita atividade | **Alto** | Relação idade/atividade |
| Sem foto de perfil/recado | **Médio** | Perfil incompleto |
| Mensagens para quem não é contato | **Médio** | Relação de contato |
| Envio só em horários estranhos | **Baixo** | Padrão de atividade |

### O fator idade da conta
```
Conta nova (0-7 dias):     RISCO EXTREMO - automação mínima
Semanas 2-4:               RISCO ALTO - só automação leve
Meses 2-3:                 RISCO MÉDIO - automação moderada
Mês 4 em diante:           RISCO MENOR - automação completa possível
```

### Tipos de banimento
1. **Banimento temporário (24-72 horas)**: primeira infração, geralmente recuperável
2. **Banimento prolongado (2 semanas)**: infrações repetidas
3. **Banimento permanente**: infrações graves ou várias infrações

---

## 2. Sistema de atrasos humanizados

### Fórmula do atraso
```javascript
// Atraso base: 1-3 segundos no mínimo
// Tempo de leitura: ~200ms por palavra da mensagem recebida
// Tempo de digitação: ~50ms por caractere da resposta
// Variação aleatória: +/- 30%

function calculateHumanDelay(incomingMessage, outgoingReply) {
    const readingTime = incomingMessage.split(' ').length * 200;
    const typingTime = outgoingReply.length * 50;
    const baseDelay = Math.random() * 2000 + 1000; // 1-3 segundos

    const totalDelay = baseDelay + readingTime + typingTime;
    const variance = totalDelay * (Math.random() * 0.6 - 0.3); // +/- 30%

    return Math.floor(totalDelay + variance);
}
```

### Faixas de atraso recomendadas
| Tamanho da mensagem | Atraso mínimo | Atraso máximo |
|---------------------|---------------|---------------|
| Curta (1-5 palavras) | 2 segundos | 5 segundos |
| Média (6-20 palavras) | 4 segundos | 10 segundos |
| Longa (21-50 palavras) | 8 segundos | 20 segundos |
| Muito longa (50+ palavras) | 15 segundos | 45 segundos |

### Ajustes por horário do dia
```javascript
function getTimeMultiplier() {
    const hour = new Date().getHours();

    if (hour >= 0 && hour < 6) return 2.0;   // Madrugada: mais lento
    if (hour >= 6 && hour < 9) return 1.3;   // Começo da manhã: mais lento
    if (hour >= 9 && hour < 12) return 1.0;  // Manhã: normal
    if (hour >= 12 && hour < 14) return 1.2; // Almoço: um pouco mais lento
    if (hour >= 14 && hour < 18) return 1.0; // Tarde: normal
    if (hour >= 18 && hour < 22) return 1.1; // Começo da noite: um pouco mais lento
    return 1.5;                               // Noite: mais lento
}
```

---

## 3. Configuração do limite de taxa

### Limites por hora conforme a idade da conta
| Idade da conta | Mensagens/hora | Conversas distintas/hora |
|----------------|----------------|--------------------------|
| Semana 1 | 10-15 | 5-8 |
| Semanas 2-4 | 20-30 | 10-15 |
| Meses 2-3 | 40-60 | 20-30 |
| Mês 4 em diante | 80-100 | 40-50 |

### Limites diários
```javascript
const DAILY_LIMITS = {
    week1: { messages: 50, uniqueChats: 20 },
    week2to4: { messages: 150, uniqueChats: 50 },
    month2to3: { messages: 300, uniqueChats: 100 },
    month4plus: { messages: 500, uniqueChats: 200 }
};
```

### Períodos de pausa
```javascript
const COOLDOWN_CONFIG = {
    afterBurst: 300000,        // 5 minutos depois de 10+ mensagens em 5 min
    afterNewContact: 60000,    // 1 minuto depois de escrever para contato novo
    afterMedia: 30000,         // 30 segundos depois de enviar mídia
    betweenChats: 5000,        // 5 segundos entre conversas diferentes
    hourlyReset: 3600000       // Zera os contadores a cada hora
};
```

---

## 4. Simulação do indicador de digitação

### Implementação
```javascript
async function simulateTyping(socket, jid, messageLength) {
    // Calcula uma duração de digitação realista
    const typingSpeed = 40 + Math.random() * 20; // 40-60 caracteres/segundo
    const thinkingTime = 1000 + Math.random() * 2000; // 1-3 segundos
    const typingDuration = (messageLength / typingSpeed) * 1000;

    // Liga o indicador de digitação
    await socket.sendPresenceUpdate('composing', jid);

    // Simula pausas em mensagens longas (paradas para pensar)
    if (messageLength > 100) {
        const pauseCount = Math.floor(messageLength / 100);
        const segmentTime = typingDuration / (pauseCount + 1);

        for (let i = 0; i < pauseCount; i++) {
            await delay(segmentTime);
            await socket.sendPresenceUpdate('paused', jid);
            await delay(500 + Math.random() * 1000);
            await socket.sendPresenceUpdate('composing', jid);
        }
        await delay(segmentTime);
    } else {
        await delay(thinkingTime + typingDuration);
    }

    // Desliga o indicador de digitação
    await socket.sendPresenceUpdate('paused', jid);
}
```

### Atualizações de presença
```javascript
// Estados de presença disponíveis
'available'   // Online
'unavailable' // Offline
'composing'   // Digitando...
'paused'      // Parou de digitar
'recording'   // Gravando áudio
```

---

## 5. Protocolo de aquecimento da conta

### Fase 1: dias 1-3 (só uso manual)
- [ ] Completar o perfil (foto, nome, status, recado)
- [ ] Adicionar 10-20 contatos manualmente
- [ ] Mandar mensagens manuais para amigos e família
- [ ] Entrar em 2-3 grupos
- [ ] **NENHUMA automação**

### Fase 2: dias 4-7 (automação mínima)
- [ ] Ligar o bot **só para 3-5 contatos de confiança**
- [ ] No máximo 20 mensagens/dia
- [ ] Só responder mensagens recebidas (nada de envio ativo)
- [ ] Ficar atento a qualquer aviso ou restrição
- [ ] Interação manual: 30% da atividade

### Fase 3: semana 2 (automação leve)
- [ ] Ampliar para 10-15 contatos
- [ ] No máximo 50 mensagens/dia
- [ ] Ligar a resposta automática só no horário comercial
- [ ] Manter interação manual: 20% da atividade

### Fase 4: semanas 3-4 (automação moderada)
- [ ] Ampliar para 25-30 contatos
- [ ] No máximo 100 mensagens/dia
- [ ] Ligar a resposta automática 12 horas por dia
- [ ] Manter interação manual: 10% da atividade

### Fase 5: mês 2 em diante (automação completa)
- [ ] Aumentar aos poucos até a capacidade total
- [ ] No máximo 300-500 mensagens/dia
- [ ] Disponibilidade 24/7 (com limite de taxa)
- [ ] Recomenda-se uma conferência manual por semana

---

## 6. Requisitos do perfil

### Configuração obrigatória
```
[x] Foto de perfil      - Foto real, não logotipo (em contas pessoais)
[x] Nome de exibição    - Nome completo, não o nome da empresa no início
[x] Recado/status       - Algo pessoal, não promocional
[x] Privacidade         - Padrão (não "Ninguém")
```

### Considerações sobre conta comercial
| Fator | Número pessoal | WhatsApp Business |
|-------|----------------|-------------------|
| Risco de detecção | Menor no início | Monitoramento um pouco maior |
| Recursos | Básicos | Catálogo, etiquetas, respostas rápidas |
| Recomendação | Usar nos primeiros 30 dias | Migrar depois do aquecimento |

### Publicações no status
Publique no status de vez em quando (1-2 vezes por semana) durante o aquecimento:
- Fotos pessoais
- Conteúdo não promocional
- Interaja com o status dos outros

---

## 7. Módulo anti-ban em JavaScript

### Implementação completa

```javascript
// Arquivo: app/src/utils/anti-ban.js

const RATE_LIMITS = {
    messagesPerHour: 50,
    messagesPerDay: 300,
    uniqueChatsPerHour: 25,
    uniqueChatsPerDay: 100
};

const DELAY_CONFIG = {
    minDelay: 2000,           // 2 segundos no mínimo
    maxDelay: 45000,          // 45 segundos no máximo
    readingSpeedMs: 200,      // ms por palavra para "ler"
    typingSpeedMs: 50,        // ms por caractere para "digitar"
    varianceFactor: 0.3       // +/- 30% de aleatoriedade
};

class AntiBanManager {
    constructor() {
        this.messageCount = { hour: 0, day: 0 };
        this.chatCount = { hour: new Set(), day: new Set() };
        this.lastMessageTime = 0;
        this.lastHourReset = Date.now();
        this.lastDayReset = Date.now();
    }

    // Zera os contadores periodicamente
    checkAndResetCounters() {
        const now = Date.now();

        if (now - this.lastHourReset > 3600000) {
            this.messageCount.hour = 0;
            this.chatCount.hour.clear();
            this.lastHourReset = now;
        }

        if (now - this.lastDayReset > 86400000) {
            this.messageCount.day = 0;
            this.chatCount.day.clear();
            this.lastDayReset = now;
        }
    }

    // Confere se dá para enviar uma mensagem
    canSendMessage(chatId) {
        this.checkAndResetCounters();

        if (this.messageCount.hour >= RATE_LIMITS.messagesPerHour) {
            return { allowed: false, reason: 'Hourly message limit reached', waitTime: this.getHourlyResetTime() };
        }

        if (this.messageCount.day >= RATE_LIMITS.messagesPerDay) {
            return { allowed: false, reason: 'Daily message limit reached', waitTime: this.getDailyResetTime() };
        }

        if (!this.chatCount.hour.has(chatId) && this.chatCount.hour.size >= RATE_LIMITS.uniqueChatsPerHour) {
            return { allowed: false, reason: 'Hourly unique chat limit reached', waitTime: this.getHourlyResetTime() };
        }

        return { allowed: true };
    }

    // Calcula um atraso humanizado
    calculateDelay(incomingMessage, outgoingReply) {
        const wordCount = incomingMessage.split(/\s+/).length;
        const readingTime = wordCount * DELAY_CONFIG.readingSpeedMs;
        const typingTime = outgoingReply.length * DELAY_CONFIG.typingSpeedMs;

        let baseDelay = DELAY_CONFIG.minDelay + readingTime + typingTime;

        // Aplica o multiplicador do horário do dia
        baseDelay *= this.getTimeMultiplier();

        // Aplica a variação aleatória
        const variance = baseDelay * DELAY_CONFIG.varianceFactor;
        baseDelay += (Math.random() * 2 - 1) * variance;

        // Limita ao mínimo/máximo
        return Math.max(DELAY_CONFIG.minDelay, Math.min(DELAY_CONFIG.maxDelay, Math.floor(baseDelay)));
    }

    // Multiplicador por horário do dia, para padrões mais naturais
    getTimeMultiplier() {
        const hour = new Date().getHours();
        if (hour >= 0 && hour < 6) return 2.0;
        if (hour >= 6 && hour < 9) return 1.3;
        if (hour >= 9 && hour < 12) return 1.0;
        if (hour >= 12 && hour < 14) return 1.2;
        if (hour >= 14 && hour < 18) return 1.0;
        if (hour >= 18 && hour < 22) return 1.1;
        return 1.5;
    }

    // Registra uma mensagem enviada
    recordMessage(chatId) {
        this.messageCount.hour++;
        this.messageCount.day++;
        this.chatCount.hour.add(chatId);
        this.chatCount.day.add(chatId);
        this.lastMessageTime = Date.now();
    }

    // Tempo que falta até zerar o contador da hora
    getHourlyResetTime() {
        return Math.max(0, 3600000 - (Date.now() - this.lastHourReset));
    }

    // Tempo que falta até zerar o contador do dia
    getDailyResetTime() {
        return Math.max(0, 86400000 - (Date.now() - this.lastDayReset));
    }

    // Estatísticas atuais
    getStats() {
        this.checkAndResetCounters();
        return {
            messagesThisHour: this.messageCount.hour,
            messagesThisDay: this.messageCount.day,
            uniqueChatsThisHour: this.chatCount.hour.size,
            uniqueChatsThisDay: this.chatCount.day.size,
            limits: RATE_LIMITS
        };
    }
}

// Utilitário de espera
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Simulação de digitação
async function simulateTyping(socket, jid, messageLength) {
    const typingSpeed = 40 + Math.random() * 20;
    const thinkingTime = 1000 + Math.random() * 2000;
    const typingDuration = (messageLength / typingSpeed) * 1000;

    await socket.sendPresenceUpdate('composing', jid);

    if (messageLength > 100) {
        const pauseCount = Math.floor(messageLength / 100);
        const segmentTime = typingDuration / (pauseCount + 1);

        for (let i = 0; i < pauseCount; i++) {
            await delay(segmentTime);
            await socket.sendPresenceUpdate('paused', jid);
            await delay(500 + Math.random() * 1000);
            await socket.sendPresenceUpdate('composing', jid);
        }
        await delay(segmentTime);
    } else {
        await delay(thinkingTime + typingDuration);
    }

    await socket.sendPresenceUpdate('paused', jid);
}

// Envio seguro, com todas as proteções
async function safeSendMessage(socket, jid, message, incomingText, antiBanManager) {
    // Confere os limites de taxa
    const canSend = antiBanManager.canSendMessage(jid);
    if (!canSend.allowed) {
        console.log(`[RATE LIMIT] ${canSend.reason}. Wait ${Math.ceil(canSend.waitTime / 1000)}s`);
        return { sent: false, reason: canSend.reason };
    }

    // Calcula e aplica o atraso
    const messageText = typeof message === 'string' ? message : message.text || '';
    const delayMs = antiBanManager.calculateDelay(incomingText, messageText);

    console.log(`[ANTI-BAN] Waiting ${delayMs}ms before reply...`);

    // Simula a digitação
    await simulateTyping(socket, jid, messageText.length);

    // Espera adicional depois da digitação
    await delay(delayMs - (messageText.length * 50));

    // Envia a mensagem
    await socket.sendMessage(jid, message);

    // Registra a mensagem
    antiBanManager.recordMessage(jid);

    return { sent: true, delay: delayMs };
}

module.exports = {
    AntiBanManager,
    delay,
    simulateTyping,
    safeSendMessage,
    RATE_LIMITS,
    DELAY_CONFIG
};
```

### Exemplo de uso

```javascript
const { AntiBanManager, safeSendMessage } = require('./utils/anti-ban');

const antiBan = new AntiBanManager();

// No seu tratador de mensagens
sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    const incomingText = msg.message.conversation ||
                         msg.message.extendedTextMessage?.text || '';

    // Busca a resposta da IA no n8n
    const response = await fetch(N8N_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: incomingText, from })
    });
    const { reply } = await response.json();

    // Envia com a proteção anti-ban
    const result = await safeSendMessage(sock, from, { text: reply }, incomingText, antiBan);

    if (!result.sent) {
        console.log(`Message queued or skipped: ${result.reason}`);
    }
});
```

---

## 8. Checklist de entrada do cliente

### Antes da implantação (responsabilidade do cliente)
```markdown
## Formulário de entrada do cliente

**Dados do número de telefone:**
- [ ] Idade do número: _____ meses
- [ ] O WhatsApp já foi usado neste número antes? Sim / Não
- [ ] Este número já foi banido antes? Sim / Não

**Configuração da conta (OBRIGATÓRIA antes da automação):**
- [ ] Foto de perfil enviada (foto real, não logotipo)
- [ ] Nome de exibição definido (nome completo)
- [ ] Recado/status escrito (não promocional)
- [ ] 10+ contatos salvos no celular
- [ ] Ativo em 2+ grupos
- [ ] Conversas manuais: _____ nos últimos 7 dias

**Acordo sobre o período de aquecimento:**
- [ ] Semana 1: só uso manual (sem bot)
- [ ] Semanas 2-4: bot limitado (no máximo 50 mensagens/dia)
- [ ] Mês 2 em diante: bot completo

**Assinatura do cliente: _______________ Data: ___________
```

### Etapas da implantação
1. **Dia 0**: completar o checklist do cliente e conferir o histórico do número
2. **Dias 1-3**: o cliente usa o WhatsApp manualmente, nós monitoramos
3. **Dia 4**: instalar o bot em "modo passivo" (só registra)
4. **Dia 7**: ligar as respostas para 5 contatos de teste de confiança
5. **Dia 14**: ampliar para 15 contatos
6. **Dia 21**: ampliar para 30 contatos
7. **Dia 30**: implantação completa, com limite de taxa

---

## 9. Estratégias de redução de risco

### Diretrizes de conteúdo das mensagens
| Faça | Não faça |
|------|----------|
| Personalize cada resposta | Mandar mensagens idênticas |
| Use variações naturais de linguagem | Repetir o mesmo texto pronto |
| Deixe um erro de digitação de vez em quando | Gramática perfeita sempre |
| Varie o tamanho das respostas | Respostas sempre do mesmo tamanho |
| Use emoji com naturalidade | Padrões exagerados de emoji |

### Diretrizes de comportamento
| Faça | Não faça |
|------|----------|
| Responda só mensagens recebidas | Iniciar disparos em massa |
| Mantenha um horário de atendimento | Respostas instantâneas 24/7 |
| Pause nos fins de semana de vez em quando | Disponibilidade sem parar |
| Alterne entre online e offline | Ficar sempre online |
| Demore na primeira resposta a conversas novas | Responder estranhos na hora |

### Exemplos de variação de mensagem
```javascript
const greetingVariations = [
    "Oi! Como posso ajudar hoje?",
    "Olá! Em que posso ajudar?",
    "Oi, tudo bem? Como posso te ajudar?",
    "Oi, obrigado pelo contato! Como posso ajudar?",
    "Olá! Obrigado pela mensagem. Do que você precisa?"
];

function getRandomGreeting() {
    return greetingVariations[Math.floor(Math.random() * greetingVariations.length)];
}
```

---

## 10. Monitoramento e sinais de alerta

### Sinais de alerta para observar
| Sinal | Nível de risco | Ação |
|-------|----------------|------|
| Erro "Tente novamente mais tarde" | Médio | Pausar 1-2 horas |
| Pedido para ler o QR de novo | Alto | Reduzir o volume em 50% |
| Mensagens não são entregues | Alto | Pausar 24 horas |
| Aviso de restrição temporária | Crítico | Pausar 72 horas |
| Aviso de análise da conta | Crítico | Parar toda a automação |

### Rotas de verificação de saúde
```javascript
// Acrescente ao seu servidor Express
app.get('/api/anti-ban/stats', (req, res) => {
    res.json(antiBanManager.getStats());
});

app.get('/api/anti-ban/health', (req, res) => {
    const stats = antiBanManager.getStats();
    const hourlyUsage = (stats.messagesThisHour / RATE_LIMITS.messagesPerHour) * 100;
    const dailyUsage = (stats.messagesThisDay / RATE_LIMITS.messagesPerDay) * 100;

    res.json({
        status: hourlyUsage > 80 || dailyUsage > 80 ? 'warning' : 'healthy',
        hourlyUsage: `${hourlyUsage.toFixed(1)}%`,
        dailyUsage: `${dailyUsage.toFixed(1)}%`,
        recommendations: hourlyUsage > 80 ? ['Consider reducing automation'] : []
    });
});
```

### Checklist diário de monitoramento
- [ ] Conferir a taxa de entrega das mensagens
- [ ] Revisar as estatísticas de limite de taxa
- [ ] Confirmar que não há mensagens de aviso
- [ ] Conferir a estabilidade da conexão
- [ ] Revisar os padrões de tempo de resposta

---

## Apêndice: cartão de referência rápida

```
+--------------------------------------------------+
|           ANTI-BAN — REFERÊNCIA RÁPIDA           |
+--------------------------------------------------+
| ATRASOS:                                         |
|   Mín.: 2 segundos | Máx.: 45 segundos           |
|   Fórmula: leitura + digitação + variação        |
+--------------------------------------------------+
| LIMITES DE TAXA:                                 |
|   Por hora: 50 mensagens, 25 conversas           |
|   Por dia: 300 mensagens, 100 conversas          |
+--------------------------------------------------+
| AQUECIMENTO:                                     |
|   Semana 1: só manual (0 mensagens do bot)       |
|   Semanas 2-4: no máximo 50 msgs/dia             |
|   Mês 2 em diante: capacidade total              |
+--------------------------------------------------+
| PERFIL:                                          |
|   - Foto real                                    |
|   - Nome completo                                |
|   - Recado não promocional                       |
|   - 10+ contatos                                 |
+--------------------------------------------------+
| SINAIS DE ALERTA:                                |
|   - "Tente mais tarde" = PAUSAR 1-2 horas        |
|   - Ler o QR de novo = REDUZIR 50%               |
|   - Análise da conta = PARAR TUDO                |
+--------------------------------------------------+
```

---

## Histórico do documento

| Versão | Data | Alterações |
|--------|------|------------|
| 1.0 | 17/12/2025 | Documentação inicial |

---

**Aviso**: os Termos de Serviço do WhatsApp proíbem mensagens automatizadas. Esta documentação tem fins educativos. Use por sua conta e risco. Aplicar estes protocolos reduz, mas não elimina, o risco de banimento.
