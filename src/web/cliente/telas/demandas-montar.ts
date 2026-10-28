// Quadro de demandas no DOM: lê a API e desenha com `quadro`. O app.ts o redesenha a cada 5 s; não tem formulário.
// Os testes de ponta a ponta (e2e/) o exercitam no navegador.
import type { Parametros } from "../caminhos.ts";
import { api } from "../dom.ts";
import { type DadosDoQuadro, quadro } from "./demandas.ts";

export async function montarDemandas(main: HTMLElement, params: Parametros, signal: AbortSignal): Promise<void> {
  const dados = await api<DadosDoQuadro>("/api/demandas", { signal });
  const demandas =
    params.projeto === undefined ? dados.demandas : dados.demandas.filter((d) => d.projeto === params.projeto);
  main.innerHTML = quadro({ demandas, trabalho: dados.trabalho });
}
