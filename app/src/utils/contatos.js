/**
 * Nome e foto de perfil dos contatos, com ritmo de gente.
 *
 * A DECISAO de consultar nao mora aqui, mora na atendimento-api: ela tem o
 * banco, sabe o que ja esta em cache, e trava cada contato para que ele seja
 * consultado uma vez so - inclusive se este processo reiniciar. Este modulo
 * cuida do QUANDO:
 *
 *   - so em reacao a evento: mensagem recebida, ou o WhatsApp avisar que o
 *     contato trocou ou removeu a foto. Nenhuma varredura, nenhum timer que
 *     sai perguntando por conta propria;
 *   - uma consulta por vez, com 2 a 5 segundos aleatorios entre elas;
 *   - no maximo 100 por hora, em janela deslizante;
 *   - de tempos em tempos, uma pausa longa de 1 a 4 minutos, depois de um
 *     numero de consultas que tambem e sorteado;
 *   - nada de madrugada. O que chegar entre 23h e 7h espera amanhecer, e
 *     recomeca num minuto sorteado, nao as 7h em ponto.
 *
 * O NOME nao passa por nada disso. O pushName vem dentro da propria
 * mensagem - pegar ele nao e uma consulta ao WhatsApp, e ler o que ja chegou.
 * Ele vai para a API na hora.
 *
 * A FOTO sai em duas etapas, e as duas passam pelo proxy residencial:
 *
 *   1. sock.profilePictureUrl(jid, 'image') - uma pergunta no WebSocket, que
 *      ja esta no proxy desde a conexao;
 *   2. o download da imagem em pps.whatsapp.net - um fetch() comum, que NAO
 *      herda o proxy do socket. Sem o dispatcher, a foto de cada cliente
 *      seria baixada do IP do datacenter.
 */

const axios = require('axios');

const API_URL = (process.env.ATENDIMENTO_API_URL || 'http://atendimento-api:5100').replace(/\/+$/, '');
const N8N_TOKEN = (process.env.N8N_TOKEN || '').trim();

const MAX_POR_HORA = inteiro(process.env.CONTATOS_MAX_HORA, 100);
const ATRASO_MIN_MS = inteiro(process.env.CONTATOS_ATRASO_MIN_MS, 2000);
const ATRASO_MAX_MS = inteiro(process.env.CONTATOS_ATRASO_MAX_MS, 5000);
// "23-7": das 23h as 7h, horario de Brasilia, nenhuma consulta.
const SILENCIO = faixa(process.env.CONTATOS_SILENCIO || '23-7');
const FUSO = 'America/Sao_Paulo';
const FOTO_MAX_BYTES = 1024 * 1024;
// Fila cheia e sinal de algo errado. Descartar e seguro: a trava na API
// vence em 12h, e a proxima mensagem do contato poe ele de volta.
const FILA_MAX = 1000;
// Mesmo nome, mesmo contato, dentro disto: nao avisa a API de novo. A
// decisao dela nao muda em minutos - a trava dura 12 horas.
const REAVISO_MS = 10 * 60 * 1000;

// ------------------------------------------------------------------ //
const fila = new Map();          // numero -> { jid, desde }
const feitas = [];               // horarios das consultas na ultima hora
const avisados = new Map();      // numero -> { nome, em }
const nomesDaAgenda = new Map(); // numero -> nome (contacts.upsert/update)
let rodando = false;
let desdeUltimaPausa = 0;
let proximaPausaApos = sortearInteiro(8, 20);
let ctx = null;

function inteiro(v, padrao) {
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : padrao;
}

function faixa(texto) {
    const m = String(texto).match(/^(\d{1,2})-(\d{1,2})$/);
    if (!m) return { de: 23, ate: 7 };
    return { de: Number(m[1]) % 24, ate: Number(m[2]) % 24 };
}

function sortear(min, max) {
    return min + Math.random() * (max - min);
}

function sortearInteiro(min, max) {
    return Math.floor(sortear(min, max + 1));
}

function dormir(ms) {
    return new Promise((ok) => setTimeout(ok, Math.max(0, ms)));
}

