// A montagem de Sessões de IA e a interface `SessoesDeAgente` (MELHORIAS §9): a única entrada de fora do módulo. Lança
// o pi das execuções, transmite mensagens e eventos, lista as sessões com o processo vivo de cada uma, devolve a
// conversa guardada, informa os modelos e guarda o Uso declarado. O harness pi, o catálogo de preços, o encerramento
// da execução órfã e o fim dos processos da instância anterior são internos: a montagem do serviço os liga, e `parar`
// espera o que ficou em curso.
import type { DatabaseSync } from "node:sqlite";
import type { DemandaId } from "../../../../shared/nucleo/demanda_id.ts";
import type { Relogio } from "../../../../shared/nucleo/relogio.ts";
import { raizDo } from "../../../../shared/armazenamento/banco.ts";
import type { GestaoDeAmbientes } from "../../../ambiente/publico.ts";
import type { EventoDaSessao, Situacao } from "../../chat/publico.ts";
import type { Harness } from "../../harness/publico.ts";
import { gravarUsoDeclarado, type UsoDeclarado } from "../../metricas_de_execucao/publico.ts";
import { gravarCatalogoDePrecos, type Modelo } from "../../modelos/publico.ts";
import {
  apagarSessoesDasDemandas,
  execucoesAbertas,
  type FiltroDeSessoes,
  type ResumoDaSessao,
  resumosDasSessoesEmLote,
} from "../armazenamento/sessoes_e_execucoes.ts";
import type { FalhaDaExecucao } from "../nucleo/falha_da_execucao.ts";
import { pastasDoProcesso } from "../nucleo/pastas_da_execucao.ts";
import type { ContextoDaSessao, IdDaExecucao, IdDaSessao } from "../nucleo/sessao.ts";
import { encerrarExecucaoOrfa } from "./encerramento.ts";
import { MotorDasSessoes, type PedidoDeProcesso, type RespostaAoDialogo } from "./motor_das_sessoes.ts";
import { type PedidoDasMetricasDeUso, usoDasMetricas, type UsoPorContexto } from "./uso_das_metricas.ts";

/**
 * O motor do serviço: um por processo, com os pi vivos de todas as sessões; toda montagem fala com ele.
 * ponytail: instância única enquanto o Ciclo de Vida usa o motor direto (`condutor`); o passo 6 entrega ao Ciclo de Vida
 * as Sessões montadas, e o motor nasce na montagem.
 */
export const motorDasSessoes = new MotorDasSessoes();

/** Quanto o `parar` espera as execuções em curso antes de matar os pi que restaram. */
const LIMITE_PARADA_MS = 10_000;

/** O pedido de lançamento: a execução já aberta, a política e o Ambiente prontos. */
type PedidoDeSessao = Omit<PedidoDeProcesso, "banco">;

/** O resumo da sessão com o processo vivo dela neste serviço, se há um. */
export type ResumoDaSessaoComSituacao = ResumoDaSessao & { situacao?: Situacao };

/** Um comando de conversa ao pi vivo: `prompt` acorda a sessão ociosa; `steer` e `follow_up` entram no passo atual. */
interface MensagemAoAgente {
  type: "prompt" | "steer" | "follow_up";
  message: string;
}

export interface SessoesDeAgente {
  /** Lança o pi da execução e conduz o protocolo até o fim; resolve com a falha técnica, ou `undefined`. */
  lancar(pedido: PedidoDeSessao): Promise<FalhaDaExecucao | undefined>;
  /** Manda `abort` ao pi vivo da execução, cancelando antes os diálogos pendentes. */
  abortar(execucao: IdDaExecucao): void;
  /** As sessões do filtro, sem a conversa, com o processo vivo de cada uma. */
  listar(filtro?: FiltroDeSessoes): ResumoDaSessaoComSituacao[];
  /** Os eventos do pi da sessão e `{ type: "estado" }` quando o estado dela pode ter mudado; devolve quem cancela. */
  assinar(sessao: IdDaSessao, ouvinte: (evento: EventoDaSessao) => void): () => void;
  mandar(execucao: IdDaExecucao, mensagem: MensagemAoAgente): void;
  /** Responde um diálogo pendente do pi vivo da execução. */
  responder(execucao: IdDaExecucao, dialogo: string, resposta: RespostaAoDialogo): void;
  /** A conversa guardada da sessão: as entradas do arquivo que o harness grava, ou nenhuma antes de ele existir. */
  conversa(sessao: IdDaSessao): unknown[];
  /** Todos os pares provedor/modelo que o harness conhece. */
  modelos(): Promise<Modelo[]>;
  /** Guarda o Uso que uma sessão externa declara; a sessão já declarada por outra demanda fica com a dona. */
  declararUso(uso: UsoDeclarado): { demandaDona: string };
  /** A métrica "uso": o Uso de cada execução do período e de cada sessão externa declarada das demandas. */
  metricas(pedido: PedidoDasMetricasDeUso): UsoPorContexto;
  /** Apaga as sessões das `demandas`, as execuções e o Uso; devolve o que sobra no disco (execuções e conversas). */
  esquecer(demandas: readonly DemandaId[]): { execucoes: IdDaExecucao[]; sessoes: string[] };
  /** A parada do serviço: não lança pi novo, espera as execuções em curso e mata as que passam do limite. */
  parar(): Promise<void>;
}

