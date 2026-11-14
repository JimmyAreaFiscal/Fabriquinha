// A montagem do Ciclo de Vida (PROPOSTA §4.2) e a interface `CicloDeVida`, que combina os subdomínios: o que a composição
// liga ao Ciclo de Vida como dado de Demandas (os projetos, os pedidos, as predecessoras e a conclusão do pedido), os
// módulos de que a condução depende e, na subida do serviço, a recuperação dos tickets sem processo e o agendador do
// Despacho, que o `parar` desliga. Despacho, condução, verificações, recuperação e retomada ficam internos.
import type { DatabaseSync } from "node:sqlite";
import type { GestaoDeAmbientes } from "../../../ambiente/publico.ts";
import type { RepositorioDoProjeto } from "../../../repositorio/publico.ts";
import {
  montarSessoesDeAgente,
  type RespostaAoDialogo,
  type SessoesDeAgente,
  type SubidaDasSessoes,
} from "../../../sessoes/publico.ts";
import { existe } from "../../../../shared/nucleo/erros.ts";
import { noLog } from "../../../../shared/infra/registro.ts";
import type { Instante } from "../../../../shared/nucleo/primitivos.ts";
import { type Relogio, relogioDoSistema } from "../../../../shared/nucleo/relogio.ts";
import { type Ator, AUDITOR, Endereco } from "../../etapas/publico.ts";
import {
  type AgregadoDemanda,
  arquivar,
  arquivarConcluidas,
  cancelarDemanda,
  cancelarProcessosEmCascata,
  comCampoInvalidoComoErroDeRegra,
  type ContextoDemanda,
  criarProcessoDoPedido,
  falharTicketEmExecucao,
  levarAoGateDaDemanda,
  ligarLeituraDosPedidosRecebidos,
  type PedidoRecebido,
  reabrir,
  type TicketDemanda,
} from "../../processo/publico.ts";
import {
  abortarDemanda,
  concluirSessaoAjustes,
  decidirGate,
  despachoDasEtapas,
  enviarDemanda,
  GATE_DA_DEMANDA,
  interromperExecucoesDasDemandas,
  ligarConclusaoDoDesenvolvimento,
  ligarLeituraDosLimitesDasSessoes,
  ligarLeituraDosProjetosCadastrados,
  type ModulosDoCiclo,
  type ProjetoConduzido,
  recuperacaoDosTicketsNaSubida,
  type RefRodada,
  responderDialogoDemanda,
} from "../../conducao/publico.ts";
import {
  cicloDoDespacho,
  type Configuracao,
  configuracao,
  executarAgora as executarAgoraNoDespacho,
  type MotivoDeRecusa,
  validarESalvarConfiguracao,
} from "../../despacho/publico.ts";
import { ligarAgendadorDoDespacho } from "./agendador_do_despacho.ts";

/** O que o Ciclo de Vida lê de Demandas como dado (o Ciclo de Vida não importa Demandas), sobre um banco. */
export interface DemandasDoCicloDeVida {
  /** O projeto cadastrado, ou `ErroDeInexistente` com a orientação. */
  projeto(nome: string, orientacaoSeNaoExistir?: string): ProjetoConduzido;
  /** Os pedidos `ids`, pelo id, numa leitura só; o id sem pedido não entra no mapa. */
  pedidos(ids: readonly string[]): ReadonlyMap<string, PedidoRecebido>;
  /** As predecessoras que ainda não concluíram de cada pedido de `ids`; o pedido sem nenhuma está liberado. */
  predecessorasPendentes(ids: readonly string[]): ReadonlyMap<string, readonly string[]>;
  /** Grava o encerramento do processo junto da conclusão do pedido, na mesma unidade de trabalho. */
  concluir(id: string, gravarEncerramentoDoProcesso: () => void): void;
}

export interface MontagemDoCicloDeVida {
  banco: DatabaseSync;
  /**
   * O que o Ciclo de Vida lê de Demandas, sobre o banco que cada leitura usa.
   * ponytail: a leitura é uma por processo (a última montagem vale), porque o agregado a usa onde só há o banco; todas as
   * montagens de um processo passam a mesma.
   */
  demandas: (banco: DatabaseSync) => DemandasDoCicloDeVida;
  /** Quem aloca o Ambiente de cada Espaço; sem ela, as conduções e as interrupções recusam. */
  ambientes?: GestaoDeAmbientes;
  /** Sem elas, as do motor do banco. */
  sessoes?: SessoesDeAgente;
  repositorio: RepositorioDoProjeto;
  relogio?: Relogio;
}

