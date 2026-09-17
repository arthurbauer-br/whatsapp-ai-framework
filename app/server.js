/**
 * WhatsApp AI Bot - Main Server
 *
 * Combines:
 * - Baileys WhatsApp connection
 * - Express web server (admin panel)
 * - WebSocket (real-time QR updates)
 * - n8n webhook client
 */

require('dotenv').config();

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const axios = require('axios');
const QRCode = require('qrcode');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');

// Proxy agent (Baileys ignores the HTTP_PROXY / HTTPS_PROXY env vars)
const { HttpsProxyAgent } = require('https-proxy-agent');

// Anti-Ban & Settings Modules
const { AntiBanManager, safeSendMessage, simulateTyping, delay } = require('./src/utils/anti-ban');
const { loadSettings, getAntiBanSettings, updateAntiBanSettings } = require('./src/utils/settings');

// ========================================
// CONFIGURATION
// ========================================

const fs = require('fs').promises;
const fsSync = require('fs');
const { google } = require('googleapis');

const PORT = process.env.PORT || 3000;
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || 'YOUR_N8N_WEBHOOK_URL_HERE';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const AUTH_FOLDER = path.join(__dirname, 'auth_info');
const LOGS_FOLDER = path.join(__dirname, 'logs');
const LOGS_FILE = path.join(LOGS_FOLDER, 'activity.json');
const BACKUP_FOLDER = path.join(LOGS_FOLDER, 'backups');
const LOG_BACKUP_DAYS = 30; // Auto backup after 30 days

// ========================================
// PROXY CONFIGURATION (residential egress) - MANDATORY
// ========================================
// Baileys does NOT honour the HTTP_PROXY / HTTPS_PROXY environment variables,
// so the agents have to be injected explicitly into makeWASocket().
// Two different kinds of agent are needed:
//   - PROXY_WS_AGENT   : a Node http.Agent, used by `ws` for the WhatsApp socket
//   - PROXY_DISPATCHER : an undici Dispatcher, used by global fetch() for media
//                        upload/download and history sync
//
// FAIL-CLOSED POLICY: WhatsApp traffic must NEVER leave through the datacenter IP.
// If the proxy is not configured, or its agents cannot be built, the process
// refuses to start instead of silently falling back to a direct connection.
// If the proxy goes down while running, every socket/fetch through these agents
// fails, the WhatsApp connection drops, and reconnection keeps failing until the
// proxy is back - there is no code path that bypasses it.
const PROXY_URL = process.env.P2SPEED_PROXY || '';

if (!PROXY_URL) {
    console.error('[Proxy] FATAL: P2SPEED_PROXY is not set.');
    console.error('[Proxy] Refusing to start - WhatsApp must never connect from the datacenter IP.');
    process.exit(1);
}

let PROXY_WS_AGENT;      // -> makeWASocket({ agent })
let PROXY_DISPATCHER;    // -> makeWASocket({ fetchAgent, options.dispatcher })

try {
    const { ProxyAgent } = require('undici');
    PROXY_WS_AGENT = new HttpsProxyAgent(PROXY_URL);
    PROXY_DISPATCHER = new ProxyAgent(PROXY_URL);
} catch (err) {
    console.error('[Proxy] FATAL: could not build the proxy agents:', err.message);
    console.error('[Proxy] Run "npm install https-proxy-agent undici" and check P2SPEED_PROXY.');
    process.exit(1);
}

console.log(`[Proxy] All WhatsApp traffic forced through ${PROXY_URL}`);

// Google Drive Configuration
const GOOGLE_CREDENTIALS_FILE = process.env.GOOGLE_CREDENTIALS_FILE || path.join(__dirname, 'google-credentials.json');
const GOOGLE_DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID || ''; // Folder ID from Google Drive URL

// Reply sent when n8n is not configured.
// Empty string = stay silent (nothing is sent to the contact).
const DEFAULT_REPLY = process.env.DEFAULT_REPLY || '';

// ========================================
// STATE MANAGEMENT
// ========================================

let whatsappSocket = null;
let connectionStatus = 'disconnected'; // 'disconnected' | 'connecting' | 'connected'
let currentQR = null;
let connectedPhone = null;
let connectedAt = null;
let activityLog = []; // In-memory log
let logStartDate = null; // When current log period started
const wsClients = new Set();

// Track contact activity for "Processing..." cooldown
const contactLastActivity = new Map(); // phone -> timestamp
const PROCESSING_MSG_COOLDOWN = 30 * 60 * 1000; // 30 minutes in milliseconds

// Anti-Ban Manager instance
let antiBanManager = null;

// ========================================
// MESSAGE EXTRACTION HELPER
// ========================================

/**
 * Extract text content from any WhatsApp message type
 * Handles: conversation, extendedText, replies, images, videos, documents, buttons, lists
 * @param {object} message - The message object from Baileys
 * @returns {object} { text: string, quotedText: string|null, isReply: boolean, messageType: string }
 */
