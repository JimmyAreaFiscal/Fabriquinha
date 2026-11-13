// A visão do chat da sessão de um ticket (comparacao-sdlc-implementacao.md §9.1): junta a situação técnica, de Sessões (a
// sessão, as execuções, a conversa e o processo vivo), à do desenvolvimento, do Ciclo de Vida (a demanda, o ticket, o
// estado da sessão, a Pendência que a segura e as da demanda), no cabeçalho com os endereços públicos, na conversa com
// as marcas e no fluxo ao vivo; e o histórico da conversa em Markdown. A sessão que não é de um ticket não tem chat.
import type { DatabaseSync } from "node:sqlite";
import { raizDo } from "../../../shared/armazenamento/banco.ts";
import { encontrado } from "../../../shared/nucleo/erros.ts";
import type { Instante } from "../../../shared/nucleo/primitivos.ts";
import { type Relogio, relogioDoSistema } from "../../../shared/nucleo/relogio.ts";
import {
  type AgregadoDemanda,
  carregarDemanda,
  condutor,
  configuracao,
  type EstadoDaSessao,
  estadoEDesdeDaSessao,
  type EtapaTicket,
  execucaoDaSessao,
  formatarRodadaRef,
  formatarTicketRef,
  marcadorDaConversa,
  motivoDaFalhaDoTicket,
  pendenciaDaSessao,
  type PendenciaDoChat,
  pendenciaDoChat,
  pendenciasDaDemanda,
  promptsDaFabriquinha,
  type SessaoDoTicket,
  trabalhoVivoDaSessao,
} from "../../../modulos/ciclo_de_vida/publico.ts";
import {
  type Dialogo,
  emMarkdown,
  type EventoDaSessao,
  type Execucao,
  type Mensagem,
  type Modelo,
  type ModoTrabalho,
  type ResumoDaSessao,
  resumoDaSessao,
  resumosDasSessoesEmLote,
} from "../../../modulos/sessoes/publico.ts";
import { bloqueiosDaDemanda, predecessorasDasDemandas, predecessorasDe } from "../demandas/predecessoras.ts";

/** A sessão do ticket da demanda com o estado calculado; `execucao` é o id (uuid) da última execução. */
interface InfoSessaoDemanda {
  sessao: string;
  projeto: string;
  modo: ModoTrabalho;
  execucao: string;
  modelo?: Modelo;
  estado: EstadoDaSessao;
  /** A Pendência que segura a sessão enquanto ela espera o Auditor. */
  pendencia?: PendenciaDoChat;
  desde: Instante;
  dialogos: Dialogo[];
}

/** A execução como o chat a mostra: o motivo da falha é o da Tentativa que ela abriu. */
type ExecucaoDoChat = Execucao & { motivo?: string };

/** O que o Histórico lê da sessão; demanda, rodada e ticket pelo endereço público (D09). */
interface CabecalhoDaSessao {
  origem: "demanda";
  sessao: InfoSessaoDemanda;
  demanda: string;
  rodada?: string;
  ticket: string;
  etapa: EtapaTicket;
  /** O motivo da última Tentativa do ticket, na falha. */
  erro?: string;
  /** As execuções da sessão, em ordem, cada uma com o motivo da Tentativa que ela abriu, se essa falhou. */
  execucoes: ExecucaoDoChat[];
}

/** O que a barra de estado e as linhas do sistema do chat leem: a sessão e as Pendências da demanda dela. */
interface CabecalhoDemanda extends CabecalhoDaSessao {
  pendencias: PendenciaDoChat[];
}

/** Uma entrada do JSONL; o prompt montado pela Fabriquinha vem com `fabriquinha`. */
type EntradaDemanda = Record<string, unknown> & { fabriquinha?: true };

/** Um evento ao vivo do chat: o da sessão, com o cabeçalho novo no `estado` (o `message_end` leva também a autoria). */
type EventoDoChat = Exclude<EventoDaSessao, { type: "estado" }> | ({ type: "estado" } & CabecalhoDemanda);

