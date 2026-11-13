// O fim de cada execução: o fim com a falha e o Uso na mesma unidade de trabalho, o Uso de uma consulta somado à execução
// que a pediu e a execução que ficou aberta sem processo. O Uso sem custo informado pelo harness recebe aqui, antes de ser
// gravado, o custo estimado pelo preço do catálogo vigente no instante (MELHORIAS §13, item 2). Quem mata o processo é `SessoesDeAgente`; o que a falha
// significa para quem pediu a sessão é da política, que recebe a execução encerrada.
import type { DatabaseSync } from "node:sqlite";
import { raizDo } from "../../../../shared/armazenamento/banco.ts";
import { existe, mensagem } from "../../../../shared/nucleo/erros.ts";
import { type Relogio, relogioDoSistema } from "../../../../shared/nucleo/relogio.ts";
import { anotar } from "../../../../shared/infra/registro.ts";
import type { Harness, LinhaDeUso } from "../../harness/publico.ts";
import {
  acumularUso,
  estimarCustoPeloCatalogo,
  type UsoDaExecucao,
  usoDaExecucaoDaLinha,
} from "../../metricas_de_execucao/publico.ts";
import { lerPrecoVigente } from "../../modelos/publico.ts";
import {
  type ContextoDaSessao,
  encerrarExecucao,
  type Execucao,
  type IdDaExecucao,
  type IdDaSessao,
  type Sessao,
} from "../nucleo/sessao.ts";
import { carregarSessoesDoContexto, comSessoesDoContexto } from "./sessoes_do_contexto.ts";

/** A execução a encerrar, com a sessão e o contexto dela. */
interface ExecucaoEncerravel {
  banco: DatabaseSync;
  ref: ContextoDaSessao;
  sessao: Sessao;
  execucao: Execucao;
}

/** Quem lê o Uso da sessão do agente: o harness. */
type LeitorDeUso = Pick<Harness, "lerUsoDaSessao">;

/** A linha de Uso como a execução a guarda, com o custo que o harness não informou estimado pelo preço vigente em `instante`. */
function usoComCustoEstimado(
  banco: DatabaseSync,
  execucao: IdDaExecucao,
  linha: LinhaDeUso,
  instante: string,
): UsoDaExecucao {
  const uso = usoDaExecucaoDaLinha(execucao, linha);
  if (uso.custo !== undefined) return uso;
  const preco = lerPrecoVigente(banco, { provedor: uso.modelo_provedor, nome: uso.modelo_nome }, instante);
  return estimarCustoPeloCatalogo(uso, preco);
}

/** O uso por modelo da janela da execução; custo ausente sem preço no catálogo, ou parcial, fica nulo, nunca zero. */
function coletarUso(c: ExecucaoEncerravel, fim: string, log: string, harness: LeitorDeUso): UsoDaExecucao[] {
  try {
    return harness
      .lerUsoDaSessao(raizDo(c.banco), c.sessao.id, Date.parse(c.execucao.inicio), Date.parse(fim))
      .map((linha) => usoComCustoEstimado(c.banco, c.execucao.id, linha, fim));
  } catch (error_) {
    // Métrica nunca impede o encerramento.
    anotar(log, `coleta de uso falhou: ${mensagem(error_)}`);
    return [];
  }
}

/** O único escritor do encerramento: fim, falha e uso na mesma transação; não toca o contexto de quem pediu. */
export function encerrarExecucaoComUso(
  c: ExecucaoEncerravel,
  falhou: boolean,
  log: string,
  harness: LeitorDeUso,
  relogio: Relogio = relogioDoSistema,
): void {
  const fim = relogio.agora();
  const usos = coletarUso(c, fim, log, harness);
  comSessoesDoContexto(c.banco, c.ref, (estado) => ({
    ...estado,
    execucoes: encerrarExecucao(estado.execucoes, c.execucao.id, fim, falhou),
    // Soma, não substitui: a execução pode já ter o Uso de uma consulta (`registrarUsoDaConsulta`).
    usos: usos.reduce((acumulado, uso) => acumularUso(acumulado, uso), estado.usos),
  }));
}

/** Soma o Uso de uma consulta à execução que a pediu, para ele contar no contexto dela, com o custo estimado se faltar. */
export function registrarUsoDaConsulta(
  banco: DatabaseSync,
  ref: ContextoDaSessao,
  execucao: IdDaExecucao,
  linhas: readonly LinhaDeUso[],
  relogio: Relogio = relogioDoSistema,
): void {
  const instante = relogio.agora();
  comSessoesDoContexto(banco, ref, (estado) => ({
    ...estado,
    usos: linhas.reduce(
      (acumulado, linha) => acumularUso(acumulado, usoComCustoEstimado(banco, execucao, linha, instante)),
      estado.usos,
    ),
  }));
}

/** Execução aberta sem processo vivo (o harness já foi morto): encerra com falha e devolve a sessão dela. */
export function encerrarExecucaoOrfa(
  banco: DatabaseSync,
  ref: ContextoDaSessao,
  id: IdDaExecucao,
  log: string,
  harness: LeitorDeUso,
  relogio: Relogio = relogioDoSistema,
): IdDaSessao {
  const { sessoes, execucoes } = carregarSessoesDoContexto(banco, ref);
  const execucao = existe(
    execucoes.find((e) => e.id === id),
    `a execução ${id} não existe`,
    "confira o banco",
  );
  const sessao = existe(
    sessoes.find((s) => s.id === execucao.trabalho_id),
    `a execução ${id} não tem sessão`,
    "confira o banco",
  );
  encerrarExecucaoComUso({ banco, ref, sessao, execucao }, true, log, harness, relogio);
  return sessao.id;
}