function extractMessageContent(message) {
    if (!message) {
        return { text: '', quotedText: null, isReply: false, messageType: 'unknown' };
    }

    let text = '';
    let quotedText = null;
    let messageType = 'unknown';

    // 1. Simple conversation (plain text)
    if (message.conversation) {
        text = message.conversation;
        messageType = 'conversation';
    }
    // 2. Extended text message (replies, links, formatted text)
    else if (message.extendedTextMessage) {
        text = message.extendedTextMessage.text || '';
        messageType = 'extendedText';

        // Extract quoted message if this is a reply
        const contextInfo = message.extendedTextMessage.contextInfo;
        if (contextInfo?.quotedMessage) {
            quotedText = contextInfo.quotedMessage.conversation ||
                contextInfo.quotedMessage.extendedTextMessage?.text ||
                contextInfo.quotedMessage.imageMessage?.caption ||
                contextInfo.quotedMessage.videoMessage?.caption ||
                '[media]';
        }
    }
    // 3. Image message (with optional caption)
    else if (message.imageMessage) {
        text = message.imageMessage.caption || '[Image]';
        messageType = 'image';

        // Check for quoted message in image reply
        const contextInfo = message.imageMessage.contextInfo;
        if (contextInfo?.quotedMessage) {
            quotedText = contextInfo.quotedMessage.conversation ||
                contextInfo.quotedMessage.extendedTextMessage?.text ||
                '[media]';
        }
    }
    // 4. Video message (with optional caption)
    else if (message.videoMessage) {
        text = message.videoMessage.caption || '[Video]';
        messageType = 'video';

        const contextInfo = message.videoMessage.contextInfo;
        if (contextInfo?.quotedMessage) {
            quotedText = contextInfo.quotedMessage.conversation ||
                contextInfo.quotedMessage.extendedTextMessage?.text ||
                '[media]';
        }
    }
    // 5. Document message (with optional caption)
    else if (message.documentMessage) {
        text = message.documentMessage.caption || message.documentMessage.fileName || '[Document]';
        messageType = 'document';
    }
    // 6. Audio message (voice note)
    else if (message.audioMessage) {
        text = '[Voice Note]';
        messageType = 'audio';
    }
    // 7. Sticker message
    else if (message.stickerMessage) {
        text = '[Sticker]';
        messageType = 'sticker';
    }
    // 8. Button response
    else if (message.buttonsResponseMessage) {
        text = message.buttonsResponseMessage.selectedDisplayText ||
            message.buttonsResponseMessage.selectedButtonId || '';
        messageType = 'buttonResponse';
    }
    // 9. List response
    else if (message.listResponseMessage) {
        text = message.listResponseMessage.title ||
            message.listResponseMessage.singleSelectReply?.selectedRowId || '';
        messageType = 'listResponse';
    }
    // 10. Template button reply
    else if (message.templateButtonReplyMessage) {
        text = message.templateButtonReplyMessage.selectedDisplayText ||
            message.templateButtonReplyMessage.selectedId || '';
        messageType = 'templateButtonReply';
    }
    // 11. Contact message
    else if (message.contactMessage) {
        text = `[Contact: ${message.contactMessage.displayName || 'Unknown'}]`;
        messageType = 'contact';
    }
    // 12. Location message
    else if (message.locationMessage) {
        text = `[Location: ${message.locationMessage.degreesLatitude}, ${message.locationMessage.degreesLongitude}]`;
        messageType = 'location';
    }

    return {
        text: text.trim(),
        quotedText,
        isReply: !!quotedText,
        messageType
    };
}

// ========================================
// LOG PERSISTENCE
// ========================================

async function initLogSystem() {
    // Ensure directories exist
    if (!fsSync.existsSync(LOGS_FOLDER)) {
        await fs.mkdir(LOGS_FOLDER, { recursive: true });
    }
    if (!fsSync.existsSync(BACKUP_FOLDER)) {
        await fs.mkdir(BACKUP_FOLDER, { recursive: true });
    }

    // Load existing logs
    try {
        if (fsSync.existsSync(LOGS_FILE)) {
            const data = await fs.readFile(LOGS_FILE, 'utf8');
            const parsed = JSON.parse(data);
            activityLog = parsed.logs || [];
            logStartDate = parsed.startDate || new Date().toISOString();
            console.log(`[Logs] Loaded ${activityLog.length} existing log entries`);
        } else {
            logStartDate = new Date().toISOString();
            await saveLogsToFile();
        }
    } catch (error) {
        console.error('[Logs] Error loading logs:', error);
        activityLog = [];
        logStartDate = new Date().toISOString();
    }

    // Check if backup is needed
    await checkAndBackupLogs();

    // Schedule daily backup check
    setInterval(checkAndBackupLogs, 24 * 60 * 60 * 1000); // Check every 24 hours
}

