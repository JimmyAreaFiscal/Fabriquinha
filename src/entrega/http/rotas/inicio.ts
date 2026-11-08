// Rota do Início (comparacao-sdlc §9.1, "Board com demanda"): numa leitura só, o mês corrente de todos os projetos, o que
// aguarda o Auditor, as sessões que rodam e o board, tudo das demandas em andamento. As concluídas, canceladas e
// arquivadas ficam fora; a navegação conta o que aguarda pela mesma rota.
import type { DatabaseSync } from "node:sqlite";
import type { ModoTrabalho } from "../../../nucleo/trabalho_agentico.ts";
import type { AgregadoDemanda, TicketDemanda } from "../../../nucleo/agregado_demanda.ts";
import { satisfazDependencia } from "../../../nucleo/cancelamento_demanda.ts";
import { CICLO_DA_DEMANDA, CICLO_DO_TICKET } from "../../../nucleo/ciclos.ts";
import { formatarRodadaRef, formatarTicketRef } from "../../../nucleo/demanda.ts";
import { predecessorasPendentes } from "../../../nucleo/dependencia_demanda.ts";
import { Endereco } from "../../../nucleo/item_de_trabalho.ts";
import { type Pendencia, pendenciasDaDemanda, type TrabalhoVivo } from "../../../nucleo/pendencia.ts";
import type { EtapaTicket, EstadoDemanda, EstadoRodada, EstadoTicket } from "../../../nucleo/primitivos.ts";
import { condutor, type Situacao } from "../../../aplicacao/trabalho/condutor.ts";
import { type SessaoDeDemanda, sessoesDeDemanda } from "../../../aplicacao/historico_demanda.ts";
import { mesDe } from "../../../nucleo/periodo.ts";
import { type MetricasMesDemanda, metricasDemandaPorMes } from "../../../aplicacao/periodo_demanda.ts";
import { listarDemandas } from "../../../armazenamento/demandas.ts";
import { predecessorasDaDemanda } from "../../../armazenamento/dependencias_demanda.ts";
import { configuracao } from "../../../armazenamento/servico.ts";
import { ticketsComPiAtivo } from "../../../armazenamento/trabalho_agentico.ts";
import type { Rota } from "../rotas.ts";

/** Um ticket como o Início o mostra; `modo` é o da sessão ativa dele, quando tem. */
interface TicketDoInicio {
  ref: string;
  etapa: EtapaTicket;
  estado: EstadoTicket;
  modo?: ModoTrabalho;
  /** Com execução de pi aberta: o `em_execucao` é o pi, não o sistema. */
  piAtivo?: true;
}

/**
 * Uma Pendência como o Início a mostra: `item` pelo endereço público, a demanda e a rodada (quando o item é de uma) que o
 * board e o cartão usam, e a `sessao` do chat quando é o diálogo do agente.
 */
export interface PendenciaDoInicio extends Omit<Pendencia, "item"> {
  item: string;
  demanda: string;
  rodada?: string;
  projeto: string;
  titulo: string;
  sessao?: string;
}

/** Uma sessão que roda, com o que o agente faz: o que o processo vivo diz ou, sem ele, o título do ticket. */
export type SessaoRodando = SessaoDeDemanda & { fazendo?: string };

/**
 * A coluna do board: o estado da demanda antes e depois da execução e, na execução, o estado de cada rodada (o encerramento
 * da demanda tem nome próprio, para não se confundir com o da rodada).
 */
export type ColunaDoBoard =
  | Exclude<EstadoDemanda, "em_execucao" | "encerrar_demanda" | "concluida" | "arquivada" | "cancelada">
  | "encerramento_demanda"
  | Exclude<EstadoRodada, "concluida">;

/** Um cartão do board: a demanda (`I-n`) ou, na execução, uma rodada dela (`I-n.Rm`). */
export interface CartaoDoBoard {
  coluna: ColunaDoBoard;
  ref: string;
  demanda: string;
  projeto: string;
  titulo: string;
  /** O ticket em curso: o falho ou em execução antes do aberto. */
  ticket?: TicketDoInicio;
  /** Quantos outros tickets do cartão ainda não terminaram. */
  outros: number;
  /** As predecessoras que ainda não satisfazem a dependência. */
  bloqueios: string[];
}

