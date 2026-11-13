import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { hospedagemFalsa } from "../../../../../apoio-testes/hospedagem_falsa.ts";
import type { Hospedagem, OpcoesVerificacao } from "../../../repositorio/publico.ts";
import { ConferenciaDoPR } from "./conferencia_do_pr.ts";

const base = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-conferencia-pr-")));
after(() => {
  rmSync(base, { recursive: true, force: true });
});
// A credencial do serviço, que os comandos de PR precisam ver (F5 §5.0).
process.env.GH_TOKEN = "token-do-servico";

const hospedagem = hospedagemFalsa(base);
beforeEach(() => {
  hospedagem.zerar();
});

const RAPIDO: OpcoesVerificacao = { intervaloMs: 10, carenciaMs: 0 };
const log = join(base, "log");

/** Confere um PR aberto na hospedagem falsa. */
function conferencia(tipo: Hospedagem, pr: Partial<Parameters<typeof hospedagem.abrirPr>[0]>, opcoes = RAPIDO) {
  hospedagem.abrirPr({ head: "fabriquinha/I-1", base: "main", titulo: "t", corpo: "", estado: "aberto", ...pr });
  return new ConferenciaDoPR({ raiz_git: base, hospedagem: tipo }, "1", log, opcoes);
}

for (const tipo of ["github", "azure-devops"] as const) {
  test(`${tipo}: o PR sem conflito e com a CI passando passa, sem Evidência`, async () => {
    const verificacao = conferencia(tipo, { checks: [{ nome: "ci", estado: "aprovado" }] });

    assert.equal(verificacao.tipo, "conferencia_do_pr");
    assert.deepEqual(await verificacao.executar(), { tipo: "passou" });
  });

  test(`${tipo}: o conflito e o check falho reprovam, com o nome do check`, async () => {
    assert.deepEqual(await conferencia(tipo, { conflito: true }).executar(), {
      tipo: "reprovacao",
      motivo: "o PR 1 conflita com a base",
      log: "",
    });
    hospedagem.zerar();
    const reprovada = await conferencia(tipo, { checks: [{ nome: "build", estado: "falho" }] }).executar();
    assert.equal(reprovada.tipo, "reprovacao");
    assert.match((reprovada as { motivo: string }).motivo, /^check build( \S+)? falhou$/);
  });

  test(`${tipo}: o limite de 0 com check em andamento é falha de infraestrutura`, async () => {
    const verificacao = conferencia(
      tipo,
      { checks: [{ nome: "build", estado: "andamento" }] },
      { ...RAPIDO, limiteMs: 0 },
    );

    const resultado = await verificacao.executar();
    assert.equal(resultado.tipo, "falha_infraestrutura");
    assert.match((resultado as { motivo: string }).motivo, /ainda espera os checks em andamento: build/);
  });
}

test("o erro que não é da hospedagem propaga", async () => {
  const verificacao = new ConferenciaDoPR({ raiz_git: join(base, "inexistente"), hospedagem: "github" }, "1", log);

  await assert.rejects(verificacao.executar(), /ENOENT/);
});
