// Ambientes (F7 §4.4) no DOM: lê `GET /api/ambientes` e desenha com `paginaDeAmbientes`. O app.ts a remonta a cada 5 s
// enquanto o Auditor está nela, e para ao sair; a rolagem lateral da tabela sobrevive à remontagem. Os testes de ponta a
// ponta (e2e/) a exercitam.
import type { Parametros } from "../../compartilhado/caminhos.ts";
import type { AmbientesEmUso } from "../../../system/api/contrato/ambientes.ts";
import { api } from "../../dom.ts";
import { paginaDeAmbientes } from "./ambientes.ts";

export async function montarAmbientes(main: HTMLElement, _params: Parametros, signal: AbortSignal): Promise<void> {
  const ambientesEmUso = await api<AmbientesEmUso>("/api/ambientes", { signal });
  // Lida depois da espera, para valer a rolagem que o Auditor fez enquanto a consulta ia e voltava.
  const rolagemLateralAnterior = main.querySelector("[data-rolagem-dos-ambientes]")?.scrollLeft ?? 0;
  main.innerHTML = paginaDeAmbientes(ambientesEmUso);
  const tabelaRolavel = main.querySelector("[data-rolagem-dos-ambientes]");
  if (tabelaRolavel) tabelaRolavel.scrollLeft = rolagemLateralAnterior;
}
