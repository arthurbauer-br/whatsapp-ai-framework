# O que muda neste fork

*[Read in English](./FORK_CHANGES.md)*

Este fork acrescenta o que uma instalação **própria, rodando em VPS**, precisa:
forçar todo o tráfego do WhatsApp por um proxy residencial, uma rota para
enviar mensagens ativas, e nenhuma resposta genérica indo para cliente real.

O resto — o motor anti-ban, o painel administrativo, o contrato do webhook do
n8n — está igual ao projeto original.

---

## Por que este fork existe

Rodar o Baileys numa VPS significa que o WebSocket do WhatsApp conecta a partir
de um IP de datacenter. O WhatsApp trata essas faixas de IP como forte indício
de automação, e o banimento vem — nenhuma simulação de digitação compensa a
conexão em si parecer errada.

A solução é rotear a conexão por um proxy residencial. O problema é que o
**Baileys ignora as variáveis de ambiente `HTTP_PROXY` e `HTTPS_PROXY`**, então
os agents precisam ser injetados explicitamente no `makeWASocket()`.

---

## 1. Suporte a proxy residencial (fail-closed)

### A parte que não é óbvia

A maioria dos tutoriais diz "passe `agent` e `fetchAgent`, os dois com um
`HttpsProxyAgent`". No Baileys v7 isso está errado e quebra a transferência de
mídia. As duas opções esperam **tipos de objeto diferentes**:

| Opção | Espera | Usado por | Cobre |
|---|---|---|---|
| `agent` | `http.Agent` do Node | `ws`, em `lib/Socket/Client/websocket.js` | o WebSocket do WhatsApp — a conexão que o WhatsApp de fato avalia |
| `fetchAgent` | **`Dispatcher` do undici** | `fetch()` global, em `lib/Utils/messages-media.js` | upload de mídia |
| `options.dispatcher` | **`Dispatcher` do undici** | `getHttpStream()`, no mesmo arquivo | download de mídia, app-state sync, history sync |

Na v7, o `fetchAgent` é repassado direto como a opção `dispatcher:` do `fetch()`
global. O próprio código do Baileys traz o comentário
*"custom agents/proxy require undici Agent"*. Um `http.Agent` não tem método
`.dispatch`, então passar `HttpsProxyAgent` ali faz o upload de mídia falhar.

Daí dois agents, de dois pacotes:

```js
const { HttpsProxyAgent } = require('https-proxy-agent');
const { ProxyAgent } = require('undici');

PROXY_WS_AGENT  = new HttpsProxyAgent(PROXY_URL);  // -> agent
PROXY_DISPATCHER = new ProxyAgent(PROXY_URL);      // -> fetchAgent, options.dispatcher
```

Deixar o `options.dispatcher` de fora é a falha silenciosa: o socket vai pelo
proxy, mas o history sync, que roda a cada reconexão, continua baixando pelo IP
do datacenter.

### Fail-closed por decisão de projeto

Se o `P2SPEED_PROXY` não estiver definido, ou se os agents não puderem ser
construídos, **o processo encerra em vez de conectar**. Não existe caminho no
código que caia para conexão direta.

Isso é proposital. Um proxy que silenciosamente deixa de ser usado é pior do
que um que nunca foi configurado: você segue achando que está protegido
enquanto cada mensagem sai pelo IP do datacenter. Se o proxy cair em operação,
o WebSocket cai junto e a reconexão continua falhando até ele voltar.

### Um socket só

O `makeWASocket()` é chamado em um único lugar (`startWhatsApp()`), e a
reconexão chama essa mesma função — então o proxy vale também nas reconexões.

---

## 2. `POST /api/send` — mensagens ativas

O projeto original só responde: ele atende quem escreve, mas não tem como
**iniciar** uma conversa. Este fork adiciona uma rota para que um agendador
externo (n8n, cron, qualquer coisa) dispare um envio — aviso de vencimento,
lembrete de renovação, alerta.

```
POST /api/send
X-N8N-Token: <token>
{ "to": "5551999999999", "message": "..." }
```

Três decisões que vale conhecer:

**Passa pelo `safeSendMessage()`, não pelo `sock.sendMessage()` cru.** Assim as
mensagens ativas herdam todo o pipeline anti-ban — limites de taxa, atrasos
humanizados, simulação de digitação — em vez de contorná-lo. Disparo em massa é
a coisa de maior risco que este framework faz, então ganha o caminho mais
rígido, não um atalho.