async function saveLogsToFile() {
    try {
        const data = {
            startDate: logStartDate,
            lastUpdated: new Date().toISOString(),
            logs: activityLog
        };
        await fs.writeFile(LOGS_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('[Logs] Error saving logs:', error);
    }
}

async function checkAndBackupLogs() {
    if (!logStartDate) return;

    const startDate = new Date(logStartDate);
    const now = new Date();
    const daysDiff = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));

    if (daysDiff >= LOG_BACKUP_DAYS && activityLog.length > 0) {
        console.log(`[Logs] ${daysDiff} days since log start, initiating backup...`);
        await backupAndClearLogs();
    }
}

async function backupAndClearLogs() {
    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupFilename = `backup-${timestamp}.json`;
        const backupFile = path.join(BACKUP_FOLDER, backupFilename);

        // Prepare backup data
        const backupData = {
            backupDate: new Date().toISOString(),
            periodStart: logStartDate,
            periodEnd: new Date().toISOString(),
            totalEntries: activityLog.length,
            logs: activityLog
        };
        const backupContent = JSON.stringify(backupData, null, 2);

        // Save local backup
        await fs.writeFile(backupFile, backupContent);
        console.log(`[Logs] Local backup saved to ${backupFile}`);

        // Upload to Google Drive if configured
        let googleDriveResult = null;
        if (googleDriveClient) {
            googleDriveResult = await uploadToGoogleDrive(backupFilename, backupContent);
            if (googleDriveResult.success) {
                console.log(`[Logs] ☁️ Cloud backup: ${googleDriveResult.webLink}`);
            }
        }

        // Clear current logs
        activityLog = [];
        logStartDate = new Date().toISOString();
        await saveLogsToFile();

        const message = googleDriveResult?.success
            ? 'Logs backed up to local + Google Drive (30-day cycle)'
            : 'Logs backed up locally (30-day cycle)';
        logActivity(message, 'info');

        return {
            success: true,
            backupFile,
            googleDrive: googleDriveResult
        };
    } catch (error) {
        console.error('[Logs] Backup error:', error);
        return { success: false, error: error.message };
    }
}

function convertLogsToCSV(logs) {
    const headers = ['ID', 'Timestamp', 'Level', 'Message'];
    const rows = logs.map(log => [
        log.id,
        log.timestamp,
        log.level,
        `"${(log.message || '').replace(/"/g, '""')}"`
    ]);
    return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}

// ========================================
// GOOGLE DRIVE INTEGRATION
// ========================================

let googleDriveClient = null;

async function initGoogleDrive() {
    // Check if credentials file exists
    if (!fsSync.existsSync(GOOGLE_CREDENTIALS_FILE)) {
        console.log('[Google Drive] No credentials file found - cloud backup disabled');
        console.log('[Google Drive] To enable: place google-credentials.json in app folder');
        return false;
    }

    if (!GOOGLE_DRIVE_FOLDER_ID) {
        console.log('[Google Drive] No folder ID configured - cloud backup disabled');
        console.log('[Google Drive] To enable: set GOOGLE_DRIVE_FOLDER_ID in .env');
        return false;
    }

    try {
        const credentials = JSON.parse(await fs.readFile(GOOGLE_CREDENTIALS_FILE, 'utf8'));
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/drive.file']
        });
        googleDriveClient = google.drive({ version: 'v3', auth });
        console.log('[Google Drive] ✅ Connected - backups will sync to cloud');
        return true;
    } catch (error) {
        console.error('[Google Drive] Failed to initialize:', error.message);
        return false;
    }
}

async function uploadToGoogleDrive(filename, content) {
    if (!googleDriveClient) {
        return { success: false, error: 'Google Drive not configured' };
    }

    try {
        const { Readable } = require('stream');
        const contentStream = Readable.from([content]);

        const response = await googleDriveClient.files.create({
            requestBody: {
                name: filename,
                parents: [GOOGLE_DRIVE_FOLDER_ID],
                mimeType: 'application/json'
            },
            media: {
                mimeType: 'application/json',
                body: contentStream
            },
            fields: 'id, name, webViewLink'
        });

        console.log(`[Google Drive] ✅ Uploaded: ${filename}`);
        return {
            success: true,
            fileId: response.data.id,
            fileName: response.data.name,
            webLink: response.data.webViewLink
        };
    } catch (error) {
        console.error('[Google Drive] Upload failed:', error.message);
        return { success: false, error: error.message };
    }
}

async function listGoogleDriveBackups() {
    if (!googleDriveClient) {
        return { success: false, error: 'Google Drive not configured', files: [] };
    }

    try {
        const response = await googleDriveClient.files.list({
            q: `'${GOOGLE_DRIVE_FOLDER_ID}' in parents and mimeType='application/json' and trashed=false`,
            fields: 'files(id, name, size, createdTime, webViewLink)',
            orderBy: 'createdTime desc',
            pageSize: 50
        });

        return {
            success: true,
            files: response.data.files || []
        };
    } catch (error) {
        console.error('[Google Drive] List failed:', error.message);
        return { success: false, error: error.message, files: [] };
    }
}

