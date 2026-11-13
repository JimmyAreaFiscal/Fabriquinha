// As sessões de um contexto com as execuções e o Uso delas, lidos num snapshot e gravados numa unidade de trabalho só:
// o fim de uma execução e o Uso dela entram juntos (MELHORIAS §5.2). Também o Uso em lote, por sessão, contexto e período.
import type { DatabaseSync } from "node:sqlite";
import { escrever } from "../../../../shared/armazenamento/banco.ts";
import { lerEmSnapshot } from "../../../../shared/armazenamento/snapshot.ts";
import { ErroDeRegra } from "../../../../shared/nucleo/erros.ts";
import { gravarUsoDasExecucoes, lerUsoDasExecucoes, type UsoDaExecucao } from "../../metricas_de_execucao/publico.ts";
import {
  type ContextoDaLeitura,
  execucoesDoFiltro,
  gravarSessoesEExecucoes,
  lerSessoesEExecucoes,
  type SessoesEExecucoes,
} from "../armazenamento/sessoes_e_execucoes.ts";
import { type ContextoDaSessao, Execucao, type IdDaSessao } from "../nucleo/sessao.ts";

export interface SessoesDoContexto extends SessoesEExecucoes {
  usos: UsoDaExecucao[];
}

/** O que escolhe o Uso em lote; os filtros se somam, e o período `[inicio, fim)` é o do início da execução. */
interface FiltroDoUso {
  sessoes?: readonly IdDaSessao[];
  contexto?: { demanda_id: string; ticket_id?: number };
  periodo?: { inicio: string; fim: string };
}

/**
 * O Uso medido das execuções que casam com o filtro, sem ler conversa nem sessão.
 * @testes o consumidor de produção de fora é a métrica de uso (ticket 17), que hoje lê as tabelas por SQL
 */
export const usoEmLote = (banco: DatabaseSync, filtro: FiltroDoUso): UsoDaExecucao[] =>
  lerEmSnapshot(banco, () => lerUsoDasExecucoes(banco, execucoesDoFiltro(banco, filtro)));

/** As sessões do contexto (`ticket_id` nulo: a demanda inteira), com as execuções e o Uso delas, num snapshot só. */
export const carregarSessoesDoContexto = (banco: DatabaseSync, contexto: ContextoDaLeitura): SessoesDoContexto =>
  lerEmSnapshot(banco, () => {
    const lidas = lerSessoesEExecucoes(banco, contexto);
    return { ...lidas, usos: usoEmLote(banco, { sessoes: lidas.sessoes.map(({ id }) => id) }) };
  });

function validar(contexto: ContextoDaSessao, { sessoes, execucoes, usos }: SessoesDoContexto): void {
  const deOutroContexto = sessoes.find(
    (s) => s.demanda_id !== contexto.demanda_id || s.ticket_id !== contexto.ticket_id,
  );
  if (deOutroContexto)
    throw new ErroDeRegra(
      `sessão ${deOutroContexto.id} não é do ticket ${contexto.demanda_id}/${String(contexto.ticket_id)}`,
    );
  const ids = new Set(sessoes.map((s) => s.id));
  const semSessao = execucoes.find((e) => !ids.has(e.trabalho_id));
  if (semSessao) throw new ErroDeRegra(`execução ${semSessao.id} não é de uma sessão do ticket`);
  for (const execucao of execucoes) {
    const validacao = Execucao.safeParse(execucao);
    if (!validacao.success)
      throw new ErroDeRegra(
        `execução ${execucao.id} inválida: ${validacao.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      );
  }
  const idsDasExecucoes = new Set(execucoes.map((e) => e.id));
  const usoSemExecucao = usos.find((u) => !idsDasExecucoes.has(u.execucao_id));
  if (usoSemExecucao)
    throw new ErroDeRegra(`uso da execução ${usoSemExecucao.execucao_id} não é de uma execução do ticket`);
}

/** Carrega as sessões do contexto, aplica a transição pura e grava o resultado numa unidade de trabalho (erro desfaz tudo). */
export const comSessoesDoContexto = (
  banco: DatabaseSync,
  contexto: ContextoDaSessao,
  transicao: (estado: SessoesDoContexto) => SessoesDoContexto,
): SessoesDoContexto =>
  escrever(banco, () => {
    const antes = carregarSessoesDoContexto(banco, contexto);
    const depois = transicao(antes);
    validar(contexto, depois);
    gravarSessoesEExecucoes(banco, antes, depois);
    gravarUsoDasExecucoes(banco, depois.usos);
    return depois;
  });
