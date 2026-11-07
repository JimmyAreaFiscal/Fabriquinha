// Coleta das verificações de um ticket da demanda (execucao_testes, matriz_fitness, relatorio_sonar), sem banco: devolve
// o resultado para quem chama gravar as evidências e decidir. Não grava, não conclui, não devolve, não falha, não commita.
import type { Projeto } from "../../nucleo/projeto.ts";
import { ErroDeRegra } from "../../nucleo/erros.ts";
import { analisarSonar, arquivosAlterados, type OpcoesSonar } from "./sonar.ts";
import { aprovacao, type Falha, type Verificacao, verificarFitness, verificarTestes } from "./verificacoes_comandos.ts";

export type { Falha, Verificacao } from "./verificacoes_comandos.ts";

interface EntradaVerificacoes {
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
    // Cada issue vai no motivo: é ele que chega ao agente na devolução, e só a contagem o fazia perguntar o que corrigir.
    const listaDeIssues = issues
      .map(
        (i) =>
          `\n  - ${i.arquivo}${i.linha === undefined ? "" : `:${String(i.linha)}`} ${i.regra} (${i.severidade}): ${i.mensagem}`,
      )
      .join("");
    const falhas: Falha[] = issues.length
      ? [
          {
            classe: "tecnica",
            motivo: `${String(issues.length)} issue(s) aberta(s) em arquivos alterados; corrija cada uma:${listaDeIssues}`,
          },
        ]
      : [];
    const dados = { chave_sonarqube: projeto.chave_sonarqube, ceTaskId, arquivosAnalisados: analisados, issues };
    return { tipo, aprovada: aprovacao(falhas), falhas, dados, logs: [] } satisfies Verificacao;
  } catch (erro) {
    if (!(erro instanceof ErroDeRegra)) throw erro;
    const falhas: Falha[] = [{ classe: "infraestrutura", motivo: erro.message }];
    return { tipo, aprovada: aprovacao(falhas), falhas, dados: {}, logs: [] } satisfies Verificacao;
  }
}

/**
 * Roda as três verificações, sempre, e as devolve na ordem do catálogo. O Sonar lê o lcov dos testes das linguagens:
 * começa assim que eles terminam e roda junto com o E2E e as fitness functions, que seguem em série como antes.
 */
export async function coletarVerificacoes(entrada: EntradaVerificacoes): Promise<Verificacao[]> {
  const arquivos = await arquivosAlterados(entrada.worktree);
  let sonarEmAndamento: Promise<Verificacao> | undefined;
  const iniciarSonar = () => (sonarEmAndamento ??= verificarSonar(entrada, arquivos));
  const comandos = { ...entrada, arquivos, limiteMs: entrada.opcoes?.limiteMs };
  const testes = await verificarTestes({
    ...comandos,
    aoTerminarAsLinguagens: () => {
      // A falha sobe quando o Sonar é esperado, abaixo; o allSettled só a trata se o E2E lançar antes dessa espera.
      void Promise.allSettled([iniciarSonar()]);
    },
  });
  const [fitness, sonar] = await Promise.all([verificarFitness(comandos), iniciarSonar()]);
  return [testes, fitness, sonar];
}
