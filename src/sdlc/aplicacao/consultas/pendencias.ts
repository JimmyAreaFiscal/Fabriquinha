// As Pendências das demandas como as telas as mostram: o Início, o board, a página da demanda e a do projeto derivam das
// mesmas, pela regra única do núcleo, com o que cada uma precisa para levar ao chat ou à página da demanda.
import type { DatabaseSync } from "node:sqlite";
import type { AgregadoDemanda } from "../../nucleo/demanda/agregado_demanda.ts";
import { CICLO_DA_DEMANDA } from "../../nucleo/ciclo_de_vida/ciclos.ts";
import { formatarRodadaRef } from "../../nucleo/demanda/demanda.ts";
import { predecessorasPendentes } from "../../nucleo/item_de_trabalho/dependencia_demanda.ts";
import { encontrado } from "../../../compartilhado/nucleo/erros.ts";
import { Endereco } from "../../nucleo/item_de_trabalho/item_de_trabalho.ts";
import { pendenciasDaDemanda, type TrabalhoVivo } from "../../nucleo/demanda/pendencia.ts";
import type { EstadoDemanda, Instante } from "../../../compartilhado/nucleo/primitivos.ts";
import { configuracao } from "../../../compartilhado/armazenamento/servico.ts";
import { predecessorasDasDemandas } from "../../armazenamento/dependencias_demanda.ts";
import type { PendenciaDoInicio } from "../../../entrega/contrato/demanda.ts";
import { condutor, type Situacao } from "../../../trabalho_agentico/aplicacao/trabalho/condutor.ts";
import {
  type SessaoDeDemanda,
  sessoesDeDemanda,
} from "../../../trabalho_agentico/aplicacao/sessoes/historico_demanda.ts";

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
  ag: AgregadoDemanda,
  predecessoras: readonly { demanda_id: string; estado: EstadoDemanda }[],
  vivos: readonly TrabalhoVivo[],
  sessaoDoTicket: ReadonlyMap<string, string>,
  agendadorLigado: boolean,
  agora: Instante,
): PendenciaDoInicio[] {
  const { id: demanda, projeto, titulo } = ag.demanda;
  const predecessorasSatisfeitas = predecessorasPendentes(predecessoras).length === 0;
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
  demandas: readonly AgregadoDemanda[],
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
    .flatMap((ag) => {
      const { id } = ag.demanda;
      const doId = encontrado(predecessoras.get(id), `a demanda ${id} não foi lida`, "recarregue");
      return pendenciasDoInicio(ag, doId, vivos, sessaoDoTicket, agendadorLigado, agora);
    })
    .toSorted((a, b) => a.desde.localeCompare(b.desde));
}

/**
 * As Pendências de uma demanda em andamento, como o Início as desenha: o board e a página da demanda mostram as mesmas.
 * A demanda terminada não espera ninguém.
 */
export function pendenciasDeUmaDemanda(
  banco: DatabaseSync,
  ag: AgregadoDemanda,
  situacaoDa: SituacaoDaSessao,
  agora: Instante,
): PendenciaDoInicio[] {
  if (CICLO_DA_DEMANDA.ehTerminal(ag.demanda.estado)) return [];
  const sessoes = sessoesDeDemanda(banco, { escopo: "ativas", demanda: ag.demanda.id });
  return pendenciasDasDemandas(banco, [ag], sessoes, situacaoDa, agora);
}
