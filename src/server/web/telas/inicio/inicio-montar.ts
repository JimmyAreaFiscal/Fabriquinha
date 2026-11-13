// Início (F7 §4.4) no DOM: lê `GET /api/inicio` e `GET /api/despacho` (os itens parados) e desenha com a função pura de
// inicio.ts. O app.ts o redesenha a cada 5 s e, nesta página, mostra no menu quanto aguarda pela mesma resposta, sem pedir
// o contador. Os testes de ponta a ponta (e2e/) o exercitam.
import type { DadosDoInicio } from "../../../contrato/inicio.ts";
import { agoraNoNavegador } from "../../compartilhado/agora_no_navegador.ts";
import type { Parametros } from "../../compartilhado/caminhos.ts";
import { api } from "../../dom.ts";
import type { RecusasDoDespacho } from "../../../contrato/despacho.ts";
import { inicio } from "./inicio.ts";

/**
 * A página `/home`. Redesenhar preserva a rolagem horizontal do board. Devolve quanto aguarda o Auditor (o tamanho do
 * Aguarda você), para o menu não pedir de novo.
 */
export async function montarInicio(main: HTMLElement, _params: Parametros, signal: AbortSignal): Promise<number> {
  const [dados, { recusas }] = await Promise.all([
    api<DadosDoInicio>("/api/inicio", { signal }),
    api<RecusasDoDespacho>("/api/despacho", { signal }),
  ]);
  const rolagem = main.querySelector(".board-etapas")?.scrollLeft ?? 0;
  main.innerHTML = inicio(dados, agoraNoNavegador(), recusas);
  const etapas = main.querySelector(".board-etapas");
  if (etapas) etapas.scrollLeft = rolagem;
  return dados.aguarda.length;
}