export interface ChatDemanda {
  cabecalho: CabecalhoDemanda;
  conversa: EntradaDemanda[];
  /** Os eventos ao vivo; `{ type: "estado", ...cabecalho }` traz o cabeçalho novo. Devolve a função que cancela. */
  assinar(ouvinte: (evento: EventoDoChat) => void): () => void;
}

/** A sessão do resumo com o agregado da demanda dela e o ticket; recusa a sessão de ticket que não está no agregado. */
export function sessaoDoTicketDoResumo(ag: AgregadoDemanda, { execucoes, ...sessao }: ResumoDaSessao): SessaoDoTicket {
  const ticket = encontrado(
    ag.tickets.find((t) => t.ticket_id === sessao.ticket_id),
    `a sessão ${sessao.id} não existe`,
    "confira o endereço do chat",
  );
  return { ag, ticket, sessao, execucoes };
}

/** A sessão `id` do ticket, com o agregado e as execuções dela; `undefined` se o id não é de uma sessão. */
function lerSessaoDoTicket(banco: DatabaseSync, id: string): SessaoDoTicket | undefined {
  const resumo = resumoDaSessao(banco, id);
  return resumo && sessaoDoTicketDoResumo(carregarDemanda(banco, resumo.demanda_id), resumo);
}

/** O cabeçalho da sessão: o estado e a Pendência dela, pela situação viva do processo, e os endereços públicos. */
export function montarCabecalhoDaSessao(c: SessaoDoTicket, relogio: Relogio): CabecalhoDaSessao {
  const { ag, ticket, sessao, execucoes } = c;
  const viva = condutor.situacao(sessao.id);
  const estadoEDesde = estadoEDesdeDaSessao(c, viva);
  const [estado, desde] = estadoEDesde;
  const pendencia = pendenciaDaSessao(c, viva, estadoEDesde, relogio);
  const ultima = execucaoDaSessao(c);
  return {
    origem: "demanda",
    sessao: {
      sessao: sessao.id,
      projeto: ag.demanda.projeto,
      modo: sessao.modo,
      execucao: ultima.id,
      ...(ultima.configuracao_agente?.modelo && { modelo: ultima.configuracao_agente.modelo }),
      estado,
      ...(pendencia && { pendencia }),
      desde,
      dialogos: viva?.dialogos ?? [],
    },
    demanda: ag.demanda.id,
    ...(ticket.rodada_id !== undefined && {
      rodada: formatarRodadaRef({ demanda_id: ag.demanda.id, rodada_id: ticket.rodada_id }),
    }),
    ticket: formatarTicketRef(ticket),
    etapa: ticket.etapa,
    ...(pendencia?.tipo === "item_bloqueado" && { erro: motivoDaFalhaDoTicket(ag.tentativas, ticket) }),
    execucoes: execucoes.map((e) => {
      const resultado = ag.tentativas.find((t) => t.processo_id === e.id)?.resultado;
      return resultado && "motivo" in resultado && resultado.motivo !== undefined
        ? { ...e, motivo: resultado.motivo }
        : e;
    }),
  };
}

/** As sessões da demanda paradas no diálogo ou na conversa: o que `pendenciasDaDemanda` pede dos trabalhos vivos. */
function trabalhosVivosDaDemanda(banco: DatabaseSync, ag: AgregadoDemanda) {
  return resumosDasSessoesEmLote(banco, [ag.demanda.id])
    .map((resumo) => sessaoDoTicketDoResumo(ag, resumo))
    .filter((c) => c.execucoes.length > 0)
    .flatMap((c) => {
      const viva = condutor.situacao(c.sessao.id);
      return trabalhoVivoDaSessao(c, viva, estadoEDesdeDaSessao(c, viva)) ?? [];
    });
}

