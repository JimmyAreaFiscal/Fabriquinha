// As Pendências das demandas como as telas as mostram: o Início, o board, a página da demanda e a do projeto derivam das
// mesmas, pela regra única do núcleo, com o que cada uma precisa para levar ao chat ou à página da demanda.
import type { DatabaseSync } from "node:sqlite";
import type { GestaoDeDemandas } from "../../../../../modulos/demandas/publico.ts";
import type { Instante } from "../../../../../shared/nucleo/primitivos.ts";
import {
  type CicloDeVida,
  Endereco,
  type Pendencia,
  type ResumoDaDemanda,
  type TrabalhoVivo,
} from "../../../../../modulos/ciclo_de_vida/publico.ts";
import { encontrado } from "../../../../../shared/nucleo/erros.ts";
import { montarSessoesDeAgente, type Situacao } from "../../../../../modulos/sessoes/publico.ts";
import type { PendenciaDoInicio } from "../../contrato/demanda.ts";
import { type SessaoDeDemanda, sessoesDasDemandas } from "../../sessoes/historico_demanda.ts";
import { bloqueiosDaDemanda, predecessorasDasDemandas, predecessorasDe } from "./predecessoras.ts";

/** O processo vivo da sessão, que só existe com o pi rodando; os testes o trocam. */
export type SituacaoDaSessao = (sessao: string) => Situacao | undefined;

/**
 * O processo vivo de cada sessão, das sessões com execução aberta (só elas têm pi rodando), lidas uma vez, na primeira
 * pergunta.
 */
export function situacoesDoBanco(banco: DatabaseSync): SituacaoDaSessao {
  let situacaoPorSessao: Map<string, Situacao> | undefined;
  return (sessao) => {
    situacaoPorSessao ??= new Map(
      montarSessoesDeAgente({ banco })
        .listar({ abertas: true })
        .flatMap(({ id, situacao }) => (situacao ? [[id, situacao] as const] : [])),
    );
    return situacaoPorSessao.get(sessao);
  };
}

/** A sessão parada no diálogo (com a pergunta, que só o processo vivo tem) ou na conversa: o que as Pendências pedem. */
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

/** A Pendência da demanda `ag` com o que o Início precisa para desenhá-la e levá-la ao chat ou à página da demanda. */
function pendenciaDoInicio(
  ag: ResumoDaDemanda,
  p: Pendencia,
  sessaoDoTicket: ReadonlyMap<string, string>,
): PendenciaDoInicio {
  const { id: demanda, projeto, titulo } = ag.demanda;
  const item = p.item.toString();
  const rodada_id = p.item.rodada_id ?? ag.tickets.find((t) => t.ticket_id === p.item.ticket_id)?.rodada_id;
  const sessao = p.tipo === "dialogo_do_agente" ? sessaoDoTicket.get(item) : undefined;
  return {
    ...p,
    item,
    demanda,
    ...(rodada_id !== undefined && { rodada: Endereco.daRodada(demanda, rodada_id).toString() }),
    projeto,
    titulo,
    ...(sessao !== undefined && { sessao }),
  };
}

/**
 * As Pendências das demandas, da mais antiga para a mais nova; `sessoes` são as ativas delas, de onde vêm os diálogos e as
 * conversas vivas.
 */
export function pendenciasDasDemandas(
  cicloDeVida: CicloDeVida,
  gestaoDeDemandas: GestaoDeDemandas,
  demandas: readonly ResumoDaDemanda[],
  sessoes: readonly SessaoDeDemanda[],
  situacaoDa: SituacaoDaSessao,
  agora: Instante,
): PendenciaDoInicio[] {
  const sessoesParadas = sessoes.filter(esperaOAuditor);
  const vivos = sessoesParadas.map((s) => trabalhoVivoDaSessao(s, situacaoDa));
  const sessaoDoTicket = new Map(sessoesParadas.map((s) => [s.ticket, s.sessao]));
  const predecessoras = predecessorasDasDemandas(
    cicloDeVida,
    gestaoDeDemandas,
    demandas.map((ag) => ag.demanda.id),
  );
  const catalogo = cicloDeVida.etapas();
  const resumoDaDemanda = new Map(demandas.map((ag) => [ag.demanda.id, ag]));
  return cicloDeVida
    .pendencias(demandas, {
      vivos,
      agora,
      predecessorasSatisfeitas: (id) => bloqueiosDaDemanda(catalogo, predecessorasDe(predecessoras, id)).length === 0,
    })
    .map((p) =>
      pendenciaDoInicio(
        encontrado(resumoDaDemanda.get(p.item.demanda_id), `a demanda ${p.item.demanda_id} não foi lida`, "recarregue"),
        p,
        sessaoDoTicket,
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
  cicloDeVida: CicloDeVida,
  gestaoDeDemandas: GestaoDeDemandas,
  ag: ResumoDaDemanda,
  situacaoDa: SituacaoDaSessao,
  agora: Instante,
): PendenciaDoInicio[] {
  if (cicloDeVida.etapas().demanda.ehTerminal(ag.demanda.estado)) return [];
  const sessoes = sessoesDasDemandas(banco, cicloDeVida, [ag], { escopo: "ativas" });
  return pendenciasDasDemandas(cicloDeVida, gestaoDeDemandas, [ag], sessoes, situacaoDa, agora);
}
