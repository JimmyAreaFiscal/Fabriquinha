// Retomada automática do ticket que falhou por infraestrutura: o reinício do serviço, a falha transitória (HTTP 5xx,
// rede, tempo, SonarQube fora do ar) e a cota estourada do provedor não são culpa do ticket nem decisão do Auditor. A
// cada ciclo do agendador, a Fabriquinha devolve esses tickets a `aberto`; a seleção global os escolhe como os demais.
import type { DatabaseSync } from "node:sqlite";
import { FABRIQUINHA } from "../nucleo/ator.ts";
import type { TicketDemanda } from "../nucleo/agregado_demanda.ts";
import { type Modelo, resolverConfiguracaoAgente } from "../nucleo/configuracao_agente.ts";
import { formatarTicketRef } from "../nucleo/demanda.ts";
import { MAX_RETOMADAS_AUTOMATICAS, retomarTicketFalhoPorInfraestrutura } from "../nucleo/transicoes_demanda.ts";
import { PREFIXO_TERCEIRA_REPROVACAO } from "../nucleo/transicoes_rodada.ts";
import { configuracaoProjeto } from "../armazenamento/configuracao_projeto.ts";
import { comDemanda } from "../armazenamento/demandas.ts";
import { demandasParaDespacho } from "../armazenamento/despacho_demanda.ts";
import { noLog } from "../infra/registro.ts";

type CausaDeInfraestrutura = "reinicio" | "cota" | "transitoria";

const COTA = /quota exceeded|usage limit|rate limit|session limit|insufficient_quota|\b429\b/i;
const TRANSITORIA =
  /HTTP 5\d\d|\b50[234]\b|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|socket hang up|fetch failed|Connection error|TimeoutError|overloaded|tempo limite|inacessível/i;

/** A causa da falha quando ela é de infraestrutura; `undefined` quando é do ticket ou pede o Auditor (ex.: disco cheio). */
/** @testes o teste exercita direto; a produção a usa só dentro do módulo */
export function causaDeInfraestrutura(motivo: string): CausaDeInfraestrutura | undefined {
  // Decisão do Auditor, não falha de ambiente: os motivos anexados podem conter texto que casaria as regras abaixo.
  if (motivo.startsWith(PREFIXO_TERCEIRA_REPROVACAO)) return undefined;
  if (motivo === "serviço reiniciado") return "reinicio";
  if (COTA.test(motivo)) return "cota";
  // O fechamento do ticket prefixa assim o que as verificações e o commit classificaram como infraestrutura.
  return motivo.startsWith("falha de infraestrutura") || TRANSITORIA.test(motivo) ? "transitoria" : undefined;
}

// ponytail: equivalências fixas entre os provedores em uso (a regra do Auditor: cota estourada troca para o outro
// provedor, no mesmo nível); vira configuração do projeto quando entrar outro provedor.
const claudeParaCodex = (nome: string): Modelo => ({
  provedor: "openai-codex",
  nome: nome.includes("opus") ? "gpt-6.1-sol" : "gpt-6-luna",
});
const MODELO_RESERVA: Record<string, (nome: string) => Modelo> = {
  "claude-bridge": claudeParaCodex,
  anthropic: claudeParaCodex,
  "openai-codex": () => ({ provedor: "claude-bridge", nome: "claude-opus-5-5" }),
};

/** O modelo do outro provedor para o ticket cuja cota estourou; `undefined` sem modelo resolvido ou sem reserva. */
/** @testes o teste exercita direto; a produção a usa só dentro do módulo */
export function modeloReserva(modeloAtual: Modelo | undefined): Modelo | undefined {
  return modeloAtual && MODELO_RESERVA[modeloAtual.provedor]?.(modeloAtual.nome);
}

/** A falha transitória já esperou 2, 8 e 32 minutos antes da 1ª, 2ª e 3ª retomadas: dá tempo de o serviço voltar. */
const esperouOBastante = (t: TicketDemanda, agora: Date): boolean =>
  agora.getTime() - Date.parse(t.status_alterado_em) >= 2 * 4 ** (t.retomadas_automaticas ?? 0) * 60_000;

/**
 * Devolve a `aberto` os tickets falhos por infraestrutura das demandas em andamento: o do reinício sempre e na hora; o
 * transitório depois da espera; o da cota com o modelo reserva. Estes dois até MAX_RETOMADAS_AUTOMATICAS seguidas;
 * depois, e sem modelo reserva, ficam para o Auditor. Devolve os endereços retomados; o erro de um não para os outros.
 */
export function retomarFalhasDeInfraestrutura(banco: DatabaseSync, agora = new Date()): string[] {
  const retomados: string[] = [];
  for (const { agregado: ag } of demandasParaDespacho(banco)) {
    for (const t of ag.tickets) {
      const causa = t.status === "falhou" && t.motivo_falha ? causaDeInfraestrutura(t.motivo_falha) : undefined;
      if (causa === undefined) continue;
      const conta = causa !== "reinicio";
      if (conta && (t.retomadas_automaticas ?? 0) >= MAX_RETOMADAS_AUTOMATICAS) continue;
      if (causa === "transitoria" && !esperouOBastante(t, agora)) continue;
      let modelo: Modelo | undefined;
      if (causa === "cota") {
        const etapa = configuracaoProjeto(banco, ag.demanda.projeto)?.etapas.find((e) => e.etapa === t.etapa);
        const { modelo: modeloResolvido } = resolverConfiguracaoAgente({
          ticket: t.configuracao_agente,
          etapaDoProjeto: etapa?.configuracao_agente,
          padrao: {},
        });
        modelo = modeloReserva(modeloResolvido);
        if (!modelo) continue;
      }
      try {
        comDemanda(banco, ag.demanda.id, (a) =>
          retomarTicketFalhoPorInfraestrutura(
            a,
            { ticket_id: t.ticket_id, conta, ...(modelo && { modelo }) },
            FABRIQUINHA,
            { agora: agora.toISOString() },
          ),
        );
        retomados.push(formatarTicketRef(t));
      } catch (erro) {
        noLog(erro);
      }
    }
  }
  return retomados;
}