/** As Pendências da demanda, as mesmas do Início, para o chat mostrar o que a demanda espera do Auditor. */
function pendenciasDoChat(banco: DatabaseSync, ag: AgregadoDemanda, relogio: Relogio): PendenciaDoChat[] {
  const { id } = ag.demanda;
  const predecessorasSatisfeitas =
    bloqueiosDaDemanda(predecessorasDe(predecessorasDasDemandas(banco, [id]), id)).length === 0;
  return pendenciasDaDemanda(
    ag,
    trabalhosVivosDaDemanda(banco, ag),
    ag.pull_requests,
    configuracao(banco).agendadorAtivo,
    { agora: relogio.agora(), predecessorasSatisfeitas },
  ).map(pendenciaDoChat);
}

const montarCabecalho = (banco: DatabaseSync, c: SessaoDoTicket, relogio: Relogio): CabecalhoDemanda => ({
  ...montarCabecalhoDaSessao(c, relogio),
  pendencias: pendenciasDoChat(banco, c.ag, relogio),
});

/** A conversa do JSONL com o fluxo ao vivo; `undefined` se o id não é de uma sessão da demanda. */
export function abrirChatDemanda(
  banco: DatabaseSync,
  id: string,
  relogio: Relogio = relogioDoSistema,
): ChatDemanda | undefined {
  const c = lerSessaoDoTicket(banco, id);
  if (!c) return undefined;
  const raiz = raizDo(banco);
  const marcar = marcadorDaConversa(raiz, c);
  // Cada evento relê a sessão, que já existia ao abrir o chat.
  const relida = () =>
    encontrado(lerSessaoDoTicket(banco, id), `a sessão ${id} não existe`, "confira o endereço do chat");
  return {
    cabecalho: montarCabecalho(banco, c, relogio),
    conversa: condutor.lerConversa(raiz, id).map((e) => ({
      ...(e as EntradaDemanda),
      ...marcar((e as EntradaDemanda).message),
    })),
    assinar: (ouvinte) =>
      condutor.assinar(id, (evento) => {
        if (evento.type === "estado") ouvinte({ type: "estado", ...montarCabecalho(banco, relida(), relogio) });
        else if (evento.type === "message_end") {
          ouvinte({ ...evento, ...marcadorDaConversa(raiz, relida())(evento.message) });
        } else ouvinte(evento);
      }),
  };
}

/** O histórico da sessão em Markdown, na ordem da conversa, e o nome do arquivo; `undefined` se o id não é da demanda. */
export function exportarHistoricoDemanda(
  banco: DatabaseSync,
  id: string,
): { nome: string; markdown: string } | undefined {
  const c = lerSessaoDoTicket(banco, id);
  if (!c) return undefined;
  const raiz = raizDo(banco);
  const { ag, ticket } = c;
  const enderecoDoTicket = formatarTicketRef(ticket);
  const mensagens = condutor.lerConversa(raiz, id).flatMap((entrada) => {
    const { type, message } = entrada as { type?: string; message?: Mensagem };
    return type === "message" && message ? [message] : [];
  });
  const modelos = new Set(
    mensagens.filter((m) => m.role === "assistant").map((m) => `${String(m.provider)}/${String(m.model)}`),
  );
  const cabecalho = [
    `# Histórico da sessão ${enderecoDoTicket} (${ticket.etapa})`,
    "",
    `- Projeto: ${ag.demanda.projeto}`,
    `- Demanda: ${ag.demanda.id} — ${ag.demanda.titulo}`,
    ...(ticket.rodada_id === undefined
      ? []
      : [`- Rodada: ${formatarRodadaRef({ demanda_id: ag.demanda.id, rodada_id: ticket.rodada_id })}`]),
    `- Ticket: ${enderecoDoTicket} — ${ticket.titulo ?? ticket.etapa}`,
    `- Etapa: ${ticket.etapa}`,
    `- Modelo: ${[...modelos].join(", ") || "—"}`,
    `- Início: ${execucaoDaSessao(c, "primeira").inicio}`,
    `- Fim: ${execucaoDaSessao(c).fim ?? "em andamento"}`,
  ].join("\n");
  const daFabriquinha = promptsDaFabriquinha(raiz, c);
  return {
    nome: `historico-${enderecoDoTicket}.md`,
    markdown: [cabecalho, ...mensagens.flatMap((m) => emMarkdown(m, daFabriquinha))].join("\n\n") + "\n",
  };
}