// ========================================
// WHATSAPP CONNECTION (Baileys)
// ========================================

async function startWhatsApp() {
    console.log('[WhatsApp] Starting connection...');
    connectionStatus = 'connecting';
    broadcastStatus();

    try {
        const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);

        whatsappSocket = makeWASocket({
            agent: PROXY_WS_AGENT,                        // WebSocket connection
            fetchAgent: PROXY_DISPATCHER,                 // media upload
            options: { dispatcher: PROXY_DISPATCHER },    // media / history download
            auth: state,
            printQRInTerminal: false // We display QR in web UI instead
        });

        // Save credentials when updated
        whatsappSocket.ev.on('creds.update', saveCreds);

        // Handle connection updates
        whatsappSocket.ev.on('connection.update', async (update) => {
            const { connection, qr, lastDisconnect } = update;

            // QR Code received - display in web UI
            if (qr) {
                console.log('[WhatsApp] QR code received');
                try {
                    currentQR = await QRCode.toDataURL(qr);
                    connectionStatus = 'connecting';
                    broadcastStatus();
                    logActivity('QR code generated - scan with WhatsApp', 'info');
                } catch (err) {
                    console.error('[WhatsApp] QR generation error:', err);
                }
            }

            // Connection closed
            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

                console.log('[WhatsApp] Connection closed. Status:', statusCode);
                connectionStatus = 'disconnected';
                currentQR = null;
                connectedPhone = null;
                connectedAt = null;
                broadcastStatus();

                if (shouldReconnect) {
                    logActivity('Connection lost - reconnecting in 5 seconds...', 'warning');
                    setTimeout(() => startWhatsApp(), 5000);
                } else {
                    logActivity('Logged out - scan QR code to reconnect', 'error');
                }
            }

            // Connected successfully
            if (connection === 'open') {
                console.log('[WhatsApp] Connected!');
                connectionStatus = 'connected';
                currentQR = null;
                connectedPhone = whatsappSocket.user?.id?.split(':')[0] || 'Unknown';
                connectedAt = new Date().toISOString();
                broadcastStatus();
                logActivity(`Connected as ${connectedPhone}`, 'success');
            }
        });

        // Handle incoming messages
        whatsappSocket.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify') return;

            for (const msg of messages) {
                await handleIncomingMessage(msg);
            }
        });

    } catch (error) {
        console.error('[WhatsApp] Connection error:', error);
        connectionStatus = 'disconnected';
        broadcastStatus();
        logActivity(`Connection error: ${error.message}`, 'error');

        // Retry after 10 seconds
        setTimeout(() => startWhatsApp(), 10000);
    }
}

/**
 * Handle incoming WhatsApp message
 * Implements anti-ban protections: rate limiting, typing indicators, human-like delays
 */
