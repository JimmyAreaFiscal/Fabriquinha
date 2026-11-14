// As leituras do Ciclo de Vida (PROPOSTA §4.2): o andamento de uma demanda e o de várias em lote, os estados, as
// Pendências, a sessão do ticket como o Auditor a vê, o catálogo das Etapas, as recusas do Despacho e as métricas do
// processo. As telas leem por aqui o que antes liam do vocabulário do motor (`CICLO_DA_*`, `CATALOGO_DE_ETAPAS`).
import type { DatabaseSync } from "node:sqlite";
import type { ConversaDaSessao, ResumoDaSessao, Situacao } from "../../../sessoes/publico.ts";
import { encontrado } from "../../../../shared/nucleo/erros.ts";
import type { Instante } from "../../../../shared/nucleo/primitivos.ts";
import type { Relogio } from "../../../../shared/nucleo/relogio.ts";
import {
  CATALOGO_DE_ETAPAS,
  type Endereco,
  EtapaTicket,
  ORDEM_DO_SDLC,
  resolverConfiguracaoAgente,
  TIPOS_DA_DEMANDA,
  type TipoEvidencia,
} from "../../etapas/publico.ts";
import { ticketAtualDaEtapa } from "../../planejamento/publico.ts";
import { lerAnexo, schemaDoTipo } from "../../evidencias/publico.ts";
import {
  type AgregadoDemanda,
  andamentoDasDemandasEmLote,
  CICLO_DA_DEMANDA,
  CICLO_DO_TICKET,
  EstadoDemanda,
  estadoDaDemandaNaEtapa,
  estadoDaRodadaNaEtapa,
  etapaDoEstado,
  gateQueEsperaGenteNaRodada,
  listarResumosDasDemandas,
  motivoDaFalhaDoTicket,
  type Pendencia,
  prDaDemanda,
  PRIMEIRA_ETAPA_DA_DEMANDA,
  PRIMEIRA_ETAPA_DA_RODADA,
  type ResumoDaDemanda,
  resumosDasDemandas,
  type TrabalhoVivo,
  visaoDaDemanda,
} from "../../processo/publico.ts";
import {
  type EstadoDaSessao,
  estadoEDesdeDaSessao,
  execucaoDaSessao,
  marcadorDaConversa,
  pendenciaDaSessao,
  type PendenciaDoChat,
  type SessaoDoTicket,
  trabalhoVivoDaSessao,
} from "../../conducao/publico.ts";
import {
  configuracao,
  Despacho,
  type MotivoDeRecusa,
  pendenciasDaDemanda,
  prontosParaExecutarAgora,
  ultimasRecusas,
} from "../../despacho/publico.ts";
import {
  metricasDoCicloDeVida,
  type MetricasDoProcesso,
  type OrigemDosFatos,
  type Recorte,
} from "../../metricas_de_qualidade/publico.ts";

/** A demanda inteira: o agregado, os anexos de cada Evidência e o que as telas derivam dele. */
export interface Andamento {
  agregado: AgregadoDemanda;
  evidencias: ReturnType<typeof visaoDaDemanda>["evidencias"];
  /** O PR final da demanda, quando aberto. */
  pr: ReturnType<typeof prDaDemanda>;
  /** O motivo da última Tentativa de cada ticket falho ou cancelado que tem um. */
  motivoDaFalha: ReadonlyMap<number, string>;
  /** O ticket atual de cada Etapa, por rodada. */
  ticketAtualPorRodada: ReadonlyMap<number, Partial<Record<EtapaTicket, number>>>;
  /** Os tickets que o "Executar agora" do Auditor aceitaria, com as `predecessorasPendentes` pedidas. */
  prontosParaExecutarAgora: ReadonlySet<number>;
}

/** As demandas de `demandas`, na ordem pedida, ou todas: sem as arquivadas (`arquivadas` as traz) ou só as não terminadas. */
type FiltroDosAndamentos = { demandas: readonly string[] } | { arquivadas?: boolean; soNaoTerminadas?: boolean };

/** A sessão do ticket como o Auditor a vê: o estado, desde quando, a Pendência que a segura e as execuções. */
export interface SessaoNoCicloDeVida extends SessaoDoTicket {
  /** O processo vivo da sessão neste serviço, se há um. */
  viva?: Situacao;
  estado: EstadoDaSessao;
  desde: Instante;
  /** A Pendência que segura a sessão parada (só a sessão que espera o Auditor tem uma). */
  pendencia(): PendenciaDoChat | undefined;
  /** A sessão parada no diálogo ou na conversa, que as Pendências da demanda pedem. */
  trabalhoVivo?: TrabalhoVivo;
  /** O motivo da última Tentativa do ticket, se ele falhou ou foi cancelado. */
  motivoDaFalha?: string;
  primeira: ResumoDaSessao["execucoes"][number];
  ultima: ResumoDaSessao["execucoes"][number];
}

