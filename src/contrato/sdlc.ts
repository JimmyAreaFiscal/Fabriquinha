// O contrato das rotas da configuração SDLC do projeto (comparacao-sdlc §7.1). Só tipos e schemas.
import { z } from "zod";
import { Projeto } from "../projeto/nucleo/projeto.ts";

/** `GET` e `POST /api/projetos/:nome/configuracao-sdlc`: o projeto, se já tem linguagem configurada e o cursor da base. */
export const ConfiguracaoSdlcDoProjeto = z.strictObject({
  configurada: z.boolean(),
  configuracao: Projeto,
  cursor_commit_humano: z.string().optional(),
});
export type ConfiguracaoSdlcDoProjeto = z.infer<typeof ConfiguracaoSdlcDoProjeto>;