async function handleIncomingMessage(msg) {
    try {
        // Skip own messages
        if (msg.key.fromMe) return;

        // Extract message info using comprehensive helper
        const from = msg.key.remoteJid;
        const { text: messageText, quotedText, isReply, messageType } = extractMessageContent(msg.message);

        // Skip empty messages or status broadcasts
        if (!messageText || from === 'status@broadcast') return;

        // Skip media-only messages without text (optional - remove if you want to handle these)
        if (messageText.startsWith('[') && messageText.endsWith(']') && !messageText.includes(':')) {
            // This is a media placeholder like [Image], [Video], [Voice Note], [Sticker]
            console.log(`[Message] Skipping media-only message: ${messageText}`);
            return;
        }

        // Format phone number
        const phoneNumber = from.replace('@s.whatsapp.net', '');
        const timestamp = new Date().toISOString();

        // Log with reply context if present
        const replyContext = isReply ? ` (replying to: "${quotedText?.substring(0, 30)}...")` : '';
        console.log(`[Message] From ${phoneNumber} [${messageType}]: ${messageText}${replyContext}`);
        logActivity(`Received from ${phoneNumber}: ${messageText.substring(0, 50)}${messageText.length > 50 ? '...' : ''}`, 'info');

        // ========================================
        // ANTI-BAN: Check rate limits FIRST
        // ========================================
        if (antiBanManager) {
            const canSend = antiBanManager.canSendMessage(from);
            if (!canSend.allowed) {
                console.log(`[Anti-Ban] BLOCKED: ${canSend.reason}`);
                logActivity(`Rate limited: ${canSend.reason} - message from ${phoneNumber} skipped`, 'warning');
                // Broadcast updated stats to admin panel
                broadcastAntiBanStats();
                return; // Don't respond - we've hit rate limits
            }
        }

        // Check if n8n webhook is configured
        const { getSetting } = require('./src/utils/settings');
        const activeWebhookUrl = getSetting('n8nWebhookUrl') || N8N_WEBHOOK_URL;

        if (activeWebhookUrl === 'YOUR_N8N_WEBHOOK_URL_HERE' || !activeWebhookUrl) {
            console.log('[Message] n8n not configured, sending default reply');
            if (antiBanManager) {
                // Use safe send with anti-ban protections even for default reply
                const result = await safeSendMessage(whatsappSocket, from, DEFAULT_REPLY, messageText, antiBanManager);
                if (result.sent) {
                    logActivity(`Sent default reply to ${phoneNumber} (delayed ${result.delay}ms)`, 'warning');
                }
            } else {
                await whatsappSocket.sendMessage(from, { text: DEFAULT_REPLY });
                logActivity(`Sent default reply to ${phoneNumber}`, 'warning');
            }
            broadcastAntiBanStats();
            return;
        }

        // ========================================
        // ANTI-BAN: Show typing indicator (no "Processing..." text)
        // ========================================
        try {
            await whatsappSocket.sendPresenceUpdate('composing', from);
        } catch (presenceError) {
            console.log('[Anti-Ban] Typing indicator failed:', presenceError.message);
        }

        // Update last activity timestamp
        contactLastActivity.set(phoneNumber, Date.now());

        // Send to n8n webhook (includes reply context if present)
        console.log('[Message] Sending to n8n...');
        const webhookPayload = {
            from: phoneNumber,
            fromJid: from,
            message: messageText,
            timestamp: timestamp,
            messageId: msg.key.id,
            // Reply context - helps AI understand conversation flow
            isReply: isReply,
            quotedMessage: quotedText || null,
            messageType: messageType
        };

        const response = await axios.post(activeWebhookUrl, webhookPayload, {
            timeout: 30000 // 30 second timeout
        });

        console.log('[Message] n8n response received');

        // Extract reply from n8n response
        const reply = response.data?.reply ||
            response.data?.message ||
            response.data?.text;

        // Check if should skip (human handoff active)
        if (response.data?.skip) {
            console.log('[Message] Skipping reply (human handoff active)');
            logActivity(`Human handoff active for ${phoneNumber}`, 'info');
            // Stop typing indicator
            try {
                await whatsappSocket.sendPresenceUpdate('paused', from);
            } catch (e) {}
            return;
        }

        // ========================================
        // ANTI-BAN: Send reply with human-like delay
        // ========================================
        if (reply) {
            if (antiBanManager) {
                // Use safeSendMessage with all anti-ban protections
                const result = await safeSendMessage(whatsappSocket, from, reply, messageText, antiBanManager);
                if (result.sent) {
                    const replyPreview = reply.length > 50 ? reply.substring(0, 50) + '...' : reply;
                    logActivity(`Replied to ${phoneNumber}: ${replyPreview} (delayed ${result.delay}ms)`, 'success');
                    console.log(`[Message] Reply sent with ${result.delay}ms delay`);
                } else {
                    logActivity(`Reply blocked for ${phoneNumber}: ${result.reason}`, 'warning');
                }
                // Broadcast updated stats to admin panel
                broadcastAntiBanStats();
            } else {
                // Fallback: send without anti-ban (shouldn't happen)
                await whatsappSocket.sendMessage(from, { text: reply });
                const replyPreview = reply.length > 50 ? reply.substring(0, 50) + '...' : reply;
                logActivity(`Replied to ${phoneNumber}: ${replyPreview}`, 'success');
                console.log('[Message] Reply sent');
            }
        } else {
            console.log('[Message] No reply from n8n');
            logActivity(`No reply received from n8n for ${phoneNumber}`, 'warning');
            // Stop typing indicator
            try {
                await whatsappSocket.sendPresenceUpdate('paused', from);
            } catch (e) {}
        }

    } catch (error) {
        console.error('[Message] Error processing:', error.message);
        logActivity(`Error: ${error.message}`, 'error');

        // Stop typing indicator on error
        try {
            await whatsappSocket.sendPresenceUpdate('paused', msg.key.remoteJid);
        } catch (e) {}

        // Send error message to user (with anti-ban if available)
        const errorReply = `Sorry, something went wrong. Please try again later.

抱歉，出现了问题。请稍后再试。

Maaf, sesuatu telah berlaku. Sila cuba lagi nanti.`;

        try {
            if (antiBanManager) {
                await safeSendMessage(whatsappSocket, msg.key.remoteJid, errorReply, '', antiBanManager);
            } else {
                await whatsappSocket.sendMessage(msg.key.remoteJid, { text: errorReply });
            }
        } catch (sendError) {
            console.error('[Message] Failed to send error reply:', sendError.message);
        }
    }
}

/**
 * Disconnect WhatsApp
 */
async function disconnectWhatsApp() {
    if (whatsappSocket) {
        try {
            await whatsappSocket.logout();
            logActivity('Disconnected from WhatsApp', 'info');
        } catch (error) {
            console.error('[WhatsApp] Logout error:', error);
        }
        whatsappSocket = null;
    }
    connectionStatus = 'disconnected';
    currentQR = null;
    connectedPhone = null;
    connectedAt = null;
    broadcastStatus();
}

// ========================================
// ACTIVITY LOG
// ========================================