export interface DadosDoInicio {
  mes: MetricasMesDemanda;
  aguarda: PendenciaDoInicio[];
  rodando: SessaoRodando[];
  /** As demandas em andamento, que o board distribui nos cartões. */
  quantidadeEmAndamento: number;
  board: CartaoDoBoard[];
}

/** O ticket em curso de uma lista e quantos outros ainda não terminaram. */
function ticketEmCurso(
  tickets: readonly TicketDemanda[],
  modoDe: (ref: string) => ModoTrabalho | undefined,
  comPiAtivo: ReadonlySet<string>,
) {
  const abertos = tickets.filter((t) => !CICLO_DO_TICKET.ehTerminal(t.estado));
  const [ticket] = abertos.toSorted((a, b) => Number(a.estado === "aberto") - Number(b.estado === "aberto"));
  return {
    ...(ticket && { ticket: ticketDoInicio(ticket, modoDe, comPiAtivo) }),
    outros: Math.max(abertos.length - 1, 0),
  };
}

function ticketDoInicio(
  t: TicketDemanda,
  modoDe: (ref: string) => ModoTrabalho | undefined,
  comPiAtivo: ReadonlySet<string> = new Set(),
): TicketDoInicio {
  const ref = formatarTicketRef(t);
  const modo = modoDe(ref);
  return {
    ref,
    etapa: t.etapa,
    estado: t.estado,
    ...(modo && { modo }),
    ...(comPiAtivo.has(ref) && { piAtivo: true }),
  };
}

/**
 * A coluna da demanda que tem nome diferente do estado: o encerramento dela e a execução sem rodada aberta (antes da
 * primeira ou depois da última, até a revisão abrir), que fica no Desenvolvimento.
 */
const COLUNA_DO_ESTADO: Partial<Record<EstadoDemanda, ColunaDoBoard>> = {
  em_execucao: "implementar",
  encerrar_demanda: "encerramento_demanda",
};

/** Os cartões da demanda: um por rodada que não concluiu, na execução; senão, um só, o da demanda. */
function cartoesDaDemanda(
  banco: DatabaseSync,
  ag: AgregadoDemanda,
  modoDe: (ref: string) => ModoTrabalho | undefined,
  comPiAtivo: ReadonlySet<string>,
) {
  const { id: demanda, projeto, titulo, estado } = ag.demanda;
  const bloqueios = predecessorasDaDemanda(banco, demanda)
    .filter((p) => !satisfazDependencia(p.estado))
    .map((p) => p.demanda_id);
  const identificacao = { demanda, projeto, titulo, bloqueios };
  const abertas = ag.rodadas.filter((r) => r.estado !== "concluida");
  if (estado === "em_execucao" && abertas.length > 0) {
    return abertas.map((r): CartaoDoBoard => ({
      coluna: r.estado as ColunaDoBoard,
      ref: formatarRodadaRef(r),
      ...identificacao,
      ...ticketEmCurso(
        ag.tickets.filter((t) => t.rodada_id === r.rodada_id),
        modoDe,
        comPiAtivo,
      ),
    }));
  }
  const coluna = COLUNA_DO_ESTADO[estado] ?? (estado as ColunaDoBoard);
  const globais = ag.tickets.filter((t) => t.rodada_id === undefined);
  return [{ coluna, ref: demanda, ...identificacao, ...ticketEmCurso(globais, modoDe, comPiAtivo) }];
}

/** O processo vivo da sessão, que só existe com o pi rodando; os testes o trocam. */
type SituacaoDaSessao = (sessao: string) => Situacao | undefined;
const situacaoDoCondutor: SituacaoDaSessao = (sessao) => condutor.situacao(sessao);

/** A sessão parada no diálogo (com a pergunta, que só o processo vivo tem) ou na conversa: o que `pendenciasDaDemanda` pede. */
/** @testes o teste exercita direto; a produção a usa só dentro do módulo */
export function trabalhoVivoDaSessao(s: SessaoDeDemanda, situacaoDa: SituacaoDaSessao): TrabalhoVivo {
  const pergunta = s.motivo === "dialogo" ? situacaoDa(s.sessao)?.dialogos[0]?.title : undefined;
  return {
    ticket: Endereco.ler(s.ticket),
    ...(typeof pergunta === "string" && { pergunta }),
    desde: s.desde,
  };
}

