// O banco da Fabriquinha com as migrações dos domínios (MELHORIAS §5.1.6): o histórico congelado do shared e, depois dele,
// as que cada domínio registra. Todo processo que abre o banco (serviço, CLI, testes) passa por aqui: quem abrisse sem as
// migrações dos domínios acharia o banco numa versão mais nova que a que conhece.
import type { DatabaseSync } from "node:sqlite";
import { abrir } from "../../shared/armazenamento/banco.ts";
import { MIGRACOES_DE_DEMANDAS } from "../../modulos/demandas/publico.ts";

/** Abre o banco da `raiz` (padrão: a do serviço) e aplica as migrações pendentes, do histórico e dos domínios. */
export const abrirBancoDaFabriquinha = (raiz?: string): DatabaseSync => abrir(raiz, [MIGRACOES_DE_DEMANDAS]);
