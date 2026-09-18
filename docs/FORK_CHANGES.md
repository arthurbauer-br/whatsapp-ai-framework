# What's Different in This Fork

*[Leia em português](./FORK_CHANGES.pt-BR.md)*

This fork adds what a **self-hosted, VPS-based deployment** needs: forcing all
WhatsApp traffic through a residential proxy, a route for sending outbound
messages, and no placeholder replies to real contacts.

Everything else — the anti-ban engine, the admin panel, the n8n webhook
contract — is unchanged from the upstream Community Edition.

---

## Why this fork exists

Running Baileys on a cloud VPS means the WhatsApp WebSocket connects from a
datacenter IP. WhatsApp treats datacenter ranges as a strong signal of
automation, and bans follow — no amount of typing simulation compensates for
the connection itself looking wrong.

The fix is to route the connection through a residential proxy. The catch is
that **Baileys ignores the `HTTP_PROXY` / `HTTPS_PROXY` environment
variables**, so the agents have to be injected into `makeWASocket()` explicitly.

---

## 1. Residential proxy support (fail-closed)

### The part that isn't obvious

Most guides say "pass `agent` and `fetchAgent`, both set to an
`HttpsProxyAgent`". On Baileys v7 that is wrong and will break media transfers.
The two options want **different kinds of object**:

| Option | Expects | Used by | Covers |
|---|---|---|---|
| `agent` | Node `http.Agent` | `ws`, in `lib/Socket/Client/websocket.js` | the WhatsApp WebSocket — the connection WhatsApp actually judges |
| `fetchAgent` | **undici `Dispatcher`** | global `fetch()`, in `lib/Utils/messages-media.js` | media upload |
| `options.dispatcher` | **undici `Dispatcher`** | `getHttpStream()`, same file | media download, app-state sync, history sync |

In v7, `fetchAgent` is passed straight through as the `dispatcher:` option of
the global `fetch()`. Baileys' own source carries the comment
*"custom agents/proxy require undici Agent"*. An `http.Agent` has no `.dispatch`
method, so passing `HttpsProxyAgent` there makes media uploads fail.

Hence two agents from two packages:

```js
const { HttpsProxyAgent } = require('https-proxy-agent');
const { ProxyAgent } = require('undici');

PROXY_WS_AGENT  = new HttpsProxyAgent(PROXY_URL);  // -> agent
PROXY_DISPATCHER = new ProxyAgent(PROXY_URL);      // -> fetchAgent, options.dispatcher
```

Leaving `options.dispatcher` out is the quiet failure mode: the socket is
proxied, but history sync on every reconnect still downloads over the
datacenter IP.

### Fail-closed by design

If `P2SPEED_PROXY` is unset, or the agents cannot be built, **the process exits
instead of connecting**. There is no code path that falls back to a direct
connection.

This is deliberate. A proxy that silently stops being used is worse than one
that was never configured: you keep believing you are protected while every
message leaves through the datacenter IP. If the proxy goes down at runtime,
the WebSocket drops and reconnection keeps failing until it is back.

### Only one socket

`makeWASocket()` is called in exactly one place (`startWhatsApp()`), and
reconnection re-enters that same function, so the proxy applies to reconnects
too.

---

## 2. `POST /api/send` — outbound messages

Upstream is reply-only: it answers people who write in, and has no way to
*initiate* a conversation. This fork adds a route so an external scheduler
(n8n, cron, anything) can trigger a send — renewal reminders, expiry notices,
alerts.

```
POST /api/send
X-N8N-Token: <token>
{ "to": "5551999999999", "message": "...", "kind": "outbound" }
```

`kind` picks which rate-limit budget the send is charged to: `"reply"` for
answering someone who wrote in, anything else (or omitted) for a conversation
you are starting. The default is the stricter budget on purpose — forgetting
the field costs you the tighter limit, never the looser one.

Three decisions worth knowing about:

**It goes through `safeSendMessage()`, not `sock.sendMessage()`.** That means
outbound messages inherit the full anti-ban pipeline — rate limits, human-like
delays, typing simulation — instead of bypassing it. Bulk sending is the
highest-risk thing this framework can do, so it gets the strictest path, not a
shortcut.

**It validates the number with `onWhatsApp()` before sending.** Messaging
numbers that aren't registered is a strong ban signal. This also resolves the
real JID, which matters in Brazil: numbers stored with the 9th digit
(13 digits) resolve to 12-digit JIDs on older accounts. Building the JID by
hand as `number + "@s.whatsapp.net"` sends into the void.

**Rate-limit rejections are visible.** When the anti-ban manager blocks a send
the route returns **429** with the reason and the reset time, rather than
sending anyway or failing silently.

| Status | Meaning |
|---|---|
| `200` | sent — body carries the resolved `jid` and the applied `delay` |
| `400` | missing `to`/`message`, or the number is malformed |
| `403` | bad or missing token (also returned when `N8N_TOKEN` is unset — the route stays disabled) |
| `404` | the number is not on WhatsApp — nothing was sent |
| `429` | anti-ban limit reached — `reason` and `waitTime` say which and for how long |
| `503` | WhatsApp is not connected |

The route is **disabled unless `N8N_TOKEN` is set**, so it cannot be reached by
accident on an existing deployment.

---

## 3. Silence instead of a placeholder reply

Upstream ships a hardcoded trilingual `DEFAULT_REPLY` ("Our AI assistant is
being set up", in English, Mandarin and Malay) that goes out to anyone who
writes in while the n8n webhook is unconfigured.

On a live number that is a real problem: customers get a confusing message in
three languages they may not read, from a business that never wrote it.

`DEFAULT_REPLY` is now an environment variable, empty by default. Empty means
the bot receives the message, logs it, and **sends nothing**. Set
`DEFAULT_REPLY` to opt back into an auto-reply, in your own words.

---

## Configuration

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `P2SPEED_PROXY` | **yes** | — | HTTP proxy URL for all WhatsApp traffic. Missing = the process refuses to start. Supports `http://user:pass@host:port`. |
| `N8N_TOKEN` | no | empty | Shared secret for `POST /api/send`. Empty = the route stays disabled. |
| `DEFAULT_REPLY` | no | empty | Auto-reply used when no n8n webhook is configured. Empty = stay silent. |

New dependencies: `https-proxy-agent` and `undici`.

> The `P2SPEED_PROXY` name comes from the deployment this fork was built for.
> If you are adapting it, rename the constant in `app/server.js` — just don't
> switch to `HTTP_PROXY`, which is the variable Baileys ignores and the reason
> this fork exists.

---

## Coming from upstream

Three things change behaviour and may surprise you:

1. **The bot will not start without `P2SPEED_PROXY`.** This is the fail-closed
   policy, not a bug. Set it, or remove the guard in `app/server.js` if you are
   running somewhere a residential IP isn't needed.

2. **`npm install` is required again** — two new dependencies. If you deploy
   with Docker, rebuild the image; a container restart won't pick them up.

3. **The default reply is gone.** Unconfigured means silent now. Set
   `DEFAULT_REPLY` if you want the old behaviour, with your own text.

Nothing else changed: the anti-ban module, the webhook payload, the admin panel
and the other 16 API routes are untouched.

---

## Credits

Forked from the **WhatsApp AI Framework (Community Edition)** by
[GX Automation Tech](https://gxautomation.tech). The anti-ban engine, admin
panel and n8n architecture are theirs; this fork adds proxy egress, outbound
sending and the silent default.

The ban-risk warning in the main README applies to this fork exactly as it does
upstream. A residential proxy lowers one specific risk factor. It is not
immunity.