/** A sessão que espera o Auditor: parada no diálogo ou na conversa. */
const esperaOAuditor = (s: SessaoDeDemanda): boolean =>
  s.estado === "aguardando_humano" && (s.motivo === "dialogo" || s.motivo === "conversa");

/** As Pendências da demanda com o que o Início precisa para desenhá-las e levá-las ao chat ou à página da demanda. */
function pendenciasDoInicio(
  banco: DatabaseSync,
  ag: AgregadoDemanda,
  vivos: readonly TrabalhoVivo[],
  sessaoDoTicket: ReadonlyMap<string, string>,
  agendadorLigado: boolean,
  agora: Date,
): PendenciaDoInicio[] {
  const { id: demanda, projeto, titulo } = ag.demanda;
  const predecessorasSatisfeitas = predecessorasPendentes(predecessorasDaDemanda(banco, demanda)).length === 0;
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
  agora: Date,
): PendenciaDoInicio[] {
  const sessoesParadas = sessoes.filter(esperaOAuditor);
  const vivos = sessoesParadas.map((s) => trabalhoVivoDaSessao(s, situacaoDa));
  const sessaoDoTicket = new Map(sessoesParadas.map((s) => [s.ticket, s.sessao]));
  const agendadorLigado = configuracao(banco).agendadorAtivo;
  return demandas
    .flatMap((ag) => pendenciasDoInicio(banco, ag, vivos, sessaoDoTicket, agendadorLigado, agora))
    .toSorted((a, b) => a.desde.localeCompare(b.desde));
}

/**
 * As Pendências de uma demanda em andamento, como o Início as desenha: o board e a página da demanda mostram as mesmas.
 * A demanda terminada não espera ninguém.
 */
export function pendenciasDeUmaDemanda(
  banco: DatabaseSync,
  ag: AgregadoDemanda,
  situacaoDa = situacaoDoCondutor,
  agora = new Date(),
): PendenciaDoInicio[] {
  if (CICLO_DA_DEMANDA.ehTerminal(ag.demanda.estado)) return [];
  const sessoes = sessoesDeDemanda(banco, { escopo: "ativas", demanda: ag.demanda.id });
  return pendenciasDasDemandas(banco, [ag], sessoes, situacaoDa, agora);
}

/** `GET /api/inicio`. */
/** @testes o teste exercita direto; a produção a usa só dentro do módulo */
export function inicio(banco: DatabaseSync, situacaoDa = situacaoDoCondutor, agora = new Date()): DadosDoInicio {
  const mes = mesDe(agora);
  // Um mês pedido, um mês devolvido.
  const [doMes] = metricasDemandaPorMes(banco, { de: mes, ate: mes }) as [MetricasMesDemanda];
  const demandas = listarDemandas(banco, { soNaoTerminadas: true });
  // Só as sessões das demandas em andamento: calcular o estado de todas as do banco custa segundos.
  const sessoes = demandas.flatMap((ag) => sessoesDeDemanda(banco, { escopo: "ativas", demanda: ag.demanda.id }));
  const modos = new Map(sessoes.map((s) => [s.ticket, s.modo]));
  const modoDe = (ref: string) => modos.get(ref);
  const comPiAtivo = ticketsComPiAtivo(banco);
  const tituloDoTicket = new Map(
    demandas.flatMap((ag) => ag.tickets.map((t) => [formatarTicketRef(t), t.titulo] as const)),
  );
  return {
    mes: doMes,
    aguarda: pendenciasDasDemandas(banco, demandas, sessoes, situacaoDa, agora),
    rodando: sessoes
      .filter((s) => s.estado === "rodando")
      .map((s) => {
        const fazendo = situacaoDa(s.sessao)?.atividade ?? tituloDoTicket.get(s.ticket);
        return { ...s, ...(fazendo !== undefined && { fazendo }) };
      }),
    quantidadeEmAndamento: demandas.length,
    board: demandas.flatMap((ag) => cartoesDaDemanda(banco, ag, modoDe, comPiAtivo)),
  };
}

export const ROTAS_DO_INICIO: Rota[] = [
  { metodo: "GET", caminho: "/api/inicio", tratar: ({ banco }) => inicio(banco) },
];
