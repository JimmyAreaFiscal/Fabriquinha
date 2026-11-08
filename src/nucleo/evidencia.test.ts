import assert from "node:assert/strict";
import { test } from "node:test";
import { SCHEMA_DA_EVIDENCIA, schemaDoTipo, TipoEvidencia } from "./evidencia.ts";
import { CATALOGO_ETAPAS } from "./evidencia_etapa.ts";

test("todo tipo tem entrada em SCHEMA_DA_EVIDENCIA, inclusive os que n\u00e3o tinham schema", () => {
  for (const tipo of TipoEvidencia.options) {
    const schema = SCHEMA_DA_EVIDENCIA[tipo];
    assert.ok(schema.dados, `${tipo} sem schema de dados`);
    assert.ok(schema.arquivos, `${tipo} sem regra de anexos`);
    assert.equal(schemaDoTipo(tipo), schema);
  }
  assert.deepEqual(Object.keys(SCHEMA_DA_EVIDENCIA).toSorted(), TipoEvidencia.options.toSorted());
  assert.ok(TipoEvidencia.options.includes("arvore_prs_criterios_custos"));
  assert.ok(TipoEvidencia.options.includes("demonstracao_limpeza"));
});

test("todo tipo do cat\u00e1logo das etapas \u00e9 um TipoEvidencia", () => {
  for (const { tipo } of CATALOGO_ETAPAS) assert.ok(TipoEvidencia.safeParse(tipo).success, tipo);
});

const comando = { comando: "npm test", codigoSaida: 0, estourou: false, duracaoMs: 1, log: "testes.log" };
const veredito = (tipo: TipoEvidencia, dados: Record<string, unknown>) => schemaDoTipo(tipo).veredito?.(dados);

test("execucao_testes: atende se todo comando saiu com 0", () => {
  assert.equal(veredito("execucao_testes", { comandos: [comando, comando] }), "atende");
  assert.equal(veredito("execucao_testes", { comandos: [comando, { ...comando, codigoSaida: 1 }] }), "nao_atende");
});

test("relatorio_sonar: atende se nenhuma issue est\u00e1 aberta", () => {
  const issue = { arquivo: "a.ts", regra: "x:S1", severidade: "MAJOR", mensagem: "m" };
  assert.equal(veredito("relatorio_sonar", { issues: [] }), "atende");
  assert.equal(veredito("relatorio_sonar", { issues: [issue] }), "nao_atende");
});

test("demonstracao_limpeza: atende se nada sobrou", () => {
  const sobra = { tipo: "branch_remota", alvo: "x" };
  assert.equal(veredito("demonstracao_limpeza", { removidas: [sobra], sobras: [] }), "atende");
  assert.equal(veredito("demonstracao_limpeza", { removidas: [], sobras: [sobra] }), "nao_atende");
});

test("os tipos sem resultado bin\u00e1rio n\u00e3o t\u00eam veredito", () => {
  assert.equal(veredito("arvore_prs_criterios_custos", {}), undefined);
  assert.equal(veredito("pr_aberto", {}), undefined);
});
