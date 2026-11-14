// O fluxo da remoção do projeto (I-4, MELHORIAS §5.1 e §5.3), entre Demandas, o Ciclo de Vida, Sessões e o Repositório:
// numa unidade de trabalho só, que Demandas abre, o Ciclo de Vida recusa a execução em andamento e cada domínio apaga as
// suas tabelas, na ordem das chaves estrangeiras: os commits, as sessões e o desenvolvimento das demandas do projeto e o
// cursor da varredura dele; depois Demandas apaga as dependências, os pedidos, o cadastro e o disco.
import type { DatabaseSync } from "node:sqlite";
import type { CicloDeVida } from "../../../../modulos/ciclo_de_vida/publico.ts";
import type { GestaoDeDemandas } from "../../../../modulos/demandas/publico.ts";
import { montarRepositorio } from "../../../../modulos/repositorio/publico.ts";
import { montarSessoesDeAgente } from "../../../../modulos/sessoes/publico.ts";

/** Remove o projeto e tudo o que depende dele, em qualquer estado; falha no disco vira aviso. */
export const removerProjetoComOQueDependeDele = (
  banco: DatabaseSync,
  cicloDeVida: CicloDeVida,
  gestaoDeDemandas: GestaoDeDemandas,
  nome: string,
) =>
  gestaoDeDemandas.removerProjeto(nome, (pedidos) => {
    const esquecerDesenvolvimento = cicloDeVida.esquecer(nome, pedidos);
    const removerWorktrees = montarRepositorio({ banco }).esquecer(gestaoDeDemandas.projeto(nome), pedidos);
    const { execucoes, sessoes } = montarSessoesDeAgente({ banco }).esquecer(pedidos);
    const anexosSemEvidencia = esquecerDesenvolvimento();
    return { execucoes, sessoes, anexosSemEvidencia, removerWorktrees };
  });
