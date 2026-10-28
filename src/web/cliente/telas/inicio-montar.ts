// Início (F7 §4.4) no DOM: lê `GET /api/inicio` e desenha com a função pura de inicio.ts. O app.ts o redesenha a cada
// 5 s e conta o que aguarda pela mesma rota. Os testes de ponta a ponta (e2e/) o exercitam.
import type { DadosDoInicio } from "../../rotas/inicio.ts";
import type { Parametros } from "../caminhos.ts";
import { api } from "../dom.ts";
import { inicio } from "./inicio.ts";

/** Quanto aguarda o Auditor: o mesmo número do Aguarda você. */
export async function contarOQueAguarda(): Promise<number> {
  return (await api<DadosDoInicio>("/api/inicio")).aguarda.length;
}

/** A página `/home`. Redesenhar preserva a rolagem horizontal do board. */
export async function montarInicio(main: HTMLElement, _params: Parametros, signal: AbortSignal): Promise<void> {
  const dados = await api<DadosDoInicio>("/api/inicio", { signal });
  const rolagem = main.querySelector(".board-etapas")?.scrollLeft ?? 0;
  main.innerHTML = inicio(dados, new Date());
  const etapas = main.querySelector(".board-etapas");
  if (etapas) etapas.scrollLeft = rolagem;
}