/** O catálogo das Etapas e as regras dos estados que as telas mostram. */
export interface CatalogoDoCicloDeVida {
  porEtapa: typeof CATALOGO_DE_ETAPAS;
  ordem: typeof ORDEM_DO_SDLC;
  demanda: {
    ehTerminal(estado: EstadoDemanda): boolean;
    satisfazDependencia(estado: EstadoDemanda): boolean;
    estaEmAndamento(estado: EstadoDemanda): boolean;
    arquivavel(estado: EstadoDemanda): boolean;
    /** O estado da demanda em que o trabalho da Etapa acontece; as Etapas das rodadas e do conflito, `em_execucao`. */
    estadoDaEtapa(etapa: EtapaTicket): EstadoDemanda;
    /** O estado da demanda na primeira Etapa dela. */
    primeiroEstado: EstadoDemanda;
  };
  rodada: {
    /** O estado da rodada na primeira Etapa dela. */
    primeiroEstado: ReturnType<typeof estadoDaRodadaNaEtapa>;
    /** O gate que espera gente no estado da rodada, se espera. */
    gateQueEsperaGente: typeof gateQueEsperaGenteNaRodada;
  };
  ticket: {
    ehTerminal(estado: AgregadoDemanda["tickets"][number]["estado"]): boolean;
    satisfazDependencia(estado: AgregadoDemanda["tickets"][number]["estado"]): boolean;
  };
  /** O modelo e a configuração do agente: o do ticket, senão o da Etapa no projeto, senão o padrão (D07). */
  configuracaoDoAgente: typeof resolverConfiguracaoAgente;
  /** O schema dos `dados` e os arquivos da Evidência `tipo`. */
  schemaDaEvidencia(tipo: TipoEvidencia): ReturnType<typeof schemaDoTipo>;
  /** Os tipos de Evidência que a ferramenta externa submete à demanda. */
  tiposDaEvidenciaDaDemanda: typeof TIPOS_DA_DEMANDA;
}

const estadoDaEtapa = (etapa: EtapaTicket): EstadoDemanda =>
  EstadoDemanda.options.find((estado) => etapaDoEstado(estado) === etapa) ?? "em_execucao";

/** @testes o apoio de teste o reexporta para as telas, que o desenham sem banco */
export const CATALOGO: CatalogoDoCicloDeVida = {
  porEtapa: CATALOGO_DE_ETAPAS,
  ordem: ORDEM_DO_SDLC,
  demanda: {
    ehTerminal: (estado) => CICLO_DA_DEMANDA.ehTerminal(estado),
    satisfazDependencia: (estado) => CICLO_DA_DEMANDA.satisfazDependencia(estado),
    estaEmAndamento: (estado) => CICLO_DA_DEMANDA.estaEmAndamento(estado),
    arquivavel: (estado) => CICLO_DA_DEMANDA.transicoes[estado].includes("arquivada"),
    estadoDaEtapa,
    primeiroEstado: estadoDaDemandaNaEtapa(PRIMEIRA_ETAPA_DA_DEMANDA),
  },
  rodada: {
    primeiroEstado: estadoDaRodadaNaEtapa(PRIMEIRA_ETAPA_DA_RODADA),
    gateQueEsperaGente: gateQueEsperaGenteNaRodada,
  },
  ticket: {
    ehTerminal: (estado) => CICLO_DO_TICKET.ehTerminal(estado),
    satisfazDependencia: (estado) => CICLO_DO_TICKET.satisfazDependencia(estado),
  },
  configuracaoDoAgente: resolverConfiguracaoAgente,
  schemaDaEvidencia: schemaDoTipo,
  tiposDaEvidenciaDaDemanda: TIPOS_DA_DEMANDA,
};

export interface LeiturasDoCicloDeVida {
  /** A demanda `demanda`, lida num snapshot só; `predecessorasPendentes` decide o que o "Executar agora" aceitaria. */
  andamento(demanda: string, opcoes?: { predecessorasPendentes?: readonly string[] }): Andamento;
  /** As demandas resumidas, numa leitura em lote. */
  andamentos(filtro?: FiltroDosAndamentos): ResumoDaDemanda[];
  /**
   * O estado e a última mudança dele de cada demanda de `demandas`, na ordem pedida e sem as que não têm processo (todas,
   * sem elas), numa leitura só.
   */
  estados(demandas?: readonly string[]): ReadonlyMap<string, { estado: EstadoDemanda; estadoAlteradoEm: Instante }>;
  /**
   * As Pendências das `demandas`, na ordem delas, pela regra única do núcleo, com o agendador da configuração do serviço
   * (lida uma vez); `predecessorasSatisfeitas` diz, pelo id, se a demanda não está bloqueada.
   */
  pendencias(
    demandas: readonly ResumoDaDemanda[],
    situacao: {
      vivos: readonly TrabalhoVivo[];
      agora: Instante;
      predecessorasSatisfeitas: (demanda: string) => boolean;
    },
  ): Pendencia[];
  /** A sessão do ticket da `demanda`, no estado que o chat e o Histórico mostram; recusa a de ticket que ela não tem. */
  sessaoDoTicket(demanda: ResumoDaDemanda, sessao: ResumoDaSessao, relogio: Relogio): SessaoNoCicloDeVida;
  /** A marca de cada mensagem da conversa: o prompt da Fabriquinha ou o Ator que a escreveu. */
  marcasDaConversa: typeof marcadorDaConversa;
  /** O anexo `sha256` da Evidência com o conteúdo inteiro; só lê o que a Evidência registra. */
  anexo(chave: Parameters<typeof lerAnexo>[1], sha256: string): ReturnType<typeof lerAnexo>;
  etapas(): CatalogoDoCicloDeVida;
  /** Por que cada item parado no último ciclo do Despacho não foi despachado. */
  recusasDoDespacho(): { item: Endereco; motivo: MotivoDeRecusa }[];
  metricas(origem: OrigemDosFatos, recorte: Recorte): MetricasDoProcesso;
}