function logActivity(message, level = 'info') {
    const entry = {
        id: Date.now().toString(),
        timestamp: new Date().toISOString(),
        message,
        level
    };

    activityLog.unshift(entry);

    // No limit on entries - they get backed up after 30 days
    // But keep in-memory display to last 1000 for performance
    if (activityLog.length > 1000) {
        activityLog = activityLog.slice(0, 1000);
    }

    // Broadcast to connected clients
    broadcastLog(entry);

    // Save to file (debounced - every 10 entries or on important events)
    if (activityLog.length % 10 === 0 || level === 'error' || level === 'success') {
        saveLogsToFile().catch(err => console.error('[Logs] Save error:', err));
    }

    // Console output
    const emoji = { info: 'ℹ️', success: '✅', warning: '⚠️', error: '❌' };
    console.log(`${emoji[level] || ''} [Log] ${message}`);
}

// ========================================
// WEBSOCKET (Real-time updates)
// ========================================

function broadcastStatus() {
    const statusData = {
        type: 'status',
        data: {
            status: connectionStatus,
            qr: currentQR,
            phone: connectedPhone,
            connectedAt: connectedAt
        }
    };
    broadcast(statusData);
}

function broadcastLog(entry) {
    broadcast({ type: 'log', data: entry });
}

function broadcastAntiBanStats() {
    if (!antiBanManager) return;
    broadcast({
        type: 'antiBanStats',
        data: antiBanManager.getHealth()
    });
}

function broadcast(data) {
    const message = JSON.stringify(data);
    wsClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// ========================================
// EXPRESS WEB SERVER
// ========================================

const app = express();
const server = http.createServer(app);

// WebSocket server
const wss = new WebSocket.Server({ server, path: '/ws' });

wss.on('connection', (ws) => {
    console.log('[WS] Client connected');
    wsClients.add(ws);

    // Send current state
    const { getSettings } = require('./src/utils/settings');
    const settings = getSettings();
    
    ws.send(JSON.stringify({
        type: 'init',
        data: {
            status: connectionStatus,
            qr: currentQR,
            phone: connectedPhone,
            connectedAt: connectedAt,
            logs: activityLog.slice(0, 50),
            antiBan: antiBanManager ? antiBanManager.getHealth() : null,
            antiBanSettings: antiBanManager ? getAntiBanSettings() : null,
            webhookUrl: settings.n8nWebhookUrl || N8N_WEBHOOK_URL
        }
    }));

    ws.on('close', () => {
        console.log('[WS] Client disconnected');
        wsClients.delete(ws);
    });
});

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Optional password protection
if (ADMIN_PASSWORD) {
    app.use('/api', (req, res, next) => {
        const authHeader = req.headers.authorization;
        if (authHeader === `Bearer ${ADMIN_PASSWORD}`) {
            next();
        } else {
            res.status(401).json({ error: 'Unauthorized' });
        }
    });
}

// ========================================
// API ENDPOINTS
// ========================================

// Get connection status
app.get('/api/status', (req, res) => {
    res.json({
        status: connectionStatus,
        qr: currentQR,
        phone: connectedPhone,
        connectedAt: connectedAt
    });
});

// Get activity logs
app.get('/api/logs', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    res.json({ logs: activityLog.slice(0, limit) });
});

// Connect WhatsApp
app.post('/api/connect', async (req, res) => {
    if (connectionStatus === 'connected') {
        return res.status(400).json({ error: 'Already connected' });
    }
    if (connectionStatus === 'connecting') {
        return res.status(400).json({ error: 'Already connecting' });
    }

    startWhatsApp();
    res.json({ success: true, message: 'Connection started' });
});

// Disconnect WhatsApp
app.post('/api/disconnect', async (req, res) => {
    if (connectionStatus === 'disconnected') {
        return res.status(400).json({ error: 'Not connected' });
    }

    await disconnectWhatsApp();
    res.json({ success: true, message: 'Disconnected' });
});

// ========================================
// OUTBOUND SEND API (used by n8n for expiry notices)
// ========================================
// Protected by the same N8N_TOKEN the Flask panel uses (views/n8n.py).
// Without N8N_TOKEN in the environment the route stays disabled, so it can
// never be reached by accident.
const N8N_TOKEN = (process.env.N8N_TOKEN || '').trim();