export interface MontagemDasSessoesDeAgente {
  banco: DatabaseSync;
  /** Troca o harness do motor (os testes passam o falso); sem ele, fica o do motor (o pi). */
  harness?: Harness;
  /** Onde roda o pi do pedido sem Ambiente, e quem sinaliza os processos da instância anterior. */
  ambientes?: GestaoDeAmbientes;
  /** O endereço da API do agente (`FABRIQUINHA_API`), que o `parar` retira. */
  urlDaApi?: string;
  /** Grava em segundo plano o catálogo de preços do harness; a falha vai a `registrarErro`, e o `parar` a espera. */
  catalogo?: { relogio: Relogio; registrarErro(erro: unknown): void };
}

/** A subida do serviço: toda execução aberta é de uma instância anterior. */
export interface SubidaDasSessoes {
  /** Cada execução órfã encerrada, com o contexto dela: o que isso significa para quem a pediu é de quem pediu. */
  aoEncerrarExecucaoOrfa(contexto: ContextoDaSessao): void;
}

function sessoesDoBanco(banco: DatabaseSync, gravacaoDoCatalogo: Promise<void>): SessoesDeAgente {
  const motor = motorDasSessoes;
  return {
    lancar: (pedido) => motor.lancarExecucao({ ...pedido, banco }),
    abortar: (execucao) => {
      motor.abortar(execucao);
    },
    listar: (filtro) =>
      resumosDasSessoesEmLote(banco, filtro).map((resumo) => {
        const situacao = motor.situacao(resumo.id);
        return situacao ? { ...resumo, situacao } : resumo;
      }),
    assinar: (sessao, ouvinte) => motor.assinar(sessao, ouvinte),
    mandar: (execucao, mensagem) => {
      motor.mandar(execucao, mensagem);
    },
    responder: (execucao, dialogo, resposta) => {
      motor.responder(execucao, dialogo, resposta);
    },
    conversa: (sessao) => motor.lerConversa(raizDo(banco), sessao),
    modelos: () => motor.harness.listarModelos(),
    declararUso: (uso) => gravarUsoDeclarado(banco, uso),
    metricas: (pedido) => usoDasMetricas(banco, pedido),
    esquecer: (demandas) => apagarSessoesDasDemandas(banco, demandas),
    async parar() {
      motor.marcarParada();
      motor.urlDaApi = undefined;
      await gravacaoDoCatalogo;
      await motor.aguardarTodos(LIMITE_PARADA_MS);
    },
  };
}

/**
 * F4 §7: mata o grupo do harness de cada execução aberta que rodou no Ambiente do serviço e encerra cada uma com falha,
 * avisando quem pediu e quem assina a sessão.
 */
async function recuperarExecucoesDaInstanciaAnterior(banco: DatabaseSync, subida: SubidaDasSessoes): Promise<void> {
  const motor = motorDasSessoes;
  await motor.matarProcessosDaInstanciaAnterior(banco);
  for (const { id, demanda_id, ticket_id } of execucoesAbertas(banco)) {
    const contexto = { demanda_id, ticket_id };
    const { log } = pastasDoProcesso(raizDo(banco), id);
    const sessao = encerrarExecucaoOrfa(banco, contexto, id, log, motor.harness);
    subida.aoEncerrarExecucaoOrfa(contexto);
    motor.avisar(sessao, log);
  }
}

/**
 * Monta as Sessões sobre o `banco`. Sem `catalogo` nem `subida`, não liga nada e montar não custa. Com `subida`, antes
 * de devolver, mata os processos da instância anterior e encerra as execuções que ela deixou abertas.
 */
export function montarSessoesDeAgente(
  montagem: MontagemDasSessoesDeAgente & { subida: SubidaDasSessoes },
): Promise<SessoesDeAgente>;
export function montarSessoesDeAgente(montagem: MontagemDasSessoesDeAgente): SessoesDeAgente;
export function montarSessoesDeAgente({
  banco,
  harness,
  ambientes,
  urlDaApi,
  catalogo,
  subida,
}: MontagemDasSessoesDeAgente & { subida?: SubidaDasSessoes }): SessoesDeAgente | Promise<SessoesDeAgente> {
  const motor = motorDasSessoes;
  if (harness) motor.montarHarness(harness);
  if (ambientes) motor.montarAmbientes(ambientes);
  if (urlDaApi !== undefined) motor.urlDaApi = urlDaApi;
  // ponytail: o preço que o harness passa a declarar depois da subida só entra na subida seguinte; reler na batida do
  // relógio se o catálogo mudar com o serviço no ar.
  const gravacaoDoCatalogo = catalogo
    ? motor.harness
        .precosDosModelos()
        .then((precos) => {
          gravarCatalogoDePrecos(banco, precos, catalogo.relogio.agora());
        })
        .catch((erro: unknown) => {
          catalogo.registrarErro(erro);
        })
    : Promise.resolve();
  const sessoes = sessoesDoBanco(banco, gravacaoDoCatalogo);
  return subida ? recuperarExecucoesDaInstanciaAnterior(banco, subida).then(() => sessoes) : sessoes;
}