**Valida o número com `onWhatsApp()` antes de enviar.** Mandar mensagem para
número não registrado é sinal forte de ban. Isso também resolve o JID real, o
que importa no Brasil: números gravados com o nono dígito (13 dígitos) resolvem
para JIDs de 12 dígitos em contas antigas. Montar o JID na mão como
`numero + "@s.whatsapp.net"` manda a mensagem para o vazio.

**Bloqueio por limite é visível.** Quando o anti-ban barra um envio, a rota
devolve **429** com o motivo e o tempo de reset, em vez de mandar assim mesmo
ou falhar em silêncio.

| Status | Significado |
|---|---|
| `200` | enviado — o corpo traz o `jid` resolvido e o `delay` aplicado |
| `400` | falta `to`/`message`, ou o número está malformado |
| `403` | token errado ou ausente (também quando `N8N_TOKEN` não existe — a rota fica desligada) |
| `404` | o número não está no WhatsApp — nada foi enviado |
| `429` | limite do anti-ban atingido — `reason` e `waitTime` dizem qual e por quanto tempo |
| `503` | WhatsApp desconectado |

A rota fica **desligada enquanto `N8N_TOKEN` não existir**, então não há como
alcançá-la por acidente numa instalação já em uso.

---

## 3. Silêncio no lugar da resposta genérica

O projeto original traz um `DEFAULT_REPLY` fixo e trilíngue ("Our AI assistant
is being set up", em inglês, mandarim e malaio) que é enviado a qualquer pessoa
que escreva enquanto o webhook do n8n não está configurado.

Num número em produção isso é um problema real: o cliente recebe uma mensagem
confusa, em três idiomas que talvez nem leia, de uma empresa que nunca a
escreveu.

O `DEFAULT_REPLY` agora é variável de ambiente, vazia por padrão. Vazia
significa que o bot recebe a mensagem, registra no log e **não envia nada**.
Defina `DEFAULT_REPLY` para ter resposta automática de volta, com o seu texto.

---

## Configuração

| Variável | Obrigatória | Padrão | Para que serve |
|---|---|---|---|
| `P2SPEED_PROXY` | **sim** | — | URL do proxy HTTP para todo o tráfego do WhatsApp. Ausente = o processo não sobe. Aceita `http://usuario:senha@host:porta`. |
| `N8N_TOKEN` | não | vazio | Segredo compartilhado do `POST /api/send`. Vazio = rota desligada. |
| `DEFAULT_REPLY` | não | vazio | Resposta automática usada quando não há webhook do n8n. Vazio = silêncio. |

Dependências novas: `https-proxy-agent` e `undici`.

> O nome `P2SPEED_PROXY` vem da instalação para a qual este fork foi feito. Se
> for adaptar, renomeie a constante em `app/server.js` — só não troque por
> `HTTP_PROXY`, que é justamente a variável que o Baileys ignora e a razão de
> este fork existir.

---

## Vindo do projeto original

Três coisas mudam de comportamento e podem te pegar de surpresa:

1. **O bot não sobe sem `P2SPEED_PROXY`.** É a política fail-closed, não um
   defeito. Defina a variável, ou remova a checagem no `app/server.js` se você
   roda num lugar onde IP residencial não é necessário.

2. **Precisa rodar `npm install` de novo** — duas dependências novas. Se você
   sobe por Docker, refaça a imagem; reiniciar o container não pega.

3. **A resposta padrão acabou.** Sem configuração agora significa silêncio.
   Defina `DEFAULT_REPLY` se quiser o comportamento antigo, com o seu texto.

Nada mais mudou: o módulo anti-ban, o payload do webhook, o painel e as outras
16 rotas da API estão intactos.

---

## Créditos

Fork do **WhatsApp AI Framework (Community Edition)**, da
[GX Automation Tech](https://gxautomation.tech). O motor anti-ban, o painel
administrativo e a arquitetura com n8n são deles; este fork acrescenta a saída
por proxy, o envio ativo e o silêncio por padrão.

O aviso de risco de banimento do README principal vale para este fork
exatamente como vale para o original. Um proxy residencial reduz um fator de
risco específico. Não é imunidade.
