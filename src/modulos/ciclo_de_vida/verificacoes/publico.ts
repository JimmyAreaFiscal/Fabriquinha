// A API de Verificações (MELHORIAS §11): roda testes, e2e, fitness, Sonar e os hooks do commit na worktree e classifica
// cada resultado em sucesso, reprovação técnica ou falha de infraestrutura (regra 10). Testes, fitness e Sonar deixam o
// registro que vira Evidência; os hooks do commit e a conferência do PR produzem só o resultado (regra 9). A configuração
// do projeto chega como dado (`ProjetoAVerificar`).
export { coletarVerificacoes } from "./aplicacao/coleta_das_verificacoes.ts";
export { ConferenciaDoPR } from "./infra/conferencia_do_pr.ts";
export { HooksDoCommit } from "./infra/hooks_do_commit.ts";
export { VerificacaoDeFitness } from "./infra/tipos_de_verificacao/fitness.ts";
export type { OpcoesSonar } from "./infra/tipos_de_verificacao/sonar.ts";
export { type Falha, montarVerificacoesDaEtapa, type RegistroDaVerificacao } from "./infra/verificacao.ts";
export type { ProjetoAVerificar } from "./nucleo/projeto_a_verificar.ts";
export type { ResultadoDaVerificacao } from "./nucleo/verificacao.ts";
