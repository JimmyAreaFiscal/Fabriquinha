// O contrato da API da Simulação (F8): o corpo de cada resposta JSON. A entrada das mutações é a do núcleo
// (`NovoUsuarioSimulado`, `NovaTarefa`). São só schemas: o teste de rota confere o corpo por eles.
import { z } from "zod";
import { Id, Instante } from "../../compartilhado/nucleo/primitivos.ts";
import { RelatorioSimulacao, StatusExecucaoSimulada } from "../../qualidade/nucleo/simulacao.ts";

/** Um arquivo anexado ao Usuário Simulado, com o que a tela mostra dele. */
export const Anexo = z.object({ nome: z.string(), sha256: z.string(), bytes: z.number().int().nonnegative() });

export const UsuarioSimulado = z.object({
  id: Id,
  projeto: z.string(),
  nome: z.string(),
  descricao: z.string(),
  anexos: z.array(Anexo),
});
export type UsuarioSimulado = z.infer<typeof UsuarioSimulado>;

/** O `relatorio` só vem na execução concluída e o `erro`, na que falhou. */
const ExecucaoSimulada = z.object({
  id: Id,
  usuario: Id,
  usuarioNome: z.string(),
  status: StatusExecucaoSimulada,
  relatorio: RelatorioSimulacao.optional(),
  erro: z.string().optional(),
});

export const Tarefa = z.object({
  id: Id,
  projeto: z.string(),
  texto: z.string(),
  n: z.number().int().positive(),
  criadaEm: Instante,
  /** Os Usuários Simulados alocados, em ordem de criação. */
  usuarios: z.array(z.object({ id: Id, nome: z.string() })),
  execucoes: z.array(ExecucaoSimulada),
});
export type Tarefa = z.infer<typeof Tarefa>;
