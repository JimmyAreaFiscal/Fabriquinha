// As Pendências das demandas como as telas as mostram: o Início, o board, a página da demanda e a do projeto derivam das
// mesmas, pela regra única do núcleo, com o que cada uma precisa para levar ao chat ou à página da demanda.
import type { DatabaseSync } from "node:sqlite";
import type { Instante } from "../../../shared/nucleo/primitivos.ts";
import {
  type ResumoDaDemanda,
  CICLO_DA_DEMANDA,
  condutor,
  configuracao,
  Endereco,
  formatarRodadaRef,
  pendenciasDaDemanda,
  type TrabalhoVivo,
} from "../../../modulos/ciclo_de_vida/publico.ts";
import type { Situacao } from "../../../modulos/sessoes/publico.ts";
import type { PendenciaDoInicio } from "../../contrato/demanda.ts";
import { type SessaoDeDemanda, sessoesDasDemandas } from "../sessoes/historico_demanda.ts";
import { bloqueiosDaDemanda, type Predecessora, predecessorasDasDemandas, predecessorasDe } from "./predecessoras.ts";

/** O processo vivo da sessão, que só existe com o pi rodando; os testes o trocam. */
export type SituacaoDaSessao = (sessao: string) => Situacao | undefined;
export const situacaoDoCondutor: SituacaoDaSessao = (sessao) => condutor.situacao(sessao);

/** A sessão parada no diálogo (com a pergunta, que só o processo vivo tem) ou na conversa: o que `pendenciasDaDemanda` pede. */
/** @testes o teste exercita direto; a produção a usa só dentro do módulo */
export function trabalhoVivoDaSessao(s: SessaoDeDemanda, situacaoDa: SituacaoDaSessao): TrabalhoVivo {
  const pergunta = situacaoDa(s.sessao)?.dialogos[0]?.title;
  return {
    ticket: Endereco.ler(s.ticket),
    ...(typeof pergunta === "string" && { pergunta }),
    desde: s.desde,
  };
}

/** A sessão que espera o Auditor: parada no diálogo ou na conversa. */
const esperaOAuditor = (s: SessaoDeDemanda): boolean =>
  s.estado === "aguardando_humano" && s.pendencia?.tipo === "dialogo_do_agente";

/** As Pendências da demanda com o que o Início precisa para desenhá-las e levá-las ao chat ou à página da demanda. */
function pendenciasDoInicio(
  ag: ResumoDaDemanda,
  predecessoras: readonly Predecessora[],
  vivos: readonly TrabalhoVivo[],
  sessaoDoTicket: ReadonlyMap<string, string>,
  agendadorLigado: boolean,
  agora: Instante,
): PendenciaDoInicio[] {
  const { id: demanda, projeto, titulo } = ag.demanda;
  const predecessorasSatisfeitas = bloqueiosDaDemanda(predecessoras).length === 0;
  return pendenciasDaDemanda(ag, vivos, ag.pull_requests, agendadorLigado, { agora, predecessorasSatisfeitas }).map(
    (p) => {
      const item = p.item.toString();
      const rodada_id = p.item.rodada_id ?? ag.tickets.find((t) => t.ticket_id === p.item.ticket_id)?.rodada_id;
      const sessao = p.tipo === "dialogo_do_agente" ? sessaoDoTicket.get(item) : undefined;
      return {
        ...p,
        item,
        demanda,
        ...(rodada_id !== undefined && { rodada: formatarRodadaRef({ demanda_id: demanda, rodada_id }) }),
        projeto,
        titulo,
        ...(sessao !== undefined && { sessao }),
      };
    },
  );
}

/**
 * As Pendências das demandas, da mais antiga para a mais nova; `sessoes` são as ativas delas, de onde vêm os diálogos e as
 * conversas vivas.
 */
export function pendenciasDasDemandas(
  banco: DatabaseSync,
  demandas: readonly ResumoDaDemanda[],
  sessoes: readonly SessaoDeDemanda[],
  situacaoDa: SituacaoDaSessao,
  agora: Instante,
): PendenciaDoInicio[] {
  const sessoesParadas = sessoes.filter(esperaOAuditor);
  const vivos = sessoesParadas.map((s) => trabalhoVivoDaSessao(s, situacaoDa));
  const sessaoDoTicket = new Map(sessoesParadas.map((s) => [s.ticket, s.sessao]));
  const agendadorLigado = configuracao(banco).agendadorAtivo;
  const predecessoras = predecessorasDasDemandas(
    banco,
    demandas.map((ag) => ag.demanda.id),
  );
  return demandas
    .flatMap((ag) =>
      pendenciasDoInicio(
        ag,
        predecessorasDe(predecessoras, ag.demanda.id),
        vivos,
        sessaoDoTicket,
        agendadorLigado,
        agora,
      ),
    )
    .toSorted((a, b) => a.desde.localeCompare(b.desde));
}

/**
 * As Pendências de uma demanda em andamento, como o Início as desenha: o board e a página da demanda mostram as mesmas.
 * A demanda terminada não espera ninguém.
 */
export function pendenciasDeUmaDemanda(
  banco: DatabaseSync,
  ag: ResumoDaDemanda,
  situacaoDa: SituacaoDaSessao,
  agora: Instante,
): PendenciaDoInicio[] {
  if (CICLO_DA_DEMANDA.ehTerminal(ag.demanda.estado)) return [];
  const sessoes = sessoesDasDemandas(banco, [ag], { escopo: "ativas" });
  return pendenciasDasDemandas(banco, [ag], sessoes, situacaoDa, agora);
}
