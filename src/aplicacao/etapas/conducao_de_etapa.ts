// A condução de uma Etapa (CONCEITOS.md §2): o que a Fabriquinha faz do ticket reservado até concluí-lo ou falhá-lo. As
// etapas agênticas compartilham o ciclo aqui; cada concreta só declara o que difere (preparação, conferência, conclusão).
import type { DatabaseSync } from "node:sqlite";
import { FABRIQUINHA } from "../../nucleo/ator.ts";
import type { TicketDemanda } from "../../nucleo/agregado_demanda.ts";
import { encontrado, existe } from "../../nucleo/erros.ts";
import type { DefinicaoDaEtapa } from "../../nucleo/etapa.ts";
import { espacoDoTicket } from "../../nucleo/espaco_de_trabalho.ts";
import type { Endereco } from "../../nucleo/item_de_trabalho.ts";
import { reservarTicket } from "../../nucleo/reserva_ticket.ts";
import {
  type FalhaDaTentativa,
  falhaDoErro,
  falhaPorServicoReiniciado,
  falhaQueExigeOAuditor,
  retornoAoAgenteDoTicket,
} from "../../nucleo/tentativa.ts";
import { registrarFalhaTicket } from "../../nucleo/transicoes_demanda.ts";
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

/** O que `conferirResultado` devolve: a etapa deu certo ou falhou; a reprovação (D05) entra com a `ConducaoDeImplementar`. */
type ResultadoDaConferencia = { tipo: "sucesso" } | FalhaDaTentativa;

export abstract class ConducaoAgentica extends ConducaoDeEtapa {
  /** Reserva o ticket, prepara o Espaço, roda o agente e, no fim, confere: conclui o ticket ou o falha. */
  async conduzir(endereco: Endereco): Promise<void> {
    const { banco, relogio, condutor, registro } = this.deps;
    const ticket = this.ticketDe(endereco);
    comDemanda(banco, ticket.demanda_id, (ag) =>
      reservarTicket(ag, { ticket_id: ticket.ticket_id }, FABRIQUINHA, relogio(), true),
    );
    let espaco: EspacoPreparado;
    try {
      espaco = await this.prepararEspaco(ticket);
    } catch (erro) {
      // Com o serviço parando, o erro é efeito da parada: o ticket é retomado em vez de esperar o Auditor.
      const falha = condutor.emParada() ? falhaPorServicoReiniciado : falhaDoErro(erro);
      registro(`${raizDo(banco)}/log`, `preparação falhou: ${falha.motivo}`);
      this.falhar(ticket, falha);
      return;
    }
    // A devolução técnica (D05) ou a reabertura do Auditor que precede esta Tentativa vai ao prompt.
    const retomada = retornoAoAgenteDoTicket(carregarDemanda(banco, ticket.demanda_id).tentativas, ticket.ticket_id);
    const falhaDoAgente = await iniciarExecucaoDemanda(banco, ticket, {
      limiteMin: configuracao(banco).timeoutMin,
      retomada,
      espaco,
    }).fim;
    const resultado = falhaDoAgente ?? (await this.conferirResultado(endereco));
    if (resultado.tipo === "sucesso") await this.aoConcluir(endereco);
    else this.falhar(ticket, resultado);
  }

  /** O Espaço de Trabalho do ticket, criado antes do agente subir. */
  protected prepararEspaco(ticket: TicketDemanda): Promise<EspacoPreparado> {
    const { banco } = this.deps;
    const ag = carregarDemanda(banco, ticket.demanda_id);
    const projeto = carregarProjeto(banco, ag.demanda.projeto);
    const raiz = raizDo(banco);
    return cicloDoEspaco(espacoDoTicket(ag, ticket, projeto, raiz), projeto, { raiz, log: `${raiz}/log` }).criar();
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

  private ticketDe(endereco: Endereco): TicketDemanda {
    const ticket_id = existe(endereco.ticket_id, `${endereco.toString()} não é um ticket`, "use I-n.Tm, como I-206.T3");
    return encontrado(
      carregarDemanda(this.deps.banco, endereco.demanda_id).tickets.find((t) => t.ticket_id === ticket_id),
      `o ticket ${endereco.toString()} não existe`,
      "use um ticket da demanda",
    );
  }

  private falhar(ticket: TicketDemanda, falha: FalhaDaTentativa): void {
    const { banco, relogio } = this.deps;
    comDemanda(banco, ticket.demanda_id, (ag) =>
      registrarFalhaTicket(ag, { ticket_id: ticket.ticket_id, falha }, relogio()),
    );
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
