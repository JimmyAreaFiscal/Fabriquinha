// Coleta das verificações de um ticket da demanda (execucao_testes, matriz_fitness, relatorio_sonar), sem banco: devolve
// o resultado para quem chama gravar as evidências e decidir. Não grava, não conclui, não devolve, não falha, não commita.
import type { Ambiente } from "../../../ambiente/publico.ts";
import type { ProjetoAVerificar } from "../nucleo/projeto_a_verificar.ts";
import { VerificacaoDeFitness } from "../infra/tipos_de_verificacao/fitness.ts";
import { arquivosAlterados, type OpcoesSonar, VerificacaoSonar } from "../infra/tipos_de_verificacao/sonar.ts";
import { VerificacaoDeTestes } from "../infra/tipos_de_verificacao/testes.ts";
import { montarVerificacoesDaEtapa, type RegistroDaVerificacao } from "../infra/verificacao.ts";
import type { EtapaTicket } from "../../etapas/publico.ts";

interface EntradaVerificacoes {
  /** A Etapa que verifica o código depois do agente; as verificações são as que ela declara. */
  etapa: EtapaTicket;
  /** O Ambiente do ciclo do Espaço, onde os comandos configurados rodam. */
  ambiente: Ambiente;
  projeto: ProjetoAVerificar;
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
  const { etapa, ambiente, projeto, e2e, worktree, opcoes } = entrada;
  const arquivos = await arquivosAlterados(ambiente, worktree);
  const contexto = { ambiente, worktree, limiteMs: opcoes?.limiteMs };
  let sonarEmAndamento: Promise<RegistroDaVerificacao> | undefined;
  const iniciarSonar = () => (sonarEmAndamento ??= sonar.coletar(contexto));
  // Os hooks ficam com o fechamento.
  const { testes, fitness, sonar } = montarVerificacoesDaEtapa(etapa, {
    testes: () =>
      new VerificacaoDeTestes({
        projeto,
        e2e,
        arquivos,
        aoTerminarAsLinguagens: () => {
          // A falha sobe quando o Sonar é esperado, abaixo; o allSettled só a trata se o E2E lançar antes dessa espera.
          void Promise.allSettled([iniciarSonar()]);
        },
      }),
    fitness: () => new VerificacaoDeFitness(projeto),
    sonar: () => new VerificacaoSonar(projeto.chave_sonarqube, arquivos, opcoes),
  });
  // Os testes vêm primeiro; o resto roda junto.
  const registroDosTestes = await testes.coletar(contexto);
  return [registroDosTestes, ...(await Promise.all([fitness.coletar(contexto), iniciarSonar()]))];
}
