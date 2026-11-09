// A condução de uma Etapa (CONCEITOS.md §2): o que a Fabriquinha faz do ticket reservado até concluí-lo ou falhá-lo. As
// etapas agênticas compartilham o ciclo aqui; cada concreta só declara o que difere (preparação, conferência, conclusão).
import type { DatabaseSync } from "node:sqlite";
import { FABRIQUINHA } from "../../nucleo/ator.ts";
import type { TicketDemanda } from "../../nucleo/agregado_demanda.ts";
import { encontrado, existe } from "../../nucleo/erros.ts";
import type { DefinicaoDaEtapa } from "../../nucleo/etapa.ts";
import { espacoDoTicket } from "../../nucleo/espaco_de_trabalho.ts";
import { Endereco } from "../../nucleo/item_de_trabalho.ts";
import { reservarTicket } from "../../nucleo/reserva_ticket.ts";
import {
  type FalhaDaTentativa,
  falhaDoErro,
  falhaPorServicoReiniciado,
  falhaQueExigeOAuditor,
  retornoAoAgenteDoTicket,
} from "../../nucleo/tentativa.ts";
import { devolverTicket, registrarFalhaTicket } from "../../nucleo/transicoes_demanda.ts";
import { raizDo } from "../../armazenamento/banco.ts";
import { carregarDemanda, comDemanda } from "../../armazenamento/demandas.ts";
import { carregarProjeto } from "../../armazenamento/projetos.ts";
import { configuracao } from "../../armazenamento/servico.ts";
import type { anotar } from "../../infra/registro.ts";
import { cicloDoEspaco } from "../espaco/ciclo_do_espaco.ts";
import { type OpcoesExecucaoDemanda, iniciarExecucaoDemanda } from "../execucao_demanda.ts";
import type { instanteAtual } from "../relogio.ts";
import type { CondutorDeTrabalhos } from "../trabalho/condutor.ts";

export interface DepsDaConducao {
  banco: DatabaseSync;
  relogio: typeof instanteAtual;
  condutor: CondutorDeTrabalhos;
  registro: typeof anotar;
}

abstract class ConducaoDeEtapa {
  protected readonly definicao: DefinicaoDaEtapa;
  protected readonly deps: DepsDaConducao;

  constructor(definicao: DefinicaoDaEtapa, deps: DepsDaConducao) {
    this.definicao = definicao;
    this.deps = deps;
  }

  abstract conduzir(ticket: Endereco): Promise<void>;
}

type EspacoPreparado = NonNullable<OpcoesExecucaoDemanda["espaco"]>;

/** O que `conferirResultado` devolve: a etapa deu certo, foi reprovada (D05, o agente corrige) ou falhou. */
export type ResultadoDaConferencia = { tipo: "sucesso" } | { tipo: "reprovacao"; motivo: string } | FalhaDaTentativa;

type ExecucaoIniciada = ReturnType<typeof iniciarExecucaoDemanda>;

export abstract class ConducaoAgentica extends ConducaoDeEtapa {
  /** Inicia a etapa e espera o fim dela: o agente roda, a conferência roda e o ticket é concluído ou falhado. */
  async conduzir(endereco: Endereco): Promise<void> {
    await (
      await this.iniciar(endereco)
    )?.fim;
  }

  /**
   * Reserva o ticket, prepara o Espaço e sobe o agente, sem esperar o fim dele: devolve a execução em segundo plano (ou
   * nada, se a preparação falhou e o ticket já foi falhado).
   */
  async iniciar(endereco: Endereco): Promise<ExecucaoIniciada | undefined> {
    const { banco, condutor, registro } = this.deps;
    const ticket = this.ticketDe(endereco);
    this.reservar(ticket);
    const preparacao = this.prepararEspaco(ticket);
    // Sem preparação a execução nasce já, na transação da reserva: é ela que ocupa a vaga do limite global.
    if (preparacao === undefined) return this.subir(ticket, undefined);
    let espaco: EspacoPreparado;
    try {
      espaco = await preparacao;
    } catch (erro) {
      // Com o serviço parando, o erro é efeito da parada: o ticket é retomado em vez de esperar o Auditor.
      const falha = condutor.emParada() ? falhaPorServicoReiniciado : falhaDoErro(erro);
      registro(`${raizDo(banco)}/log`, `preparação falhou: ${falha.motivo}`);
      await this.falhar(ticket, falha);
      return undefined;
    }
    return this.subir(ticket, espaco);
  }

  private subir(ticket: TicketDemanda, espaco: EspacoPreparado | undefined): ExecucaoIniciada {
    const { banco } = this.deps;
    // A conferência roda no fechamento do processo, ainda sob o condutor: a parada do serviço a espera e o chat recebe o
    // estado já final do ticket; o que ela lançar vai ao log do processo e falha o ticket.
    return iniciarExecucaoDemanda(banco, ticket, {
      limiteMin: configuracao(banco).timeoutMin,
      modo: this.definicao.executor === "agente_interativo" ? "interativo" : "autonomo",
      ...this.retomadaDe(ticket),
      espaco,
      fechar: (_banco, _ticket, { falha }) => this.fechar(ticket, falha),
    });
  }

