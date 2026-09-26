/**
 * Citacoes: quando o cliente responde uma mensagem especifica.
 *
 * O n8n grava so a linha de texto em `mensagens`, e nao tem como saber que
 * aquilo era resposta a outra coisa - a informacao vive no `contextInfo` do
 * protocolo, que morre no bot. Entao o bot a entrega direto a API, amarrada
 * pelo message_id, do mesmo jeito que faz com os arquivos. O workflow do n8n
 * nao muda em nada.
 *
 * Por que um extrator proprio, em vez de usar o extractMessageContent que ja
 * existe: aquele foi escrito para tirar o TEXTO da mensagem e repete o mesmo
 * bloco de citacao em cada tipo, sem pegar o id do que foi citado - e sem o
 * id nao da para ligar a citacao a mensagem original que esta no banco. Aqui
 * a varredura e generica: serve para tipo que ainda nem existe.
 */

const axios = require('axios');

const API_URL = (process.env.ATENDIMENTO_API_URL || 'http://atendimento-api:5100').replace(/\/+$/, '');
const N8N_TOKEN = (process.env.N8N_TOKEN || '').trim();

// Quanto do texto citado guardar. A citacao na tela e uma linha ou duas;
// guardar o texto inteiro de uma mensagem longa so engorda a tabela.
const MAX_TEXTO = 300;

const TIPOS = {
    imageMessage: 'image',
    videoMessage: 'video',
    audioMessage: 'audio',
    documentMessage: 'document',
    stickerMessage: 'sticker',
};

/** Tira as camadas que o WhatsApp poe por fora: efemera, ver uma vez, etc. */
function desembrulhar(message) {
    return message?.ephemeralMessage?.message
        || message?.viewOnceMessage?.message
        || message?.viewOnceMessageV2?.message
        || message?.documentWithCaptionMessage?.message
        || message;
}

/** O texto que representa a mensagem citada, e de que tipo ela e. */
function resumir(citada) {
    const m = desembrulhar(citada) || {};

    for (const [campo, tipo] of Object.entries(TIPOS)) {
        if (!m[campo]) continue;
        const texto = m[campo].caption || m[campo].fileName || '';
        return { tipo, texto: String(texto).slice(0, MAX_TEXTO) };
    }

    const texto = m.conversation
        || m.extendedTextMessage?.text
        || m.buttonsResponseMessage?.selectedDisplayText
        || m.listResponseMessage?.title
        || '';
    return { tipo: 'conversation', texto: String(texto).slice(0, MAX_TEXTO) };
}

/**
 * A citacao da mensagem, se houver. Null quando nao e resposta a nada.
 *
 * Varre os campos procurando um contextInfo com quotedMessage, em vez de
 * testar tipo por tipo: qualquer tipo de mensagem pode ser uma resposta, e
 * o WhatsApp acrescenta tipos novos de tempos em tempos.
 */
function descrever(message) {
    const m = desembrulhar(message);
    if (!m || typeof m !== 'object') return null;

    for (const chave of Object.keys(m)) {
        const ctx = m[chave]?.contextInfo;
        if (!ctx?.quotedMessage) continue;
        const resumo = resumir(ctx.quotedMessage);
        return {
            citadoId: String(ctx.stanzaId || ''),
            citadoTexto: resumo.texto,
            citadoTipo: resumo.tipo,
        };
    }
    return null;
}

/**
 * Entrega a citacao a API. Nao aguardada por quem chama e nunca lanca: a
 * citacao e contexto, nao pode atrasar nem derrubar a resposta ao cliente.
 */
async function guardar(msg, telefone) {
    try {
        if (!N8N_TOKEN || !telefone) return null;
        const citacao = descrever(msg?.message);
        if (!citacao) return null;

        const messageId = msg?.key?.id;
        if (!messageId) return null;

        // Sem id do citado E sem texto nao ha o que mostrar na tela.
        if (!citacao.citadoId && !citacao.citadoTexto) return null;

        await axios.post(`${API_URL}/api/atendimento/interno/resposta`, {
            whatsapp: telefone,
            message_id: messageId,
            citado_id: citacao.citadoId,
            citado_texto: citacao.citadoTexto,
            citado_tipo: citacao.citadoTipo,
        }, { headers: { 'X-N8N-Token': N8N_TOKEN }, timeout: 15000 });

        console.log(`[Resposta] ${telefone} citou ${citacao.citadoId || '(sem id)'}`);
        return citacao;
    } catch (erro) {
        console.log(`[Resposta] nao guardei a citacao: ${erro.message}`);
        return null;
    }
}

module.exports = { descrever, guardar, resumir, desembrulhar };