/** As leituras do Ciclo de Vida sobre o `banco`. */
export function leiturasDoCicloDeVida(banco: DatabaseSync): LeiturasDoCicloDeVida {
  return {
    andamento(demanda, { predecessorasPendentes = [] } = {}) {
      const { agregado, evidencias } = visaoDaDemanda(banco, demanda);
      const prontos = prontosParaExecutarAgora(
        new Despacho().selecionar({
          demandas: [{ agregado, predecessoras_pendentes: [...predecessorasPendentes] }],
          vivos: [], // só a retomada do planejamento depende do trabalho vivo, e ela não é do Auditor
        }),
      );
      return {
        agregado,
        evidencias,
        pr: prDaDemanda(agregado),
        motivoDaFalha: new Map(
          agregado.tickets.flatMap((ticket) => {
            const motivo = motivoDaFalhaDoTicket(agregado.tentativas, ticket);
            return motivo === undefined ? [] : [[ticket.ticket_id, motivo] as const];
          }),
        ),
        ticketAtualPorRodada: new Map(
          agregado.rodadas.map((rodada) => [
            rodada.rodada_id,
            Object.fromEntries(
              EtapaTicket.options.flatMap((etapa) => {
                const atual = ticketAtualDaEtapa(agregado, etapa, rodada.rodada_id);
                return atual ? [[etapa, atual.ticket_id]] : [];
              }),
            ),
          ]),
        ),
        prontosParaExecutarAgora: new Set(prontos.map((ticket) => ticket.ticket_id)),
      };
    },
    andamentos: (filtro = {}) =>
      "demandas" in filtro ? resumosDasDemandas(banco, filtro.demandas) : listarResumosDasDemandas(banco, filtro),
    estados(demandas) {
      const lidos = andamentoDasDemandasEmLote(banco, demandas);
      return new Map(
        (demandas ?? [...lidos.keys()]).flatMap((id) => {
          const lido = lidos.get(id);
          return lido === undefined
            ? []
            : [[id, { estado: EstadoDemanda.parse(lido.estado), estadoAlteradoEm: lido.estadoAlteradoEm }] as const];
        }),
      );
    },
    pendencias(demandas, { vivos, agora, predecessorasSatisfeitas }) {
      const agendadorLigado = configuracao(banco).agendadorAtivo;
      return demandas.flatMap((demanda) =>
        pendenciasDaDemanda(demanda, vivos, demanda.pull_requests, agendadorLigado, {
          agora,
          predecessorasSatisfeitas: predecessorasSatisfeitas(demanda.demanda.id),
        }),
      );
    },
    sessaoDoTicket(demanda, { execucoes, situacao, ...sessao }, relogio) {
      const ticket = encontrado(
        demanda.tickets.find((t) => t.ticket_id === sessao.ticket_id),
        `a sessão ${sessao.id} não existe`,
        "confira o endereço do chat",
      );
      const doTicket: SessaoDoTicket = { ag: demanda, ticket, sessao, execucoes };
      const estadoEDesde = estadoEDesdeDaSessao(doTicket, situacao);
      const trabalhoVivo = trabalhoVivoDaSessao(doTicket, situacao, estadoEDesde);
      const motivoDaFalha = motivoDaFalhaDoTicket(demanda.tentativas, ticket);
      return {
        ...doTicket,
        ...(situacao && { viva: situacao }),
        estado: estadoEDesde[0],
        desde: estadoEDesde[1],
        pendencia: () => pendenciaDaSessao(doTicket, situacao, estadoEDesde, relogio),
        ...(trabalhoVivo && { trabalhoVivo }),
        ...(motivoDaFalha !== undefined && { motivoDaFalha }),
        primeira: execucaoDaSessao(doTicket, "primeira"),
        ultima: execucaoDaSessao(doTicket),
      };
    },
    marcasDaConversa: (conversa: Pick<ConversaDaSessao, "marcaDa">) => marcadorDaConversa(conversa),
    anexo: (chave, sha256) => lerAnexo(banco, chave, sha256),
    etapas: () => CATALOGO,
    recusasDoDespacho: () => [...ultimasRecusas()].map(([item, motivo]) => ({ item, motivo })),
    metricas: (origem, recorte) => metricasDoCicloDeVida(origem, recorte),
  };
}
