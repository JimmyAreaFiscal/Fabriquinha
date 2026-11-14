// A montagem de Sessões de IA e a interface `SessoesDeAgente` (MELHORIAS §9): a única entrada de fora do módulo. Abre,
// lança, interrompe e encerra as execuções do pi, faz a consulta ao modelo, transmite mensagens e eventos, lista as
// sessões com o processo vivo de cada uma, devolve a conversa guardada, informa os modelos e guarda o Uso declarado. O
// motor que guarda os pi vivos é um por arquivo do banco: toda montagem sobre ele, de qualquer conexão, fala com o mesmo, e no máximo um pi roda
// por sessão. O harness pi, o catálogo de preços, o encerramento da execução órfã e o fim dos processos da instância
// anterior são internos: a montagem do serviço os liga, e `parar` espera o que ficou em curso.
import type { DatabaseSync } from "node:sqlite";
import type { DemandaId } from "../../../../shared/nucleo/demanda/demanda_id.ts";
import { existe } from "../../../../shared/nucleo/erros.ts";
import type { Relogio } from "../../../../shared/nucleo/relogio.ts";
import { noLog } from "../../../../shared/infra/registro.ts";
import { raizDo } from "../../../../shared/armazenamento/banco.ts";
import type { Ambiente, GestaoDeAmbientes } from "../../../ambiente/publico.ts";
import type { EventoDaSessao, Situacao } from "../../chat/publico.ts";
import type { Harness } from "../../harness/publico.ts";
import { type ConversaDaSessao, conversaDaSessao } from "./conversa_da_sessao.ts";
import { gravarUsoDeclarado, type UsoDeclarado } from "../../metricas_de_execucao/publico.ts";
import { gravarCatalogoDePrecos, type Modelo } from "../../modelos/publico.ts";
import {
  apagarSessoesDasDemandas,
  contextoDaExecucao,
  execucoesAbertas,
  type FiltroDeSessoes,
  type ResumoDaSessao,
  resumosDasSessoesEmLote,
} from "../armazenamento/sessoes_e_execucoes.ts";
import { pastasDoProcesso } from "../nucleo/pastas_da_execucao.ts";
import type { ContextoDaSessao, IdDaExecucao, IdDaSessao } from "../nucleo/sessao.ts";
import { encerrarExecucaoOrfa, registrarUsoDaConsulta } from "./encerramento.ts";
import { type ExecucaoLancada, lancarExecucaoDoPedido, type PedidoDeSessao } from "./lancamento_do_pedido.ts";
import { MotorDasSessoes, type RespostaAoDialogo } from "./motor_das_sessoes.ts";
import { type PedidoDasMetricasDeUso, usoDasMetricas, type UsoPorContexto } from "./uso_das_metricas.ts";

/** Os motores, um por arquivo do banco: os pi vivos das sessões gravadas nele, de qualquer conexão a ele. */
const motoresPorArquivo = new Map<string, MotorDasSessoes>();
/** O motor de cada conexão já vista, que segue alcançável depois de ela fechar. */
const motoresPorConexao = new WeakMap<DatabaseSync, MotorDasSessoes>();

/**
 * O motor do `banco`, criado na primeira montagem sobre o arquivo dele.
 * @testes os testes da política leem e trocam o motor direto
 */
export function motorDoBanco(banco: DatabaseSync): MotorDasSessoes {
  const daConexao = motoresPorConexao.get(banco);
  if (daConexao) return daConexao;
  // Sem SQL: o caminho vem da conexão; o banco em memória não tem arquivo, e os de memória dividem um motor.
  const arquivo = banco.location() ?? ":memory:";
  const motor = motoresPorArquivo.get(arquivo) ?? new MotorDasSessoes();
  motoresPorArquivo.set(arquivo, motor);
  motoresPorConexao.set(banco, motor);
  return motor;
}

/** Quanto o `parar` espera as execuções em curso antes de matar os pi que restaram. */
const LIMITE_PARADA_MS = 10_000;

