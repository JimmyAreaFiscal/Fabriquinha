// O banco da Fabriquinha com as migrações dos domínios (MELHORIAS §5.1.6): o histórico congelado do shared e, depois dele,
// as que cada domínio registra. Todo processo que abre o banco (serviço, CLI, testes) passa por aqui: quem abrisse sem as
// migrações dos domínios acharia o banco numa versão mais nova que a que conhece. Por isso é aqui também que a composição
// liga ao Ciclo de Vida o que ele lê de Demandas como dado: os projetos cadastrados e o conteúdo dos pedidos (MELHORIAS §11,
// regra 2), à Condução os limites das sessões, da configuração do serviço do Despacho, e o fluxo da conclusão do
// desenvolvimento, que conclui o pedido em Demandas junto do encerramento do processo.
import type { DatabaseSync } from "node:sqlite";
import { abrir, enfileirarDepoisDoHistorico, migrar } from "../../shared/armazenamento/banco.ts";
import { VERSAO_LINHA_DE_BASE } from "../../shared/armazenamento/migracoes/migracoes.ts";
import { MIGRACOES_DO_AMBIENTE } from "../../modulos/ambiente/publico.ts";
import { concluirDesenvolvimento } from "../fluxos/conclusao_do_desenvolvimento.ts";
import {
  configuracao,
  ligarConclusaoDoDesenvolvimento,
  ligarLeituraDosLimitesDasSessoes,
  ligarLeituraDosPedidosRecebidos,
  ligarLeituraDosProjetosCadastrados,
  MIGRACOES_DO_CICLO_DE_VIDA,
} from "../../modulos/ciclo_de_vida/publico.ts";
import {
  buscarProjeto,
  carregarProjeto,
  lerPedidosEmLote,
  MIGRACOES_DE_DEMANDAS,
  projetoExistente,
} from "../../modulos/demandas/publico.ts";

ligarLeituraDosProjetosCadastrados({ buscarProjeto, carregarProjeto, projetoExistente });
ligarLeituraDosPedidosRecebidos({ lerPedidosEmLote });
ligarConclusaoDoDesenvolvimento(concluirDesenvolvimento);
ligarLeituraDosLimitesDasSessoes({
  timeoutMin: (banco) => configuracao(banco).timeoutMin,
  ociosidadeMin: (banco) => configuracao(banco).ociosidadeMin,
});

const MIGRACOES_DOS_DOMINIOS = [MIGRACOES_DE_DEMANDAS, MIGRACOES_DO_CICLO_DE_VIDA, MIGRACOES_DO_AMBIENTE];

/** Abre o banco da `raiz` (padrão: a do serviço) e aplica as migrações pendentes, do histórico e dos domínios. */
export const abrirBancoDaFabriquinha = (raiz?: string): DatabaseSync => abrir(raiz, MIGRACOES_DOS_DOMINIOS);

/**
 * Leva o banco já aberto à versão atual, ou só até `versao`, pelas mesmas migrações que a abertura aplica.
 * @testes os testes de migração montam o banco numa versão anterior e o banco em memória
 */
export const migrarBancoDaFabriquinha = (banco: DatabaseSync, versao?: number): void => {
  const migracoes = enfileirarDepoisDoHistorico(MIGRACOES_DOS_DOMINIOS);
  migrar(banco, versao === undefined ? migracoes : migracoes.slice(0, versao - VERSAO_LINHA_DE_BASE));
};
