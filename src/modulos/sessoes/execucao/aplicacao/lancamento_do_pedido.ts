// O lançamento de uma sessão pedida (MELHORIAS §9): abre a execução (sessão nova ou a retomada da mais recente do
// contexto), espera quem pediu preparar o pi (o Espaço, o prompt, o lançamento), sobe o pi pelo motor e encerra a
// execução com o Uso, venha o fim do pi, da preparação, da interrupção ou da parada do serviço. O que cada fim significa
// é de quem pediu, que o recebe antes de o chat saber que o estado mudou.
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { raizDo } from "../../../../shared/armazenamento/banco.ts";
import { mensagem } from "../../../../shared/nucleo/erros.ts";
import { motivo } from "../../../../shared/nucleo/primitivos.ts";
import type { Relogio } from "../../../../shared/nucleo/relogio.ts";
import { anotar } from "../../../../shared/infra/registro.ts";
import type { Ambiente } from "../../../ambiente/publico.ts";
import type { PerguntaDoAgente, RespostaAPergunta } from "../../chat/publico.ts";
import type { LancamentoDoTicket } from "../../harness/publico.ts";
import type { ConfiguracaoDoModelo } from "../../modelos/publico.ts";
import { gravarAmbienteDaExecucao } from "../armazenamento/sessoes_e_execucoes.ts";
import type { FalhaDaExecucao } from "../nucleo/falha_da_execucao.ts";
import { pastasDoProcesso } from "../nucleo/pastas_da_execucao.ts";
import {
  type ContextoDaSessao,
  criarSessao,
  type Execucao,
  iniciarExecucao,
  retomarSessao,
  type Sessao,
} from "../nucleo/sessao.ts";
import { encerrarExecucaoComUso } from "./encerramento.ts";
import type { MotorDasSessoes } from "./motor_das_sessoes.ts";
import { comSessoesDoContexto } from "./sessoes_do_contexto.ts";

/** A execução que o lançamento abriu, com a sessão dela e as pastas fora do banco: `dir` para o prompt e a saída, e o `log`. */
export interface ExecucaoAberta {
  sessao: Sessao;
  execucao: Execucao;
  dir: string;
  log: string;
}

/** O que quem pede prepara para o pi subir: o agente, onde ele roda e o prompt; a política da pergunta, se há. */
export interface PreparoDoLancamento {
  lancamento: LancamentoDoTicket;
  cwd: string;
  ambiente: Ambiente;
  prompt: string | undefined;
  /** Autônoma: a resposta à pergunta da `perguntar` que a política dá sozinha; `undefined` a deixa com quem conversa. */
  triarPergunta?: (pergunta: PerguntaDoAgente) => Promise<RespostaAPergunta | undefined>;
}

export interface PedidoDeSessao {
  /** A correlação de quem pede; a execução retoma a sessão mais recente dele, se há uma. */
  contexto: ContextoDaSessao;
  /** O modo da sessão nova; a retomada segue no da sessão. */
  modo: "autonomo" | "interativo";
  /** Abre sessão nova mesmo com sessão no contexto: a conversa anterior foi descartada. */
  sessaoNova?: boolean;
  configuracao_agente?: ConfiguracaoDoModelo;
  limiteMin: number;
  relogio: Relogio;
  /** Logo depois de gravar a execução aberta, antes de qualquer espera: a recusa lança já, com a execução aberta. */
  aoAbrir(aberta: ExecucaoAberta): void;
  /** Prepara o pi; o erro vira a falha `preparacao_falhou`, e o pi não sobe. */
  preparar(aberta: ExecucaoAberta): Promise<PreparoDoLancamento>;
  /** Depois da execução encerrada com o Uso e antes do último aviso ao chat; não lança. */
  aoEncerrar(aberta: ExecucaoAberta, falha: FalhaDaExecucao | undefined): Promise<void>;
}

/** A execução lançada: aberta já, e o `fim`, que resolve com a falha técnica, ou `undefined`, depois do `aoEncerrar`. */
export interface ExecucaoLancada extends ExecucaoAberta {
  fim: Promise<FalhaDaExecucao | undefined>;
}

/** Abre a execução do pedido: retoma a sessão mais recente do contexto, ou cria a sessão no modo do pedido. */
function abrirExecucao(
  banco: DatabaseSync,
  pedido: PedidoDeSessao,
  relogio: Relogio,
): { sessao: Sessao; execucao: Execucao } {
  const abrirNaSessao = (trabalho_id: string): Execucao => ({
    id: randomUUID(),
    trabalho_id,
    inicio: relogio.agora(),
    falha: false,
    ...(pedido.configuracao_agente && { configuracao_agente: pedido.configuracao_agente }),
  });
  let sessao!: Sessao;
  let execucao!: Execucao;
  comSessoesDoContexto(banco, pedido.contexto, (estado) => {
    // Com mais de uma sessão no contexto, retoma-se a mais recente.
    const existente = pedido.sessaoNova ? undefined : estado.sessoes.at(-1);
    if (existente) {
      sessao = existente;
      execucao = abrirNaSessao(sessao.id);
      return { ...estado, execucoes: retomarSessao(estado.sessoes, estado.execucoes, execucao) };
    }
    const id = randomUUID();
    sessao = { ...pedido.contexto, id, modo: pedido.modo, conversa_referencia: id };
    execucao = abrirNaSessao(id);
    const sessoes = criarSessao(estado.sessoes, sessao);
    return { ...estado, sessoes, execucoes: iniciarExecucao(sessoes, estado.execucoes, execucao) };
  });
  return { sessao, execucao };
}