/** A subida do serviço: as Sessões montadas depois da recuperação dos tickets e o agendador, que o `parar` desliga. */
interface SubidaDoCicloDeVida extends Omit<MontagemDoCicloDeVida, "sessoes"> {
  /** Monta as Sessões da subida, que matam os processos da instância anterior e avisam cada execução órfã encerrada. */
  subirSessoes(subida: SubidaDasSessoes): Promise<SessoesDeAgente>;
  /** O log do serviço, para o erro da batida do agendador. */
  registrarErro: (erro: unknown) => void;
}

/** O ticket pelo endereço: a demanda e o número dele. */
interface RefTicket {
  demanda_id: string;
  ticket_id: number;
}

/** Como a mensagem do Auditor chega ao pi da sessão: nova, redirecionando ou enfileirada. */
type ModoDaMensagem = "prompt" | "steer" | "follow_up";

/** A demanda depois da transição e as que ela levou junto; as execuções abertas delas só param depois do commit. */
export interface CascataDoCancelamento {
  demanda: AgregadoDemanda;
  canceladas: string[];
  /** Interrompe as execuções abertas das canceladas, uma vez por ticket; quem chama a roda depois do commit. */
  interromperExecucoes(): void;
}

/** O Gate da demanda (CA-16 a CA-20): reprovar cancela a demanda e os `dependentes`, que Demandas informa na transação. */
interface DecisaoDoGateDaDemanda {
  gate: "gate_demanda";
  demanda: string;
  entrada: unknown;
  dependentes: readonly string[];
}

/** As decisões do Auditor que rodam efeitos fora do agregado (pi, git): o planejamento, o PR da rodada e os ajustes. */
type DecisaoComEfeitos =
  | { gate: "gate_planejamento"; demanda: string; entrada: unknown }
  | { gate: "gate_pr"; rodada: RefRodada; entrada: unknown }
  | { gate: "ajustes_concluidos"; rodada: RefRodada };

/** A demanda depois da decisão; o Gate do PR reprovado abre a sessão de ajustes, e `sessao` é ela. */
interface ResultadoDaDecisao {
  demanda: AgregadoDemanda;
  sessao?: string;
}

export interface CicloDeVida {
  /** A configuração do serviço (F4 §3): o agendador, o paralelismo e os limites das sessões. */
  configuracao(): Configuracao;
  /** Valida e grava a configuração do serviço; o agendador a lê na batida seguinte. */
  configurar(entrada: unknown): Configuracao;
  /** Quando o agendador procura trabalho de novo, se estiver ligado (F7 §4.4). */
  proximaBusca(): Instante;

  /** CA-1: o processo do pedido recém-registrado, no estado da primeira Etapa; roda na unidade de trabalho do registro. */
  iniciar(pedido: Omit<PedidoRecebido, "enviada">): AgregadoDemanda;
  /** CA-2 e CA-3: o processo aceita o envio do pedido e vai ao Gate da demanda; roda na unidade de trabalho do envio. */
  enviar(demanda: string, autor: Ator): AgregadoDemanda;
  /** As 4 decisões do Auditor: o Gate da demanda (na transação do cancelamento), o do planejamento, o do PR e os ajustes. */
  decidir(decisao: DecisaoDoGateDaDemanda): CascataDoCancelamento;
  decidir(decisao: DecisaoComEfeitos): Promise<ResultadoDaDecisao>;
  /** O "Executar agora": a mesma seleção, limite e reserva do ciclo; o que o Despacho recusa volta como motivo. */
  executarAgora(ticket: RefTicket): MotivoDeRecusa | undefined;
  /** Só o Auditor reabre o ticket falho, com a instrução para a sessão que o retomar; devolve o ticket já aberto. */
  reabrir(ticket: RefTicket, instrucao: string): TicketDemanda;
  /** A mensagem do Auditor à sessão do ticket; `false` se o id não é de uma sessão da demanda. */
  mandar(sessao: string, texto: string, modo: ModoDaMensagem): boolean;
  /** Responde o diálogo aberto pelo agente; `false` se o id não é de uma sessão da demanda. */
  responder(sessao: string, dialogo: string, resposta: RespostaAoDialogo): boolean;
  /** Aborta a execução em andamento da sessão do ticket; `false` se o id não é de uma sessão da demanda. */
  abortar(sessao: string): boolean;
  /** CA-21 a CA-26: o Auditor cancela a demanda e os `dependentes`, que Demandas informa na transação do cancelamento. */
  cancelar(demanda: string, dependentes: readonly string[]): CascataDoCancelamento;
  /** O Auditor arquiva as demandas; `soAsConcluidas` pula as que não concluíram (o "arquivar concluídas" do projeto). */
  arquivar(demandas: readonly string[], opcoes?: { soAsConcluidas?: boolean }): AgregadoDemanda[];
  /** Desliga o agendador; as conduções que falham daqui em diante falham como "serviço reiniciado". */
  parar(): Promise<void>;
}

