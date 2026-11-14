// A visão do chat da sessão de um ticket (comparacao-sdlc-implementacao.md §9.1): junta a situação técnica, de Sessões (a
// sessão, as execuções, a conversa e o processo vivo), à do desenvolvimento, do Ciclo de Vida (a demanda, o ticket, o
// estado da sessão, a Pendência que a segura e as da demanda), no cabeçalho com os endereços públicos, na conversa com
// as marcas e no fluxo ao vivo; e o histórico da conversa em Markdown. A sessão que não é de um ticket não tem chat.
import type { DatabaseSync } from "node:sqlite";
import type { GestaoDeDemandas } from "../../../../modulos/demandas/publico.ts";
import { encontrado } from "../../../../shared/nucleo/erros.ts";
import type { Instante } from "../../../../shared/nucleo/primitivos.ts";
import { type Relogio, relogioDoSistema } from "../../../../shared/nucleo/relogio.ts";
import {
  type CicloDeVida,
  Endereco,
  type EtapaTicket,
  type ResumoDaDemanda,
  type SessaoNoCicloDeVida,
} from "../../../../modulos/ciclo_de_vida/publico.ts";
import {
  type Dialogo,
  type EventoDaSessao,
  type Execucao,
  type Mensagem,
  type Modelo,
  type ModoTrabalho,
  montarSessoesDeAgente,
} from "../../../../modulos/sessoes/publico.ts";
import { emMarkdown } from "./markdown_da_conversa.ts";
import { bloqueiosDaDemanda, predecessorasDasDemandas, predecessorasDe } from "../demandas/leituras/predecessoras.ts";

/** A sessão do ticket da demanda com o estado calculado; `execucao` é o id (uuid) da última execução. */
interface InfoSessaoDemanda {
  sessao: string;
  projeto: string;
  modo: ModoTrabalho;
  execucao: string;
  modelo?: Modelo;
  estado: SessaoNoCicloDeVida["estado"];
  /** A Pendência que segura a sessão enquanto ela espera o Auditor. */
  pendencia?: PendenciaDoChat;
  desde: Instante;
  dialogos: Dialogo[];
}

/** A Pendência como o chat a leva: `item` pelo endereço público (D09). */
type PendenciaDoChat = NonNullable<ReturnType<SessaoNoCicloDeVida["pendencia"]>>;

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

/** A sessão `id` do ticket, com o agregado e as execuções dela; `undefined` se o id não é de uma sessão. */
function lerSessaoDoTicket(
  banco: DatabaseSync,
  cicloDeVida: CicloDeVida,
  id: string,
  relogio: Relogio,
): SessaoNoCicloDeVida | undefined {
  const [resumo] = montarSessoesDeAgente({ banco }).listar({ sessoes: [id] });
  return resumo && cicloDeVida.sessaoDoTicket(cicloDeVida.andamento(resumo.demanda_id).agregado, resumo, relogio);
}

/** O cabeçalho da sessão: o estado e a Pendência dela, pela situação viva do processo, e os endereços públicos. */
export function montarCabecalhoDaSessao(c: SessaoNoCicloDeVida): CabecalhoDaSessao {
  const { ag, ticket, sessao, execucoes, viva, estado, desde, ultima } = c;
  const pendencia = c.pendencia();
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
      rodada: Endereco.daRodada(ag.demanda.id, ticket.rodada_id).toString(),
    }),
    ticket: Endereco.doTicket(ag.demanda.id, ticket.ticket_id).toString(),
    etapa: ticket.etapa,
    ...(pendencia?.tipo === "item_bloqueado" && { erro: c.motivoDaFalha }),
    execucoes: execucoes.map((e) => {
      const resultado = ag.tentativas.find((t) => t.processo_id === e.id)?.resultado;
      return resultado && "motivo" in resultado && resultado.motivo !== undefined
        ? { ...e, motivo: resultado.motivo }
        : e;
    }),
  };
}

/** As sessões da demanda paradas no diálogo ou na conversa: o que as Pendências pedem dos trabalhos vivos. */
function trabalhosVivosDaDemanda(banco: DatabaseSync, cicloDeVida: CicloDeVida, ag: ResumoDaDemanda, relogio: Relogio) {
  return montarSessoesDeAgente({ banco })
    .listar({ demandas: [ag.demanda.id] })
    .filter((resumo) => resumo.execucoes.length > 0)
    .flatMap((resumo) => cicloDeVida.sessaoDoTicket(ag, resumo, relogio).trabalhoVivo ?? []);
}

