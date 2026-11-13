// A consulta da configuração SDLC do projeto (comparacao-sdlc §7.1): monta o contrato da resposta num snapshot só.
import type { DatabaseSync } from "node:sqlite";
import { cursorDaBase } from "../../../modulos/repositorio/armazenamento/commits_humanos.ts";
import { lerEmSnapshot } from "../../../modulos/compartilhado/armazenamento/snapshot.ts";
import type { ConfiguracaoSdlcDoProjeto } from "../../contrato/sdlc.ts";
import { projetoExistente } from "../../../modulos/demandas/publico.ts";

/** A configuração SDLC do projeto `nome`; `configurada` quando ele já tem linguagem, e o cursor só depois da 1ª varredura. */
export function consultarConfiguracaoSdlc(banco: DatabaseSync, nome: string): ConfiguracaoSdlcDoProjeto {
  return lerEmSnapshot(banco, () => {
    const configuracao = projetoExistente(banco, nome);
    const cursor = cursorDaBase(banco, nome);
    const comCursor = cursor === undefined ? {} : { cursor_commit_humano: cursor };
    return { configurada: configuracao.verificacoes.linguagens.length > 0, configuracao, ...comCursor };
  });
}
