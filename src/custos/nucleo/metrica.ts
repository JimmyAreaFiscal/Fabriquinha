// Como cada tipo de Métrica de Sucesso que as Etapas declaram (CONCEITOS.md §16) é mostrado e recortado.
import type { TipoMetrica } from "../../etapas/definicao/tipos_declaraveis.ts";

/** Como uma Métrica é mostrada: o rótulo da tela e de onde ela deriva. */
export interface DefinicaoDaMetrica {
  tipo: TipoMetrica;
  rotulo: string;
  fonte: string;
}

/** O recorte de uma Métrica: período `[inicio, fim)`, Projeto ou Demanda; cada campo presente restringe, e ausente vale tudo. */
export interface Recorte {
  inicio?: string;
  fim?: string;
  projeto?: string | null;
  demandaId?: string;
}
