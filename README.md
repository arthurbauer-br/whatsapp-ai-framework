# WhatsApp AI Framework (Community Edition)

> **A production-ready WhatsApp automation framework featuring Anti-Ban protection, n8n integration, and RAG support.**

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Status](https://img.shields.io/badge/status-stable-green.svg)
![Node](https://img.shields.io/badge/node-v18%2B-green)

> ### 🔀 This is a fork
>
> Built for **self-hosted VPS deployments**. It adds three things to the
> upstream project:
>
> - **Residential proxy egress**, injected into Baileys the way v7 actually
>   requires — and fail-closed, so the bot refuses to start rather than connect
>   from a datacenter IP.
> - **`POST /api/send`**, so an external scheduler can send outbound messages
>   through the anti-ban pipeline instead of bypassing it.
> - **Silence when unconfigured**, replacing the hardcoded placeholder reply
>   that went out to real contacts.
>
> Full details, including the Baileys v7 `agent` vs `fetchAgent` gotcha that
> costs people their media transfers: **[What's different in this fork](./docs/FORK_CHANGES.md)** · **[Em português](./docs/FORK_CHANGES.pt-BR.md)**

**Upstream:** this project is a fork of the open-source community edition of the internal framework built by [GX Automation Tech](https://gxautomation.tech). The anti-ban engine, admin panel and n8n architecture are theirs. For enterprise-grade, fully compliant WhatsApp solutions (Green Tick verification), contact them about their official **respond.io** implementation services.

---

## ⚠️ Disclaimer & Risk Warning

**This project uses the unofficial WhatsApp Web API (`@whiskeysockets/baileys`).**

1.  **Ban Risk:** Using this library creates a risk of your WhatsApp phone number being permanently banned.
2.  **Anti-Ban Logic:** While this project includes sophisticated "human-like" behavior simulation (variable typing delays, rate limiting, sleep cycles), **no protection is 100% foolproof**.
3.  **Liability:** The authors are not responsible for any banned numbers, lost data, or business interruption resulting from the use of this software.
4.  **Recommendation:** For business-critical numbers, use the official [WhatsApp Business API](https://developers.facebook.com/docs/whatsapp) (or our managed service).

---

## 🌟 Key Features

*   **🛡️ Advanced Anti-Ban System:**
    *   **Variable Delays:** Calculates "human reading time" + "typing time" before replying.
    *   **Typing Simulation:** Shows "Typing..." status to the user during the delay.
    *   **Rate Limiting:** configurable limits (e.g., max 50 msgs/hour) with visual health bars.
    *   **Time-of-Day Logic:** Slower response times at night to mimic human sleep cycles.
*   **🧠 n8n Integration:**
    *   Offload all logic to n8n (Visual Workflow Editor).
    *   Supports OpenAI, Google Gemini, Anthropic, or Local LLMs via n8n.
    *   Supports RAG (Retrieval Augmented Generation) for Knowledge Base lookups.
*   **🔌 Plug-and-Play Architecture:** Built on Node.js + Express.
*   **📊 Web Admin Panel:**
    *   Scan QR Codes directly in the browser.
    *   Real-time connection status.
    *   Live Activity Logs.
    *   Dynamic Configuration (Update Webhook URLs without restarting).
*   **🌍 Multi-Language Support:** Ready for English, Bahasa Malaysia, and Mandarin.

---

## 📋 Prerequisites

Before you begin, ensure you have:

1.  **Node.js (v18 or higher):** [Download Here](https://nodejs.org/)
2.  **n8n Instance:**
    *   **Cloud:** [Sign up for n8n Cloud](https://n8n.io/) (Easiest)
    *   **Self-Hosted:** `npm install n8n -g` (Free)
3.  **A WhatsApp Number:** We recommend using a secondary number for testing first.

---

## 🚀 Installation & Setup Guide

### Step 1: Install the Bot

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/arthurbauer-br/whatsapp-ai-framework.git
    cd whatsapp-ai-framework
    ```

2.  **Install dependencies:**
    ```bash
    cd app
    npm install
    ```

3.  **Set the required proxy variable.** This fork will not start without it —
    see [FORK_CHANGES.md](./docs/FORK_CHANGES.md#1-residential-proxy-support-fail-closed)
    for why.
    ```bash
    cp .env.example .env
    # then edit .env and set P2SPEED_PROXY=http://your-proxy-host:port
    ```

4.  **Start the Server:**
    ```bash
    npm start
    ```
    You will see a message: `🌐 Web UI: http://localhost:3000`

---

### Step 2: Configure the "Brain" (n8n)

This bot needs a "brain" to decide what to say. We use **n8n** for this.

1.  **Open n8n:** Go to your n8n dashboard.
2.  **Import Workflow:**
    *   Click **Add Workflow** > **Import from File**.
    *   Select `n8n-workflows/advanced-chat-gemini.json` from this project folder.
3.  **Configure Credentials:**
    *   Double-click the **Google Gemini** node (or OpenAI node).
    *   Select "Create New Credential" and paste your API Key.
4.  **Activate the Webhook:**
    *   Double-click the **Webhook** node.
    *   Ensure "HTTP Method" is `POST`.
    *   **IMPORTANT:** If you are running the bot locally and n8n in the cloud, n8n gives you a URL like `https://your-n8n.cloud/webhook/whatsapp-webhook`. Copy this URL.
    *   *Note: If running n8n locally, use a tunnel like `ngrok` or `tunnelmole` to make it accessible.*
5.  **Save & Activate:** Click **Save** and toggle **Active** to true.

---

### Step 3: Connect the Bot to the Brain

1.  Open the **Bot Admin Panel** at `http://localhost:3000`.
2.  Scroll down to the **AI Configuration** card.
3.  Paste your **n8n Webhook URL** (from Step 2) into the input field.
4.  Click **Save Webhook URL**.
    *   *This saves the URL to `settings.json`, so it persists even if you restart.*

---

### Step 4: Connect WhatsApp

1.  In the Admin Panel, look at the **Connection Info** card.
2.  Click the green **Connect** button.
3.  Wait a moment for the **QR Code** to appear.
4.  Open WhatsApp on your phone:
    *   **iOS:** Settings > Linked Devices > Link a Device.
    *   **Android:** Three dots > Linked Devices > Link a Device.
5.  Scan the QR code.
6.  The status should change to **Connected** (Green).

🎉 **Your bot is now live!** Send a message to your WhatsApp number from a different phone to test it.

---

## 🛡️ Anti-Ban Configuration

The bot comes with pre-configured "Human Behavior" profiles. You can change these in the **Anti-Ban Settings** card.

| Preset | Messages/Hour | Description |
|--------|---------------|-------------|
| **New Account** | 30 | Strict limits. Use this for numbers < 1 month old. |
| **Balanced** | 50 | Recommended default. Good balance of speed and safety. |
| **Higher** | 80 | For established business numbers (> 6 months old). |
| **Custom** | ??? | Define your own limits. |

**How it works:**
1.  **Limit Reached:** If the bot hits the hourly limit (e.g., 51st message), it will **stop replying** until the next hour to protect your number. The user logs will show "Rate Limited".
2.  **Health Bars:** Watch the "Current Usage" bars in the dashboard.
    *   **Green:** Safe zone.
    *   **Yellow:** Caution.
    *   **Red:** Limit reached.

---

## ☁️ Google Drive Backup (Optional)

To automatically backup your chat logs to Google Drive:

1.  Place your `google-credentials.json` (Service Account Key) in the `app/` folder.
2.  Add `GOOGLE_DRIVE_FOLDER_ID=your_folder_id` to your `.env` file.
3.  The bot will now sync logs to the cloud every 30 days or when you click "Backup" manually.

---

## ❓ Troubleshooting

**Q: The QR code isn't loading.**
A: Click "Disconnect", wait 5 seconds, and click "Connect" again. If that fails, click "Clear Auth" to reset the session.

**Q: The bot isn't replying.**
A:
1.  Check the **Activity Log** in the dashboard. Does it say "Sending to n8n..."?
2.  If yes, check your **n8n Executions** tab. Did the workflow run?
3.  If no, check if your **n8n Webhook URL** is correct in the Admin Panel.

**Q: The reply is too slow.**
A: This is a feature, not a bug! The bot calculates how long a human would take to read the message and type a reply. You can adjust the math in `app/src/utils/anti-ban.js` if you want it faster (but it increases ban risk).

---

## License

MIT License. Free to use and modify.