/** O resumo da sessão com o processo vivo dela neste serviço, se há um. */
export type ResumoDaSessaoComSituacao = ResumoDaSessao & { situacao?: Situacao };

/** Um comando de conversa ao pi vivo: `prompt` acorda a sessão ociosa; `steer` e `follow_up` entram no passo atual. */
interface MensagemAoAgente {
  type: "prompt" | "steer" | "follow_up";
  message: string;
}

/** A consulta ao modelo (F4 §6.5): uma chamada única, sem ferramentas; o Uso dela conta para a `execucao` que a pediu. */
interface PedidoDeConsulta {
  prompt: string;
  modelo?: Modelo;
  limiteMs: number;
  execucao?: IdDaExecucao;
}

/** A execução aberta sem pi vivo neste serviço, que a interrupção mata e encerra: o que quem pediu diz dela. */
interface InterrupcaoDaOrfa {
  /** O Ambiente onde o pi dela rodou; só é pedido se a execução gravou o grupo do processo. */
  ambiente(): Ambiente;
  /** Depois de a execução ser encerrada com falha e antes de o chat saber que o estado mudou. */
  aoEncerrar(contexto: ContextoDaSessao): void;
  relogio: Relogio;
}

export interface SessoesDeAgente {
  /** Abre a execução (sessão nova ou a retomada) e a conduz em segundo plano até o encerramento com o Uso. */
  lancar(pedido: PedidoDeSessao): ExecucaoLancada;
  /** Manda `abort` ao pi vivo da execução, cancelando antes os diálogos pendentes. */
  abortar(execucao: IdDaExecucao): void;
  /**
   * Interrompe a execução: com condução em curso, o SIGTERM no grupo do pi (ou no que subir) a encerra como
   * `interrompida`; órfã, mata o pi pelo Ambiente dela e a encerra com falha.
   */
  interromper(execucao: IdDaExecucao, orfa: InterrupcaoDaOrfa): void;
  /** Para o pi vivo da execução, se há, como bem terminada, e espera a condução dela acabar. */
  encerrar(execucao: IdDaExecucao): Promise<void>;
  /** A consulta ao modelo; devolve a saída, ou `undefined` se o pi falhou ou passou do limite. */
  consultar(pedido: PedidoDeConsulta): Promise<string | undefined>;
  /** As sessões do filtro, sem a conversa, com o processo vivo de cada uma. */
  listar(filtro?: FiltroDeSessoes): ResumoDaSessaoComSituacao[];
  /** Os eventos do pi da sessão e `{ type: "estado" }` quando o estado dela pode ter mudado; devolve quem cancela. */
  assinar(sessao: IdDaSessao, ouvinte: (evento: EventoDaSessao) => void): () => void;
  mandar(execucao: IdDaExecucao, mensagem: MensagemAoAgente): void;
  /** Responde um diálogo pendente do pi vivo da execução. */
  responder(execucao: IdDaExecucao, dialogo: string, resposta: RespostaAoDialogo): void;
  /** A conversa guardada da sessão, com as marcas das mensagens; sessão desconhecida não tem conversa. */
  conversa(sessao: IdDaSessao): ConversaDaSessao;
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
  /** Troca o harness do motor do banco (os testes passam o falso); sem ele, fica o do motor (o pi). */
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

/** Encerra com falha a execução aberta sem pi vivo, depois de matar o pi dela pelo Ambiente em que rodou. */
function interromperOrfa(banco: DatabaseSync, motor: MotorDasSessoes, execucao: IdDaExecucao, orfa: InterrupcaoDaOrfa) {
  const [daOrfa] = resumosDasSessoesEmLote(banco, { execucoes: [execucao] }).flatMap((resumo) =>
    resumo.execucoes.filter((e) => e.id === execucao && e.fim == null).map((aberta) => ({ resumo, aberta })),
  );
  const { resumo, aberta } = existe(
    daOrfa,
    `a execução ${execucao} não está aberta`,
    "só se interrompe uma execução aberta",
  );
  if (aberta.grupo_processo !== undefined) {
    const ambiente = orfa.ambiente();
    // O host local sinaliza na hora; o encerramento abaixo não depende da resposta.
    ambiente.sinalizar({ ambiente_id: ambiente.id, grupo_processo: aberta.grupo_processo }, "SIGKILL").catch(noLog);
  }
  const contexto = { demanda_id: resumo.demanda_id, ticket_id: resumo.ticket_id };
  const { log } = pastasDoProcesso(raizDo(banco), execucao);
  const sessao = encerrarExecucaoOrfa(banco, contexto, execucao, log, motor.harness, orfa.relogio);
  orfa.aoEncerrar(contexto);
  motor.avisar(sessao, log);
}

function sessoesDoBanco(banco: DatabaseSync, gravacaoDoCatalogo: Promise<void>): SessoesDeAgente {
  // O motor só é procurado quando a operação precisa dele: as leituras do banco não pagam a consulta do arquivo.
  const motor = (): MotorDasSessoes => motorDoBanco(banco);
  return {
    lancar: (pedido) => lancarExecucaoDoPedido(banco, motor(), pedido),
    abortar: (execucao) => {
      motor().abortar(execucao);
    },
    interromper: (execucao, orfa) => {
      if (!motor().interromper(execucao)) interromperOrfa(banco, motor(), execucao, orfa);
    },
    async encerrar(execucao) {
      motor().encerrar(execucao);
      await motor().aguardarFim(execucao);
    },
    async consultar({ prompt, modelo, limiteMs, execucao }) {
      const resposta = await motor().consultar(prompt, modelo, limiteMs);
      if (resposta && execucao !== undefined) {
        const contexto = existe(
          contextoDaExecucao(banco, execucao),
          `a execução ${execucao} não existe`,
          "confira o banco",
        );
        registrarUsoDaConsulta(banco, contexto, execucao, resposta.uso);
      }
      return resposta?.saida;
    },
    listar: (filtro) =>
      resumosDasSessoesEmLote(banco, filtro).map((resumo) => {
        const situacao = motor().situacao(resumo.id);
        return situacao ? { ...resumo, situacao } : resumo;
      }),
    assinar: (sessao, ouvinte) => motor().assinar(sessao, ouvinte),
    mandar: (execucao, mensagem) => {
      motor().mandar(execucao, mensagem);
    },
    responder: (execucao, dialogo, resposta) => {
      motor().responder(execucao, dialogo, resposta);
    },
    conversa: (sessao) => {
      const raiz = raizDo(banco);
      const [resumo] = resumosDasSessoesEmLote(banco, { sessoes: [sessao] });
      return conversaDaSessao({
        modo: resumo?.modo ?? "autonomo",
        arquivo: motor().harness.arquivoDaSessao(raiz, sessao),
        pastas: (resumo?.execucoes ?? []).map((e) => pastasDoProcesso(raiz, e.id)),
      });
    },
    modelos: () => motor().harness.listarModelos(),
    declararUso: (uso) => gravarUsoDeclarado(banco, uso),
    metricas: (pedido) => usoDasMetricas(banco, pedido),
    esquecer: (demandas) => apagarSessoesDasDemandas(banco, demandas),
    async parar() {
      motor().marcarParada();
      motor().urlDaApi = undefined;
      await gravacaoDoCatalogo;
      await motor().aguardarTodos(LIMITE_PARADA_MS);
    },
  };
}

/**
 * F4 §7: mata o grupo do harness de cada execução aberta que rodou no Ambiente do serviço e encerra cada uma com falha,
 * avisando quem pediu e quem assina a sessão.
 */
async function recuperarExecucoesDaInstanciaAnterior(banco: DatabaseSync, subida: SubidaDasSessoes): Promise<void> {
  const motor = motorDoBanco(banco);
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
  const motor = motorDoBanco(banco);
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
