// Coleta das verificações de um ticket da demanda (execucao_testes, matriz_fitness, relatorio_sonar), sem banco: devolve
// o resultado para quem chama gravar as evidências e decidir. Não grava, não conclui, não devolve, não falha, não commita.
import type { Projeto } from "../../nucleo/projeto.ts";
import { VerificacaoDeFitness } from "../../infra/verificacao/fitness.ts";
import { arquivosAlterados, type OpcoesSonar, VerificacaoSonar } from "../../infra/verificacao/sonar.ts";
import { VerificacaoDeTestes } from "../../infra/verificacao/testes.ts";
import type { RegistroDaVerificacao } from "../../infra/verificacao/verificacao.ts";

export type { Falha, RegistroDaVerificacao } from "../../infra/verificacao/verificacao.ts";

interface EntradaVerificacoes {
  projeto: Projeto;
  /** A rodada está marcada com e2e. */
  e2e: boolean;
  worktree: string;
  opcoes?: OpcoesSonar;
}

/**
 * Roda as três verificações, sempre, e as devolve na ordem do catálogo. O Sonar lê o lcov dos testes das linguagens:
 * começa assim que eles terminam e roda junto com o E2E e as fitness functions, que seguem em série como antes.
 */
export async function coletarVerificacoes(entrada: EntradaVerificacoes): Promise<RegistroDaVerificacao[]> {
  const { projeto, e2e, worktree, opcoes } = entrada;
  const arquivos = await arquivosAlterados(worktree);
  const contexto = { worktree, limiteMs: opcoes?.limiteMs };
  const sonar = new VerificacaoSonar(projeto.chave_sonarqube, arquivos, opcoes);
  let sonarEmAndamento: Promise<RegistroDaVerificacao> | undefined;
  const iniciarSonar = () => (sonarEmAndamento ??= sonar.coletar(contexto));
  const testes = new VerificacaoDeTestes({
    projeto,
    e2e,
    arquivos,
    aoTerminarAsLinguagens: () => {
      // A falha sobe quando o Sonar é esperado, abaixo; o allSettled só a trata se o E2E lançar antes dessa espera.
      void Promise.allSettled([iniciarSonar()]);
    },
  });
  const registroDosTestes = await testes.coletar(contexto);
  const [fitness, registroDoSonar] = await Promise.all([
    new VerificacaoDeFitness(projeto).coletar(contexto),
    iniciarSonar(),
  ]);
  return [registroDosTestes, fitness, registroDoSonar];
}