function digitos(jid) {
    return String(jid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
}

// ------------------------------------------------------------------ //
// Relogio
// ------------------------------------------------------------------ //
/**
 * Hora e minuto em Brasilia, pelo Intl e nao pelo getHours().
 *
 * O container e node:22-alpine: o TZ=America/Sao_Paulo do compose so vale
 * para getHours() se o tzdata estiver instalado na imagem, e no alpine ele
 * nao vem. O Intl usa o ICU embutido no Node, que traz os fusos sempre.
 */
function agoraEmBrasilia(data = new Date()) {
    const partes = new Intl.DateTimeFormat('en-GB', {
        timeZone: FUSO, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(data);
    const v = (t) => Number(partes.find((p) => p.type === t)?.value || 0);
    return { hora: v('hour'), minuto: v('minute') };
}

function emSilencio(hora) {
    const { de, ate } = SILENCIO;
    if (de === ate) return false;
    // Faixa que atravessa a meia-noite (23-7) ou nao (1-6).
    return de > ate ? (hora >= de || hora < ate) : (hora >= de && hora < ate);
}

/** Quantos ms ate o fim do silencio, contando de agora. */
function msAteAmanhecer(data = new Date()) {
    const { hora, minuto } = agoraEmBrasilia(data);
    let minutos = (SILENCIO.ate * 60) - (hora * 60 + minuto);
    if (minutos <= 0) minutos += 24 * 60;
    return minutos * 60 * 1000;
}

async function esperarAmanhecer() {
    if (!emSilencio(agoraEmBrasilia().hora)) return;
    // Mais 5 a 50 minutos sorteados: recomecar as 7h00 em ponto, todo dia,
    // seria justamente o padrao fixo que se quer evitar.
    const espera = msAteAmanhecer() + sortear(5, 50) * 60 * 1000;
    console.log(`[Contatos] madrugada - ${fila.size} na fila, retomo em ${Math.round(espera / 60000)} min`);
    await dormir(espera);
}

async function esperarCota() {
    const umaHora = 60 * 60 * 1000;
    while (feitas.length && Date.now() - feitas[0] > umaHora) feitas.shift();
    if (feitas.length < MAX_POR_HORA) return;
    const espera = feitas[0] + umaHora - Date.now() + sortear(10, 120) * 1000;
    console.log(`[Contatos] ${MAX_POR_HORA}/hora atingido - pausa de ${Math.round(espera / 60000)} min`);
    await dormir(espera);
}

async function talvezPausaLonga() {
    desdeUltimaPausa += 1;
    if (desdeUltimaPausa < proximaPausaApos) return;
    const espera = sortear(60, 240) * 1000;
    console.log(`[Contatos] pausa longa de ${Math.round(espera / 1000)}s`);
    desdeUltimaPausa = 0;
    proximaPausaApos = sortearInteiro(8, 20);
    await dormir(espera);
}

// ------------------------------------------------------------------ //
// Conversa com a atendimento-api
// ------------------------------------------------------------------ //
function cabecalhos() {
    return { 'X-N8N-Token': N8N_TOKEN };
}

async function avisarApi(numero, nome) {
    const r = await axios.post(`${API_URL}/api/atendimento/interno/contato`,
        { whatsapp: numero, nome: nome || '' },
        { headers: cabecalhos(), timeout: 15000 });
    return !!r.data?.buscar_foto;
}

async function avisarEventos(lote) {
    const r = await axios.post(`${API_URL}/api/atendimento/interno/contatos/eventos`,
        { contatos: lote },
        { headers: cabecalhos(), timeout: 30000 });
    return Array.isArray(r.data?.buscar) ? r.data.buscar : [];
}

async function entregarFoto(numero, resultado) {
    const form = new FormData();
    form.append('whatsapp', numero);
    form.append('estado', resultado.estado);
    if (resultado.estado === 'ok') {
        form.append('arquivo', new Blob([resultado.dados], { type: 'image/jpeg' }), 'foto.jpg');
    }
    await axios.post(`${API_URL}/api/atendimento/interno/contato/foto`, form,
        { headers: cabecalhos(), timeout: 30000 });
}

// ------------------------------------------------------------------ //
// A consulta em si
// ------------------------------------------------------------------ //
/**
 * Pergunta a URL da foto e baixa a imagem. Nunca lanca.
 *
 * Devolve { estado: 'ok', dados } | { estado: 'sem_foto' } | { estado: 'erro' }.
 *
 * "sem_foto" e "erro" sao coisas diferentes e a API trata diferente: sem
 * foto vale 30 dias; erro vale 24 horas e NAO apaga a foto que ja existia.
 */
async function consultarFoto(sock, jid, dispatcher) {
    let url;
    try {
        url = await sock.profilePictureUrl(jid, 'image', 15000);
    } catch (erro) {
        // O Baileys lanca Boom com o codigo do WhatsApp em `data`:
        // 401 = a privacidade do contato esconde a foto de voce;
        // 404 = ele nao tem foto. Os dois sao respostas, nao falhas.
        const codigo = Number(erro?.data ?? erro?.output?.statusCode ?? 0);
        if ([401, 403, 404].includes(codigo)
            || /not-authorized|item-not-found|not-found/i.test(erro?.message || '')) {
            return { estado: 'sem_foto' };
        }
        return { estado: 'erro', motivo: erro?.message || String(erro) };
    }
    if (!url) return { estado: 'sem_foto' };

    // Sem dispatcher, nao baixa. Fail-closed, como o resto do bot: melhor
    // ficar sem a foto do que busca-la do IP do datacenter.
    if (!dispatcher) return { estado: 'erro', motivo: 'sem_proxy' };

    try {
        const resp = await fetch(url, { dispatcher, signal: AbortSignal.timeout(20000) });
        if (resp.status === 404) return { estado: 'sem_foto' };
        if (!resp.ok) return { estado: 'erro', motivo: `http_${resp.status}` };
        const declarado = Number(resp.headers.get('content-length') || 0);
        if (declarado > FOTO_MAX_BYTES) return { estado: 'erro', motivo: 'grande_demais' };
        const dados = Buffer.from(await resp.arrayBuffer());
        if (!dados.length) return { estado: 'sem_foto' };
        if (dados.length > FOTO_MAX_BYTES) return { estado: 'erro', motivo: 'grande_demais' };
        return { estado: 'ok', dados };
    } catch (erro) {
        return { estado: 'erro', motivo: erro?.message || String(erro) };
    }
}

// ------------------------------------------------------------------ //
// A fila
// ------------------------------------------------------------------ //
function enfileirar(numero) {
    if (!numero || fila.has(numero)) return;
    if (fila.size >= FILA_MAX) {
        console.log(`[Contatos] fila cheia (${FILA_MAX}) - ${numero} fica para a proxima mensagem dele`);
        return;
    }
    // Sempre o JID de telefone. O profilePictureUrl normaliza e resolve o
    // LID sozinho quando precisa do token de privacidade.
    fila.set(numero, { jid: `${numero}@s.whatsapp.net`, desde: Date.now() });
    if (!rodando) processar();
}

async function processar() {
    if (rodando || !ctx) return;
    rodando = true;
    try {
        while (fila.size) {
            await esperarAmanhecer();
            await esperarCota();
            await talvezPausaLonga();
            await dormir(sortear(ATRASO_MIN_MS, ATRASO_MAX_MS));

            const sock = ctx.obterSocket();
            if (!sock || !ctx.conectado()) {
                // Desconectado: o item fica na fila. Espera irregular tambem
                // aqui - reconexao seguida de rajada de consultas e um padrao
                // tao reconhecivel quanto qualquer outro.
                await dormir(sortear(30, 90) * 1000);
                continue;
            }

            const [numero, item] = fila.entries().next().value;
            fila.delete(numero);
            feitas.push(Date.now());

            const resultado = await consultarFoto(sock, item.jid, ctx.dispatcher);
            const extra = resultado.estado === 'ok'
                ? ` (${resultado.dados.length} bytes)`
                : (resultado.motivo ? ` (${resultado.motivo})` : '');
            console.log(`[Contatos] foto de ${numero}: ${resultado.estado}${extra}`);

            try {
                await entregarFoto(numero, resultado);
            } catch (erro) {
                // A API nao recebeu: a trava dela segura por 12h e depois
                // solta sozinha. Nao repete aqui - repetir e o que as regras
                // pedem para nao fazer.
                console.log(`[Contatos] API nao recebeu a foto de ${numero}: ${erro.message}`);
            }
        }
    } catch (erro) {
        console.log(`[Contatos] fila parou: ${erro.message}`);
    } finally {
        rodando = false;
    }
}

// ------------------------------------------------------------------ //
// Entradas: os eventos do Baileys
// ------------------------------------------------------------------ //
/**
 * Uma vez, na subida. As funcoes em vez dos objetos porque o socket e
 * recriado a cada reconexao - guardar a referencia seria guardar um morto.
 */
function iniciar({ obterSocket, conectado, dispatcher, resolverNumero }) {
    ctx = { obterSocket, conectado, dispatcher, resolverNumero };
    if (!N8N_TOKEN) console.log('[Contatos] N8N_TOKEN vazio - nome e foto desligados');
}

/**
 * Mensagem recebida. Nao e aguardada por quem chama e nunca lanca: nome e
 * foto sao enfeite, nao podem atrasar nem derrubar a resposta ao cliente.
 */
async function aoReceber(msg, numero) {
    try {
        if (!ctx || !N8N_TOKEN || !numero) return;
        const nome = String(msg?.pushName || msg?.verifiedBizName || '').trim()
            || nomesDaAgenda.get(numero) || '';

        const ultimo = avisados.get(numero);
        if (ultimo && ultimo.nome === nome && Date.now() - ultimo.em < REAVISO_MS) return;

        const buscar = await avisarApi(numero, nome);
        // Marca como avisado so DEPOIS que a API aceitou. Marcando antes, uma
        // falha dela (banco fora, migracao faltando) calava este contato por
        // 10 minutos - e a proxima mensagem dele nao tentava de novo.
        avisados.set(numero, { nome, em: Date.now() });
        if (avisados.size > 5000) avisados.delete(avisados.keys().next().value);
        if (buscar) enfileirar(numero);
    } catch (erro) {
        console.log(`[Contatos] aviso de ${numero} falhou: ${erro.message}`);
    }
}

/**
 * contacts.upsert e contacts.update.
 *
 * Na primeira sincronizacao chega a agenda inteira do celular. Vai tudo num
 * lote so, e a API descarta quem nunca escreveu - nenhuma foto e consultada
 * por causa disto, a nao ser de quem ja e contato E trocou a foto.
 */
async function aoEventoContatos(lista) {
    try {
        if (!ctx || !N8N_TOKEN || !Array.isArray(lista) || !lista.length) return;

        const lote = [];
        for (const c of lista) {
            let numero = '';
            const id = String(c?.id || '');
            // Grupo, canal e lista de transmissao tambem trocam de foto, e o
            // id deles tem digitos suficientes para parecer telefone.
            if (/@(g\.us|newsletter|broadcast)$/.test(id)) continue;
            if (id.endsWith('@s.whatsapp.net')) numero = digitos(id);
            else if (c?.phoneNumber) numero = digitos(c.phoneNumber);
            else if (id.endsWith('@lid') && ctx.resolverNumero) {
                numero = (await ctx.resolverNumero(id)) || '';
            }
            if (!numero || numero.length < 10) continue;

            // Ordem do objeto de contato: o nome salvo na sua agenda, depois
            // o que ele escolheu, depois o nome verificado de empresa.
            const nome = String(c?.name || c?.notify || c?.verifiedName || '').trim();
            const img = (c?.imgUrl === 'changed' || c?.imgUrl === 'removed') ? c.imgUrl : null;
            if (nome) {
                nomesDaAgenda.set(numero, nome);
                if (nomesDaAgenda.size > 5000) nomesDaAgenda.delete(nomesDaAgenda.keys().next().value);
            }
            if (nome || img) lote.push({ whatsapp: numero, nome, img });
        }

        for (let i = 0; i < lote.length; i += 200) {
            const buscar = await avisarEventos(lote.slice(i, i + 200));
            buscar.forEach(enfileirar);
        }
    } catch (erro) {
        console.log(`[Contatos] evento de contatos falhou: ${erro.message}`);
    }
}

function situacao() {
    return {
        fila: fila.size,
        ultimaHora: feitas.filter((t) => Date.now() - t < 3600000).length,
        maxPorHora: MAX_POR_HORA,
        rodando,
        silencio: `${SILENCIO.de}h-${SILENCIO.ate}h`,
        emSilencio: emSilencio(agoraEmBrasilia().hora),
    };
}

module.exports = {
    iniciar, aoReceber, aoEventoContatos, situacao,
    // expostos para os testes
    _interno: {
        consultarFoto, enfileirar, processar, fila, feitas,
        emSilencio, msAteAmanhecer, agoraEmBrasilia, faixa,
        definirSilencio: (de, ate) => { SILENCIO.de = de; SILENCIO.ate = ate; },
    },
};
