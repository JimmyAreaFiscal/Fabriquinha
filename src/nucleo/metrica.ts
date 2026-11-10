// Os tipos de Métrica de Sucesso que as Etapas declaram (CONCEITOS.md §16).
export type TipoMetrica =
  | "uso"
  | "aprovacoes_e_reprovacoes"
  | "conformidade_com_o_plano"
  | "alteracoes_posteriores"
  | "exigencias_de_alteracao"
  | "bugs_nos_arquivos_revisados"
  | "nota_humana";

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
