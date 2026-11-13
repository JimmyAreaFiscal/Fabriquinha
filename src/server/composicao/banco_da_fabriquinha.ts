// O banco da Fabriquinha com as migrações dos domínios (MELHORIAS §5.1.6): o histórico congelado do shared e, depois dele,
// as que cada domínio registra. Todo processo que abre o banco (serviço, CLI, testes) passa por aqui: quem abrisse sem as
// migrações dos domínios acharia o banco numa versão mais nova que a que conhece. Por isso é aqui também que a composição
// liga ao Ciclo de Vida o que ele lê de Demandas como dado: os projetos cadastrados (MELHORIAS §11, regra 2).
import type { DatabaseSync } from "node:sqlite";
import { abrir } from "../../shared/armazenamento/banco.ts";
import { ligarLeituraDosProjetosCadastrados } from "../../modulos/ciclo_de_vida/publico.ts";
import {
  buscarProjeto,
  carregarProjeto,
  MIGRACOES_DE_DEMANDAS,
  projetoExistente,
} from "../../modulos/demandas/publico.ts";

ligarLeituraDosProjetosCadastrados({ buscarProjeto, carregarProjeto, projetoExistente });

/** Abre o banco da `raiz` (padrão: a do serviço) e aplica as migrações pendentes, do histórico e dos domínios. */
export const abrirBancoDaFabriquinha = (raiz?: string): DatabaseSync => abrir(raiz, [MIGRACOES_DE_DEMANDAS]);
