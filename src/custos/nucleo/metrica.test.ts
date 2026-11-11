import assert from "node:assert/strict";
import { test } from "node:test";
import { CATALOGO_DE_ETAPAS } from "../../fluxo/nucleo/etapa.ts";
import type { TipoMetrica } from "./metrica.ts";
import type { EtapaTicket } from "../../compartilhado/nucleo/primitivos.ts";

// A tabela Etapa × Métricas do CONCEITOS.md §16: "Todas" vale para as 9 Etapas e
// "Revisar rodada/demanda" vale para as duas.
const TABELA_DO_CONCEITOS: Record<EtapaTicket, TipoMetrica[]> = {
  entender_e_desenhar: ["uso", "aprovacoes_e_reprovacoes"],
  planejar: ["uso", "conformidade_com_o_plano"],
  implementar: ["uso", "alteracoes_posteriores"],
  revisar_rodada: ["uso", "exigencias_de_alteracao", "bugs_nos_arquivos_revisados"],
  encerrar_rodada: ["uso", "nota_humana"],
  ajustar_resultado: ["uso"],
  revisar_demanda: ["uso", "exigencias_de_alteracao", "bugs_nos_arquivos_revisados"],
  encerrar_demanda: ["uso"],
  resolver_conflito: ["uso"],
};

test("cada Etapa do catálogo declara exatamente as Métricas da tabela do CONCEITOS.md §16", () => {
  assert.deepEqual(Object.keys(CATALOGO_DE_ETAPAS).sort(), Object.keys(TABELA_DO_CONCEITOS).sort());
  for (const [etapa, metricas] of Object.entries(TABELA_DO_CONCEITOS)) {
    assert.deepEqual(
      [...CATALOGO_DE_ETAPAS[etapa as EtapaTicket].metricas].sort(),
      [...metricas].sort(),
      `métricas da etapa ${etapa}`,
    );
  }
});
