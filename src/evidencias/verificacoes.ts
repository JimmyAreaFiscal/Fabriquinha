// Coleta das verificações de um ticket da demanda (execucao_testes, matriz_fitness, relatorio_sonar), sem banco: devolve
// o resultado para quem chama gravar as evidências e decidir. Não grava, não conclui, não devolve, não falha, não commita.
import type { Projeto } from "../dominio/configuracao_projeto.ts";
import { ErroDeRegra } from "../dominio/erros.ts";
import { analisarSonar, arquivosAlterados, type OpcoesSonar } from "./sonar.ts";
import { aprovacao, type Falha, type Verificacao, verificarFitness, verificarTestes } from "./verificacoes_comandos.ts";

export type { Falha, Verificacao } from "./verificacoes_comandos.ts";

export interface EntradaVerificacoes {
  projeto: Projeto;
  /** A rodada está marcada com e2e. */
  e2e: boolean;
  worktree: string;
  opcoes?: OpcoesSonar;
}

/** Qualquer ErroDeRegra do Sonar (fora do ar, scanner, tempo) é infraestrutura; issue aberta em arquivo alterado, técnica. */
async function verificarSonar({ projeto, worktree, opcoes }: EntradaVerificacoes, arquivos: string[]) {
  const tipo = "relatorio_sonar";
  try {
    const {
      ceTaskId,
      arquivos: analisados,
      issues,
    } = await analisarSonar(projeto.chave_sonarqube, worktree, () => Promise.resolve(arquivos), opcoes);
    const falhas: Falha[] = issues.length
      ? [{ classe: "tecnica", motivo: `${String(issues.length)} issue(s) aberta(s) em arquivos alterados` }]
      : [];
    const dados = { projectKey: projeto.chave_sonarqube, ceTaskId, arquivosAnalisados: analisados, issues };
    return { tipo, aprovada: aprovacao(falhas), falhas, dados, logs: [] } satisfies Verificacao;
  } catch (erro) {
    if (!(erro instanceof ErroDeRegra)) throw erro;
    const falhas: Falha[] = [{ classe: "infraestrutura", motivo: erro.message }];
    return { tipo, aprovada: aprovacao(falhas), falhas, dados: {}, logs: [] } satisfies Verificacao;
  }
}

/** Roda as três verificações, sempre, na ordem do catálogo. */
export async function coletarVerificacoes(entrada: EntradaVerificacoes): Promise<Verificacao[]> {
  const arquivos = await arquivosAlterados(entrada.worktree);
  const comandos = { ...entrada, arquivos, limiteMs: entrada.opcoes?.limiteMs };
  return [await verificarTestes(comandos), await verificarFitness(comandos), await verificarSonar(entrada, arquivos)];
}
