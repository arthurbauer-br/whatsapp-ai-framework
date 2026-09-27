/**
 * Logger para o Baileys que nao despeja segredo no terminal.
 *
 * Sem um logger proprio, o Baileys usa o pino dele no nivel `info` e imprime
 * o material criptografico do Signal - `privKey`, `rootKey`, `chainKey` - a
 * cada troca de chave, junto com o conteudo de eventos do protocolo. Isso vai
 * para o `docker logs`, que nao tem rotacao por padrao e e legivel por
 * qualquer um com acesso ao servidor. Quem pegasse esse arquivo teria como
 * ler as conversas.
 *
 * O truque esta em como o pino e chamado. A convencao dele e
 *
 *     logger.error({ objeto }, 'mensagem legivel')
 *
 * com o objeto primeiro e o texto depois. Entao basta ficar com os
 * argumentos que sao string: sai a mensagem util, some o objeto - que e
 * justamente onde as chaves viajam.
 *
 * BAILEYS_LOG controla o nivel:
 *   silent  - nao imprime nada
 *   error   - so erro e fatal (padrao)
 *   warn    - acrescenta avisos
 *   info    - acrescenta informativos (NAO recomendado: volta a vazar)
 */

const NIVEIS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4, trace: 5 };

const nivelTexto = (process.env.BAILEYS_LOG || 'error').trim().toLowerCase();
const nivel = NIVEIS[nivelTexto] ?? NIVEIS.error;

function fala(rotulo, peso) {
    return (...args) => {
        if (peso > nivel) return;
        // So as strings. O objeto do pino fica de fora de proposito.
        const texto = args.filter((a) => typeof a === 'string').join(' ').trim();
        if (texto) console.log(`[Baileys:${rotulo}] ${texto}`);
    };
}

const logger = {
    level: nivelTexto,
    // O Baileys cria sub-loggers por modulo. Todos compartilham esta regra.
    child: () => logger,
    trace: fala('trace', NIVEIS.trace),
    debug: fala('debug', NIVEIS.debug),
    info: fala('info', NIVEIS.info),
    warn: fala('warn', NIVEIS.warn),
    error: fala('error', NIVEIS.error),
    fatal: fala('fatal', NIVEIS.error),
};

module.exports = logger;
