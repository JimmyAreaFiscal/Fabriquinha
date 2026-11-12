// Como cada Métrica é mostrada e recortada: as de Sucesso que as Etapas declaram (CONCEITOS.md §16) e as do SDLC inteiro.
import type { TipoMetrica } from "../../etapas/definicao/tipos_declaraveis.ts";

/** Como uma Métrica é mostrada: o rótulo da tela e de onde ela deriva; o tipo da de uma Etapa é o que a Etapa declara. */
export interface DefinicaoDaMetrica<Tipo extends string = TipoMetrica> {
  tipo: Tipo;
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
