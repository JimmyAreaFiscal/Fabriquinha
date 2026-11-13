// Qual modelo e qual effort o agente usa (CONCEITOS.md §13): o valor que ticket, plano, etapa do projeto, execução e
// formulário carregam, e a D07 que o resolve, uma vez só, campo a campo.
import { z } from "zod";
import { Effort, Modelo } from "../../../sessoes/publico.ts";

/** Campo ausente é "sem escolha": vale o próximo da D07, até o padrão do harness. */
export const ConfiguracaoAgente = z.object({ modelo: Modelo.optional(), effort: Effort.optional() });
export type ConfiguracaoAgente = z.infer<typeof ConfiguracaoAgente>;

/** D07: modelo e effort, cada um sozinho: o do ticket, senão o da etapa do projeto, senão o padrão. */
export const resolverConfiguracaoAgente = ({
  ticket,
  etapaDoProjeto,
  padrao,
}: {
  ticket?: ConfiguracaoAgente | undefined;
  etapaDoProjeto?: ConfiguracaoAgente | undefined;
  padrao: ConfiguracaoAgente;
}): ConfiguracaoAgente => ({
  modelo: ticket?.modelo ?? etapaDoProjeto?.modelo ?? padrao.modelo,
  effort: ticket?.effort ?? etapaDoProjeto?.effort ?? padrao.effort,
});