  /** Da falha do agente ou da conferência ao destino do ticket: concluído, devolvido ou falho. */
  private async fechar(ticket: TicketDemanda, falhaDoAgente: FalhaDaTentativa | undefined): Promise<void> {
    const endereco = Endereco.doTicket(ticket.demanda_id, ticket.ticket_id);
    const resultado = falhaDoAgente ?? (await this.conferirResultado(endereco));
    if (resultado.tipo === "sucesso") await this.aoConcluir(endereco);
    else if (resultado.tipo === "reprovacao") this.devolver(ticket, resultado.motivo);
    else await this.falhar(ticket, resultado);
  }

  /** Reserva o ticket aberto para a Fabriquinha. */
  protected reservar(ticket: TicketDemanda): void {
    const { banco, relogio } = this.deps;
    comDemanda(banco, ticket.demanda_id, (ag) =>
      reservarTicket(ag, { ticket_id: ticket.ticket_id }, FABRIQUINHA, relogio(), true),
    );
  }

  /** O Espaço de Trabalho do ticket, criado antes do agente subir; sem preparação (`undefined`), a execução o cria. */
  protected prepararEspaco(ticket: TicketDemanda): Promise<EspacoPreparado> | undefined {
    const { banco } = this.deps;
    const ag = carregarDemanda(banco, ticket.demanda_id);
    const projeto = carregarProjeto(banco, ag.demanda.projeto);
    const raiz = raizDo(banco);
    return cicloDoEspaco(espacoDoTicket(ag, ticket, projeto, raiz), projeto, { raiz, log: `${raiz}/log` }).criar();
  }

  /**
   * A devolução técnica (D05) ou a reabertura do Auditor que precede esta Tentativa vai ao prompt; só a etapa que
   * descarta a conversa anterior abre sessão nova.
   */
  protected retomadaDe(ticket: TicketDemanda): Pick<OpcoesExecucaoDemanda, "retomada" | "iniciarEmSessaoNova"> {
    return {
      retomada: retornoAoAgenteDoTicket(
        carregarDemanda(this.deps.banco, ticket.demanda_id).tentativas,
        ticket.ticket_id,
      ),
    };
  }

  /**
   * Padrão das etapas que o agente conclui pelo CLI (a Decisão do gate conclui o ticket): ainda em execução, o agente
   * saiu sem decidir e o ticket ficaria preso.
   */
  protected conferirResultado(endereco: Endereco): Promise<ResultadoDaConferencia> {
    return Promise.resolve(
      this.ticketDe(endereco).estado === "em_execucao"
        ? falhaQueExigeOAuditor("a revisão terminou sem registrar a decisão")
        : { tipo: "sucesso" },
    );
  }

  /** O que a etapa faz depois do resultado bom, além do que a própria Decisão do gate já fez. */
  protected abstract aoConcluir(endereco: Endereco): Promise<void>;

  protected ticketDe(endereco: Endereco): TicketDemanda {
    const ticket_id = existe(endereco.ticket_id, `${endereco.toString()} não é um ticket`, "use I-n.Tm, como I-206.T3");
    return encontrado(
      carregarDemanda(this.deps.banco, endereco.demanda_id).tickets.find((t) => t.ticket_id === ticket_id),
      `o ticket ${endereco.toString()} não existe`,
      "use um ticket da demanda",
    );
  }

  /** A reprovação técnica (D05): o ticket volta ao agente com o relatório ou, no limite das Tentativas, falha com ele. */
  private devolver(ticket: TicketDemanda, instrucao: string): void {
    const { banco, relogio } = this.deps;
    comDemanda(banco, ticket.demanda_id, (ag) =>
      devolverTicket(ag, { ticket_id: ticket.ticket_id, instrucao }, FABRIQUINHA, relogio()),
    );
  }

  protected falhar(ticket: TicketDemanda, falha: FalhaDaTentativa): Promise<void> {
    const { banco, relogio } = this.deps;
    comDemanda(banco, ticket.demanda_id, (ag) =>
      registrarFalhaTicket(ag, { ticket_id: ticket.ticket_id, falha }, relogio()),
    );
    return Promise.resolve();
  }
}

interface PassoDaEtapa {
  nome: string;
  executar(ticket: Endereco): Promise<void>;
}

/**
 * A etapa que a Fabriquinha conduz sozinha, sem agente (Não há Reprovação: CONCEITOS.md §6). A Tentativa retoma pelo
 * passo que falhou, sem refazer os que passaram.
 * @testes a `ConducaoDeEncerrarDemanda` a estende em outro ticket da rodada
 */
export abstract class ConducaoDeterministica extends ConducaoDeEtapa {
  protected abstract readonly passos: PassoDaEtapa[];
}

/**
 * A etapa em que o agente conversa com o Auditor (executor `agente_interativo`): o Espaço nasce com a sessão, e o fim do
 * pi não decide o ticket, que a Decisão do gate ou a conclusão da sessão fecham.
 */
export abstract class ConducaoInterativa extends ConducaoAgentica {
  protected override prepararEspaco(): undefined {
    return undefined;
  }

  protected override conferirResultado(): Promise<ResultadoDaConferencia> {
    return Promise.resolve({ tipo: "sucesso" });
  }
}
