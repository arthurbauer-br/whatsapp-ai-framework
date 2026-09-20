/**
 * Media bridge between WhatsApp and the atendimento API.
 *
 * Two directions:
 *
 *   inbound  - the customer sends a photo/PDF/audio. Only this process can
 *              decrypt it: WhatsApp media is end-to-end encrypted and the
 *              session keys live here. We download it and hand the bytes to
 *              the API, keyed by the WhatsApp message id.
 *
 *   outbound - the attendant picks a file in the app. The API decrypts it
 *              and posts the raw bytes here; we send it through Baileys with
 *              the same anti-ban treatment as a text reply.
 *
 * The API never touches WhatsApp and this process never touches the
 * database. The `message_id` is the only thing they share, and it is what
 * lets the n8n workflow stay exactly as it is: it keeps writing the text
 * row, we attach the file to the same id.
 */

const axios = require('axios');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');

const API_URL = (process.env.ATENDIMENTO_API_URL || 'http://atendimento-api:5100').replace(/\/+$/, '');
const N8N_TOKEN = (process.env.N8N_TOKEN || '').trim();
const MAX_BYTES = (parseInt(process.env.MIDIA_MAX_MB || '25', 10) || 25) * 1024 * 1024;

// WhatsApp message field -> our type name. Same vocabulary the API and the
// app use, so nobody has to translate in the middle.
const TIPOS = {
    imageMessage: 'image',
    videoMessage: 'video',
    audioMessage: 'audio',
    documentMessage: 'document',
    stickerMessage: 'sticker',
};

const EXTENSAO = {
    image: 'jpg', video: 'mp4', audio: 'ogg', sticker: 'webp', document: 'bin',
};

// Baileys expects a pino-like logger and calls .child() on it. Passing
// `console` throws, because console has no child().
const semLog = {
    level: 'silent',
    child: () => semLog,
    trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {},
};

/**
 * What kind of media is this, if any.
 * Returns null for plain text - the caller uses that to skip cheaply.
 */
function descrever(message) {
    if (!message) return null;
    // Unwrap the layers WhatsApp adds: view-once, ephemeral, "document with
    // caption". Without this, a photo sent as view-once looks like text.
    const inner = message.ephemeralMessage?.message
        || message.viewOnceMessage?.message
        || message.viewOnceMessageV2?.message
        || message.documentWithCaptionMessage?.message
        || message;

    for (const [campo, tipo] of Object.entries(TIPOS)) {
        const m = inner[campo];
        if (!m) continue;
        return {
            tipo,
            mime: m.mimetype || '',
            nome: m.fileName || `${tipo}-${Date.now()}.${EXTENSAO[tipo] || 'bin'}`,
            bytesEsperados: Number(m.fileLength || 0),
        };
    }
    return null;
}

/**
 * Download the incoming media and hand it to the API.
 *
 * Never throws: a failure here must not stop the conversation. The customer
 * still gets an answer, the message still reaches n8n; only the attachment
 * is missing, and the log says why.
 */
async function guardarRecebida(sock, msg, telefone, dispatcher) {
    const info = descrever(msg.message);
    if (!info) return null;

    const messageId = msg.key?.id;
    if (!messageId) {
        console.log('[Midia] message without id, skipping');
        return null;
    }
    if (!N8N_TOKEN) {
        console.log('[Midia] N8N_TOKEN empty - not storing media');
        return null;
    }

    // Refuse by the declared size BEFORE downloading. WhatsApp tells us how
    // big the file is; downloading 100 MB just to reject it would waste the
    // residential proxy's bandwidth, which is the scarce resource here.
    if (info.bytesEsperados && info.bytesEsperados > MAX_BYTES) {
        console.log(`[Midia] ${info.tipo} too large (${info.bytesEsperados} bytes), skipping`);
        return null;
    }

    try {
        // The dispatcher goes in the THIRD argument, nested under `options`.
        // Baileys threads it like this:
        //
        //   downloadMediaMessage(msg, type, opts, ctx)
        //     -> downloadContentFromMessage(download, mediaType, opts)
        //     -> downloadEncryptedContent(url, keys, { startByte, endByte, options })
        //     -> getHttpStream(url, { ...options, headers })
        //     -> fetch(url, { dispatcher: options.dispatcher })
        //
        // The fourth argument is only { logger, reuploadRequest }. Putting
        // the dispatcher there is silently ignored, and the download leaves
        // through the datacenter IP while the session uses the residential
        // one - two addresses for the same account, which is exactly the
        // signal the proxy exists to avoid.
        const buffer = await downloadMediaMessage(
            msg, 'buffer',
            dispatcher ? { options: { dispatcher } } : {},
            { logger: semLog, reuploadRequest: sock.updateMediaMessage },
        );

        if (!buffer || !buffer.length) {
            console.log('[Midia] empty download, skipping');
            return null;
        }
        if (buffer.length > MAX_BYTES) {
            console.log(`[Midia] downloaded ${buffer.length} bytes, over the limit`);
            return null;
        }

        // FormData and Blob are global from Node 18 on, so no multipart
        // library is needed here.
        const form = new FormData();
        form.append('whatsapp', telefone);
        form.append('message_id', messageId);
        form.append('tipo', info.tipo);
        form.append('nome', info.nome);
        form.append('mime', info.mime);
        form.append('arquivo', new Blob([buffer], { type: info.mime || 'application/octet-stream' }), info.nome);

        await axios.post(`${API_URL}/api/atendimento/interno/midia`, form, {
            headers: { 'X-N8N-Token': N8N_TOKEN },
            timeout: 120000,
            maxBodyLength: Infinity,
            maxContentLength: Infinity,
        });

        console.log(`[Midia] stored ${info.tipo} from ${telefone} (${buffer.length} bytes)`);
        return { ...info, bytes: buffer.length, messageId };
    } catch (erro) {
        console.log(`[Midia] failed to store: ${erro.message}`);
        return null;
    }
}

/**
 * Build the Baileys payload for an outgoing file.
 *
 * Audio goes as ptt (push to talk) only when it arrives as ogg/opus -
 * anything else shows up as a broken voice note on the customer's phone.
 */
function montarEnvio(tipo, buffer, nome, mime, legenda) {
    const caption = legenda || undefined;
    switch (tipo) {
        case 'image':
            return { image: buffer, caption, mimetype: mime || 'image/jpeg' };
        case 'video':
            return { video: buffer, caption, mimetype: mime || 'video/mp4' };
        case 'audio':
            return {
                audio: buffer,
                mimetype: mime || 'audio/ogg; codecs=opus',
                ptt: /ogg|opus/i.test(mime || ''),
            };
        case 'sticker':
            return { sticker: buffer };
        default:
            return {
                document: buffer,
                fileName: nome || 'arquivo',
                mimetype: mime || 'application/octet-stream',
                caption,
            };
    }
}

module.exports = { descrever, guardarRecebida, montarEnvio, TIPOS, MAX_BYTES };