/** Liga ao Ciclo de Vida o que ele lê de Demandas e os limites das sessões, da configuração do serviço. */
function ligarLeiturasDaComposicao(demandas: MontagemDoCicloDeVida["demandas"]): void {
  ligarLeituraDosProjetosCadastrados({
    projetoExistente: (banco, nome, orientacao) => demandas(banco).projeto(nome, orientacao),
  });
  ligarLeituraDosPedidosRecebidos({ lerPedidosEmLote: (banco, ids) => demandas(banco).pedidos(ids) });
  ligarConclusaoDoDesenvolvimento((banco, id, gravarEncerramentoDoProcesso) => {
    demandas(banco).concluir(id, gravarEncerramentoDoProcesso);
  });
  ligarLeituraDosLimitesDasSessoes({
    timeoutMin: (banco) => configuracao(banco).timeoutMin,
    ociosidadeMin: (banco) => configuracao(banco).ociosidadeMin,
  });
}

/** A subida do serviço: recupera os tickets sem processo em volta da montagem das Sessões e liga o agendador. */
export function montarCicloDeVida(montagem: SubidaDoCicloDeVida): Promise<CicloDeVida>;
/** Monta o Ciclo de Vida sobre o `banco`; sem a subida, nada roda em segundo plano e montar não custa. */
export function montarCicloDeVida(montagem: MontagemDoCicloDeVida): CicloDeVida;
export function montarCicloDeVida(
  montagem: MontagemDoCicloDeVida | SubidaDoCicloDeVida,
): CicloDeVida | Promise<CicloDeVida> {
  const { banco, relogio = relogioDoSistema } = montagem;
  ligarLeiturasDaComposicao(montagem.demandas);
  if (!("subirSessoes" in montagem)) return cicloDeVidaMontado(montagem, montagem.sessoes);
  const tickets = recuperacaoDosTicketsNaSubida(banco, { falharTicket: falharTicketEmExecucao }, relogio);
  return montagem.subirSessoes(tickets).then((sessoes) => {
    tickets.falharTicketsPresos();
    return cicloDeVidaMontado(montagem, sessoes, montagem.registrarErro);
  });
}