function isSendAuthorized(req) {
    if (!N8N_TOKEN) return false;
    const crypto = require('crypto');
    const header = req.get('X-N8N-Token') || '';
    const auth = req.get('Authorization') || '';
    const received = (header || (auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '')).trim();
    if (!received) return false;
    const a = Buffer.from(received);
    const b = Buffer.from(N8N_TOKEN);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

app.post('/api/send', async (req, res) => {
    if (!isSendAuthorized(req)) {
        return res.status(403).json({ error: 'nao_autorizado', hint: 'send the X-N8N-Token header' });
    }

    const { to, message } = req.body || {};
    if (!to || !message) {
        return res.status(400).json({ error: 'to_and_message_required' });
    }

    if (connectionStatus !== 'connected' || !whatsappSocket) {
        return res.status(503).json({ error: 'whatsapp_disconnected', status: connectionStatus });
    }

    const digits = String(to).replace(/\D/g, '');
    if (digits.length < 10) {
        return res.status(400).json({ error: 'invalid_number', to });
    }

    try {
        // Confirm the number is actually on WhatsApp before sending.
        // Messaging unregistered numbers is a strong ban signal.
        const [check] = await whatsappSocket.onWhatsApp(digits);
        if (!check || !check.exists) {
            logActivity(`Send skipped - ${digits} is not on WhatsApp`, 'warning');
            return res.status(404).json({ sent: false, error: 'not_on_whatsapp', to: digits });
        }

        // safeSendMessage applies the anti-ban rate limits and human-like delays.
        const result = await safeSendMessage(whatsappSocket, check.jid, message, '', antiBanManager);

        if (!result.sent) {
            logActivity(`Send blocked for ${digits}: ${result.reason}`, 'warning');
            return res.status(429).json({ sent: false, reason: result.reason, waitTime: result.waitTime });
        }

        logActivity(`Sent notice to ${digits} (delayed ${result.delay}ms)`, 'success');
        broadcastAntiBanStats();
        return res.json({ sent: true, to: digits, jid: check.jid, delay: result.delay });
    } catch (error) {
        console.error('[Send] Error:', error.message);
        logActivity(`Send error for ${digits}: ${error.message}`, 'error');
        return res.status(500).json({ sent: false, error: error.message });
    }
});

// Get settings
app.get('/api/settings', (req, res) => {
    const { getSettings } = require('./src/utils/settings');
    const settings = getSettings();
    res.json({
        webhookUrl: settings.n8nWebhookUrl || N8N_WEBHOOK_URL,
        hasPassword: !!ADMIN_PASSWORD
    });
});

// Update n8n webhook URL
app.post('/api/settings/webhook', async (req, res) => {
    try {
        const { webhookUrl } = req.body;
        if (!webhookUrl) {
            return res.status(400).json({ error: 'Webhook URL is required' });
        }

        const { updateSettings } = require('./src/utils/settings');
        await updateSettings(null, { n8nWebhookUrl: webhookUrl });

        logActivity('n8n Webhook URL updated', 'info');
        res.json({ success: true, webhookUrl });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
});

// ========================================
// ANTI-BAN API ENDPOINTS
// ========================================

// Get anti-ban stats (current message counts)
app.get('/api/anti-ban/stats', (req, res) => {
    if (!antiBanManager) {
        return res.status(503).json({ error: 'Anti-ban system not initialized' });
    }
    res.json(antiBanManager.getStats());
});

// Get anti-ban health (usage percentages + warnings)
app.get('/api/anti-ban/health', (req, res) => {
    if (!antiBanManager) {
        return res.status(503).json({ error: 'Anti-ban system not initialized' });
    }
    res.json(antiBanManager.getHealth());
});

// Get anti-ban settings
app.get('/api/anti-ban/settings', (req, res) => {
    const { PRESETS } = require('./src/utils/anti-ban');
    const settings = getAntiBanSettings();
    res.json({
        current: settings,
        presets: PRESETS
    });
});

// Update anti-ban settings
app.post('/api/anti-ban/settings', async (req, res) => {
    try {
        const { preset, messagesPerHour, messagesPerDay, uniqueChatsPerHour, uniqueChatsPerDay } = req.body;

        // Validate input
        if (!preset && !messagesPerHour && !messagesPerDay && !uniqueChatsPerHour && !uniqueChatsPerDay) {
            return res.status(400).json({ error: 'No settings provided' });
        }

        const { PRESETS } = require('./src/utils/anti-ban');

        // If preset is provided, validate it
        if (preset && preset !== 'custom' && !PRESETS[preset]) {
            return res.status(400).json({ error: `Invalid preset: ${preset}. Valid presets: ${Object.keys(PRESETS).join(', ')}` });
        }

        // Update settings
        const updates = {};
        if (preset) updates.preset = preset;
        if (messagesPerHour) updates.messagesPerHour = parseInt(messagesPerHour);
        if (messagesPerDay) updates.messagesPerDay = parseInt(messagesPerDay);
        if (uniqueChatsPerHour) updates.uniqueChatsPerHour = parseInt(uniqueChatsPerHour);
        if (uniqueChatsPerDay) updates.uniqueChatsPerDay = parseInt(uniqueChatsPerDay);

        const newSettings = await updateAntiBanSettings(updates);

        // Update the manager with new limits
        if (antiBanManager) {
            antiBanManager.updateLimits(newSettings);
        }

        // Broadcast update to all connected clients
        broadcastAntiBanStats();
        broadcast({
            type: 'antiBanSettings',
            data: newSettings
        });

        logActivity(`Anti-ban settings updated: ${preset || 'custom'}`, 'info');
        res.json({ success: true, settings: newSettings });
    } catch (error) {
        console.error('[API] Anti-ban settings error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Export logs (JSON or CSV)
app.get('/api/logs/export', async (req, res) => {
    const format = req.query.format || 'json';
    const filename = `activity-logs-${new Date().toISOString().split('T')[0]}`;

    try {
        if (format === 'csv') {
            const csv = convertLogsToCSV(activityLog);
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
            res.send(csv);
        } else {
            const data = {
                exportDate: new Date().toISOString(),
                periodStart: logStartDate,
                totalEntries: activityLog.length,
                logs: activityLog
            };
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
            res.send(JSON.stringify(data, null, 2));
        }
        logActivity(`Logs exported as ${format.toUpperCase()}`, 'info');
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Manual backup and clear logs
app.post('/api/logs/backup', async (req, res) => {
    try {
        if (activityLog.length === 0) {
            return res.status(400).json({ error: 'No logs to backup' });
        }
        const result = await backupAndClearLogs();
        if (result.success) {
            res.json({ success: true, message: 'Logs backed up and cleared', backupFile: result.backupFile });
        } else {
            res.status(500).json({ error: result.error });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// List backup files (local + Google Drive)
app.get('/api/logs/backups', async (req, res) => {
    try {
        // Get local backups
        const files = await fs.readdir(BACKUP_FOLDER);
        const localBackups = [];
        for (const file of files.filter(f => f.endsWith('.json'))) {
            const stats = await fs.stat(path.join(BACKUP_FOLDER, file));
            localBackups.push({
                filename: file,
                size: stats.size,
                created: stats.birthtime,
                location: 'local'
            });
        }
        localBackups.sort((a, b) => new Date(b.created) - new Date(a.created));

        // Get Google Drive backups
        const googleDriveResult = await listGoogleDriveBackups();
        const cloudBackups = googleDriveResult.files.map(f => ({
            filename: f.name,
            size: parseInt(f.size) || 0,
            created: f.createdTime,
            location: 'google_drive',
            webLink: f.webViewLink,
            fileId: f.id
        }));

        res.json({
            local: localBackups,
            googleDrive: cloudBackups,
            googleDriveConnected: !!googleDriveClient,
            logStartDate,
            currentLogCount: activityLog.length
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Download specific backup file
app.get('/api/logs/backups/:filename', async (req, res) => {
    try {
        const filename = req.params.filename;
        if (!filename.endsWith('.json') || filename.includes('..')) {
            return res.status(400).json({ error: 'Invalid filename' });
        }
        const filepath = path.join(BACKUP_FOLDER, filename);
        if (!fsSync.existsSync(filepath)) {
            return res.status(404).json({ error: 'Backup not found' });
        }
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.sendFile(filepath);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Clear auth (logout and delete credentials)
app.post('/api/clear-auth', async (req, res) => {
    try {
        // Disconnect first
        if (whatsappSocket) {
            try {
                await whatsappSocket.logout();
            } catch (e) {
                // Ignore logout errors
            }
            whatsappSocket = null;
        }

        // Delete auth folder
        await fs.rm(AUTH_FOLDER, { recursive: true, force: true });

        connectionStatus = 'disconnected';
        currentQR = null;
        connectedPhone = null;
        connectedAt = null;
        broadcastStatus();

        logActivity('Auth cleared - ready to scan new QR code', 'info');
        res.json({ success: true, message: 'Auth cleared successfully' });
    } catch (error) {
        console.error('[API] Clear auth error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ========================================
// START SERVER
// ========================================

server.listen(PORT, async () => {
    console.log(`
╔════════════════════════════════════════════════════╗
║       WhatsApp AI Bot - Admin Panel                ║
╚════════════════════════════════════════════════════╝

🌐 Web UI:      http://localhost:${PORT}
🔗 n8n Webhook: ${N8N_WEBHOOK_URL === 'YOUR_N8N_WEBHOOK_URL_HERE' ? '⚠️  NOT CONFIGURED' : N8N_WEBHOOK_URL}
🔐 Password:    ${ADMIN_PASSWORD ? 'ENABLED' : 'DISABLED'}
📁 Logs:        ${LOGS_FOLDER}

Initializing...
    `);

    // Initialize log system
    await initLogSystem();

    // Initialize settings and anti-ban manager
    const settings = await loadSettings();
    antiBanManager = new AntiBanManager(settings.antiBan);
    console.log('[Anti-Ban] ✅ Initialized with', settings.antiBan.preset || 'custom', 'preset');

    // Initialize Google Drive (optional)
    await initGoogleDrive();

    // Auto-start WhatsApp connection
    startWhatsApp();
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n\n🛑 Shutting down...');
    await disconnectWhatsApp();
    process.exit(0);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    logActivity(`Uncaught error: ${error.message}`, 'error');
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection:', reason);
    logActivity(`Unhandled rejection: ${reason}`, 'error');
});