/** As Pendências da demanda, as mesmas do Início, para o chat mostrar o que a demanda espera do Auditor. */
function pendenciasDoChat(
  banco: DatabaseSync,
  cicloDeVida: CicloDeVida,
  gestaoDeDemandas: GestaoDeDemandas,
  ag: ResumoDaDemanda,
  relogio: Relogio,
): PendenciaDoChat[] {
  const { id } = ag.demanda;
  const predecessorasSatisfeitas =
    bloqueiosDaDemanda(
      cicloDeVida.etapas(),
      predecessorasDe(predecessorasDasDemandas(cicloDeVida, gestaoDeDemandas, [id]), id),
    ).length === 0;
  return cicloDeVida
    .pendencias([ag], {
      vivos: trabalhosVivosDaDemanda(banco, cicloDeVida, ag, relogio),
      agora: relogio.agora(),
      predecessorasSatisfeitas: () => predecessorasSatisfeitas,
    })
    .map((pendencia) => ({ ...pendencia, item: pendencia.item.toString() }));
}

const montarCabecalho = (
  banco: DatabaseSync,
  cicloDeVida: CicloDeVida,
  gestaoDeDemandas: GestaoDeDemandas,
  c: SessaoNoCicloDeVida,
  relogio: Relogio,
): CabecalhoDemanda => ({
  ...montarCabecalhoDaSessao(c),
  pendencias: pendenciasDoChat(banco, cicloDeVida, gestaoDeDemandas, c.ag, relogio),
});

/** A conversa do JSONL com o fluxo ao vivo; `undefined` se o id não é de uma sessão da demanda. */
export function abrirChatDemanda(
  banco: DatabaseSync,
  cicloDeVida: CicloDeVida,
  gestaoDeDemandas: GestaoDeDemandas,
  id: string,
  relogio: Relogio = relogioDoSistema,
): ChatDemanda | undefined {
  const c = lerSessaoDoTicket(banco, cicloDeVida, id, relogio);
  if (!c) return undefined;
  const sessoes = montarSessoesDeAgente({ banco });
  const conversa = sessoes.conversa(id);
  const marcar = cicloDeVida.marcasDaConversa(conversa);
  // Cada evento relê a sessão, que já existia ao abrir o chat.
  const relida = () =>
    encontrado(
      lerSessaoDoTicket(banco, cicloDeVida, id, relogio),
      `a sessão ${id} não existe`,
      "confira o endereço do chat",
    );
  return {
    cabecalho: montarCabecalho(banco, cicloDeVida, gestaoDeDemandas, c, relogio),
    conversa: conversa.entradas.map((e) => ({
      ...(e as EntradaDemanda),
      ...marcar((e as EntradaDemanda).message),
    })),
    assinar: (ouvinte) =>
      sessoes.assinar(id, (evento) => {
        if (evento.type === "estado")
          ouvinte({ type: "estado", ...montarCabecalho(banco, cicloDeVida, gestaoDeDemandas, relida(), relogio) });
        else if (evento.type === "message_end") {
          // A conversa relida: a resposta automática pode ter chegado depois de o chat abrir.
          ouvinte({ ...evento, ...cicloDeVida.marcasDaConversa(sessoes.conversa(id))(evento.message) });
        } else ouvinte(evento);
      }),
  };
}

/** O histórico da sessão em Markdown, na ordem da conversa, e o nome do arquivo; `undefined` se o id não é da demanda. */
export function exportarHistoricoDemanda(
  banco: DatabaseSync,
  cicloDeVida: CicloDeVida,
  id: string,
): { nome: string; markdown: string } | undefined {
  const c = lerSessaoDoTicket(banco, cicloDeVida, id, relogioDoSistema);
  if (!c) return undefined;
  const { ag, ticket } = c;
  const enderecoDoTicket = Endereco.doTicket(ag.demanda.id, ticket.ticket_id).toString();
  const conversa = montarSessoesDeAgente({ banco }).conversa(id);
  const mensagens = conversa.entradas.flatMap((entrada) => {
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
      : [`- Rodada: ${Endereco.daRodada(ag.demanda.id, ticket.rodada_id).toString()}`]),
    `- Ticket: ${enderecoDoTicket} — ${ticket.titulo ?? ticket.etapa}`,
    `- Etapa: ${ticket.etapa}`,
    `- Modelo: ${[...modelos].join(", ") || "—"}`,
    `- Início: ${c.primeira.inicio}`,
    `- Fim: ${c.ultima.fim ?? "em andamento"}`,
  ].join("\n");
  const daFabriquinha = conversa.promptsDoPedido;
  return {
    nome: `historico-${enderecoDoTicket}.md`,
    markdown: [cabecalho, ...mensagens.flatMap((m) => emMarkdown(m, daFabriquinha))].join("\n\n") + "\n",
  };
}