function cicloDeVidaMontado(
  montagem: MontagemDoCicloDeVida | SubidaDoCicloDeVida,
  sessoesMontadas: SessoesDeAgente | undefined,
  /** Só a subida a passa: com ela, a batida do agendador liga, e o erro dela vai para cá. */
  erroDaBatida?: (erro: unknown) => void,
): CicloDeVida {
  const { banco, relogio = relogioDoSistema } = montagem;
  let emParada = false;
  // As Sessões do banco nascem na primeira operação que as usa.
  let sessoesDoBanco: SessoesDeAgente | undefined;
  const modulos: ModulosDoCiclo = {
    banco,
    // Sem a gestão, a montagem só lê e decide o que não aloca nem interrompe Ambiente.
    get ambientes() {
      return existe(montagem.ambientes, "o Ciclo de Vida não tem a gestão de Ambientes", "monte-o com a da composição");
    },
    repositorio: montagem.repositorio,
    get sessoes() {
      return sessoesMontadas ?? (sessoesDoBanco ??= montarSessoesDeAgente({ banco }));
    },
    emParada: () => emParada,
  };
  const despacho = despachoDasEtapas();
  const predecessorasPendentes = (ids: readonly string[]) => montagem.demandas(banco).predecessorasPendentes(ids);
  const agendador = ligarAgendadorDoDespacho(
    banco,
    () => cicloDoDespacho(modulos, configuracao(banco), despacho, predecessorasPendentes, relogio),
    relogio,
    erroDaBatida ?? noLog,
    erroDaBatida !== undefined,
  );
  const contexto = (): ContextoDemanda => ({ agora: relogio.agora() });
  /** Aplica `transicao` à demanda e, se ela terminou cancelada, cancela os `dependentes` junto. */
  const cancelarEmCascata = (
    id: string,
    dependentes: readonly string[],
    transicao: (ag: AgregadoDemanda) => AgregadoDemanda,
  ): CascataDoCancelamento => {
    const cascata = cancelarProcessosEmCascata(banco, id, dependentes, AUDITOR, contexto(), transicao);
    return {
      ...cascata,
      interromperExecucoes: () => {
        interromperExecucoesDasDemandas(modulos, cascata.canceladas);
      },
    };
  };
  async function decidirComEfeitos(decisao: DecisaoComEfeitos): Promise<ResultadoDaDecisao> {
    if (decisao.gate === "ajustes_concluidos") {
      return { demanda: await concluirSessaoAjustes(modulos, decisao.rodada, AUDITOR, relogio) };
    }
    const endereco =
      decisao.gate === "gate_pr"
        ? Endereco.daRodada(decisao.rodada.demanda_id, decisao.rodada.rodada_id)
        : Endereco.daDemanda(decisao.demanda);
    const { demanda, sessao } = await decidirGate(modulos, decisao.gate, endereco, decisao.entrada, AUDITOR, relogio);
    return { demanda, ...(sessao !== undefined && { sessao }) };
  }
  function decidir(decisao: DecisaoDoGateDaDemanda): CascataDoCancelamento;
  function decidir(decisao: DecisaoComEfeitos): Promise<ResultadoDaDecisao>;
  function decidir(
    decisao: DecisaoDoGateDaDemanda | DecisaoComEfeitos,
  ): CascataDoCancelamento | Promise<ResultadoDaDecisao> {
    if (decisao.gate !== "gate_demanda") return decidirComEfeitos(decisao);
    const { demanda, entrada, dependentes } = decisao;
    return cancelarEmCascata(demanda, dependentes, (ag) =>
      GATE_DA_DEMANDA.decidir(ag, Endereco.daDemanda(demanda), entrada, AUDITOR, contexto()),
    );
  }
  return {
    configuracao: () => configuracao(banco),
    configurar: (entrada) => validarESalvarConfiguracao(banco, entrada),
    proximaBusca: () => agendador.proximaBusca(),
    iniciar: (pedido) => criarProcessoDoPedido(banco, pedido, contexto()),
    enviar: (demanda, autor) => levarAoGateDaDemanda(banco, demanda, autor, contexto()),
    decidir,
    executarAgora(ticket) {
      const aceitoOuRecusa = executarAgoraNoDespacho(
        modulos,
        ticket,
        configuracao(banco),
        despacho,
        predecessorasPendentes,
        relogio,
      );
      return aceitoOuRecusa instanceof Promise ? undefined : aceitoOuRecusa;
    },
    reabrir: (ticket, instrucao) =>
      reabrir(banco, ticket.demanda_id, { ticket_id: ticket.ticket_id, instrucao }, AUDITOR, relogio),
    mandar: (sessao, texto, modo) => enviarDemanda(modulos, sessao, texto, modo, undefined, relogio),
    responder: (sessao, dialogo, resposta) => responderDialogoDemanda(banco, sessao, dialogo, resposta),
    abortar: (sessao) => abortarDemanda(modulos, sessao),
    cancelar: (demanda, dependentes) =>
      comCampoInvalidoComoErroDeRegra(() =>
        cancelarEmCascata(demanda, dependentes, (ag) => cancelarDemanda(ag, AUDITOR, contexto())),
      ),
    arquivar(demandas, { soAsConcluidas = false } = {}) {
      if (soAsConcluidas) return arquivarConcluidas(banco, demandas, relogio);
      return demandas.map((id) => arquivar(banco, id, AUDITOR, contexto()));
    },
    parar() {
      emParada = true;
      agendador.parar();
      return Promise.resolve();
    },
  };
}