/** Grava o grupo de processo do pi e o Ambiente que o lançou, para o reinício do serviço poder interrompê-lo (F4 §7). */
function gravarGrupo(
  banco: DatabaseSync,
  { sessao, execucao }: ExecucaoAberta,
  pgid: number,
  ambienteId: string,
): void {
  comSessoesDoContexto(banco, sessao, (estado) => ({
    ...estado,
    execucoes: estado.execucoes.map((e) => (e.id === execucao.id ? { ...e, grupo_processo: pgid } : e)),
  }));
  gravarAmbienteDaExecucao(banco, execucao.id, ambienteId);
}

/** Sobe o pi preparado; a parada do serviço durante a preparação não sobe pi novo. */
async function subirOPi(
  banco: DatabaseSync,
  motor: MotorDasSessoes,
  pedido: PedidoDeSessao,
  aberta: ExecucaoAberta,
  preparo: PreparoDoLancamento,
): Promise<FalhaDaExecucao | undefined> {
  const { sessao, execucao, log } = aberta;
  try {
    if (motor.emParada()) throw new Error("o serviço está parando");
    return await motor.lancarExecucao({
      execucao: { id: execucao.id, sessao: sessao.id, modo: sessao.modo },
      lancamento: preparo.lancamento,
      cwd: preparo.cwd,
      ambiente: preparo.ambiente,
      banco,
      log,
      prompt: preparo.prompt,
      limiteMin: pedido.limiteMin,
      ...(preparo.triarPergunta && { triarPergunta: preparo.triarPergunta }),
      aoLancar: (pgid, ambienteId) => {
        gravarGrupo(banco, aberta, pgid, ambienteId);
      },
    });
  } catch (erro) {
    // O harness que recusa o lançamento (a raiz git sumiu) e a parada: o agente nem subiu.
    const texto = motivo(mensagem(erro));
    anotar(log, `preparação falhou: ${texto}`);
    return { tipo: "falha_do_agente", motivo: texto };
  }
}

async function conduzir(
  banco: DatabaseSync,
  motor: MotorDasSessoes,
  pedido: PedidoDeSessao,
  aberta: ExecucaoAberta,
  relogio: Relogio,
): Promise<FalhaDaExecucao | undefined> {
  const { sessao, execucao, log } = aberta;
  let falha: FalhaDaExecucao | undefined;
  let preparo: PreparoDoLancamento | undefined;
  try {
    preparo = await pedido.preparar(aberta);
  } catch (erro) {
    falha = { tipo: "preparacao_falhou", erro };
  }
  if (preparo) {
    if (preparo.prompt !== undefined) writeFileSync(join(aberta.dir, "prompt.md"), preparo.prompt);
    falha = await subirOPi(banco, motor, pedido, aberta, preparo);
  }
  // Interrompida: o pi saiu pelo SIGTERM, mas a causa verdadeira é a interrupção; na parada, o reinício.
  if (motor.foiInterrompido(execucao.id)) falha = { tipo: "interrompida" };
  else if (motor.emParada()) falha = { tipo: "servico_reiniciado" };
  motor.deixarDeAcompanhar(execucao.id);
  encerrarExecucaoComUso({ banco, ref: sessao, sessao, execucao }, falha !== undefined, log, motor.harness, relogio);
  await pedido.aoEncerrar(aberta, falha);
  // O último `estado` do SSE sai depois do fim gravado e do que quem pediu fez com ele: o chat precisa do cabeçalho novo.
  motor.avisar(sessao.id, log);
  return falha;
}

/**
 * Abre a execução do pedido e a conduz em segundo plano, já interrompível durante a preparação. Síncrona até gravar a
 * execução aberta e chamar `aoAbrir`.
 */
export function lancarExecucaoDoPedido(
  banco: DatabaseSync,
  motor: MotorDasSessoes,
  pedido: PedidoDeSessao,
): ExecucaoLancada {
  const { relogio } = pedido;
  const { sessao, execucao } = abrirExecucao(banco, pedido, relogio);
  const aberta: ExecucaoAberta = { sessao, execucao, ...pastasDoProcesso(raizDo(banco), execucao.id) };
  pedido.aoAbrir(aberta);
  const fim = motor.acompanhar(execucao.id, () => conduzir(banco, motor, pedido, aberta, relogio));
  return { ...aberta, fim };
}
