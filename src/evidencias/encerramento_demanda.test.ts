import assert from "node:assert/strict";
import { test } from "node:test";
import { AgregadoDemanda } from "../dominio/agregado_demanda.ts";
import type { ExecucaoSessao, Sessao, UsoModeloExecucao } from "../dominio/sessoes.ts";
import {
  corpoDoPRFinal,
  marcaDoPRFinal,
  montarArvorePRs,
  montarDemonstracaoLimpeza,
  tituloDoPRFinal,
} from "./encerramento_demanda.ts";

const em = "2026-01-01T10:00:00Z";
const ticket = (ticket_id: number, etapa: string, rodada_id?: number) => ({
  demanda_id: "I-206",
  ticket_id,
  etapa,
  status: "concluido",
  status_alterado_em: em,
  ...(rodada_id === undefined ? {} : { rodada_id }),
});
const linhas = (...custos: (number | null)[]) =>
  custos.map((custo) => ({
    provedor: "p",
    modelo: "m",
    tokens_entrada: 1,
    tokens_saida: 1,
    tokens_cache_leitura: 0,
    tokens_cache_escrita: 0,
    custo,
  }));
const agregado = (tipo = "funcionalidade", comEncerramento = true) =>
  AgregadoDemanda.parse({
    demanda: {
      id: "I-206",
      projeto: "p",
      titulo: "Encerrar",
      tipo,
      descricao: "Descrição.",
      fase: "encerramento",
      fase_alterada_em: em,
      origem_ferramenta: "x",
      origem_sessao: "y",
      enviada: true,
      branch: "fabriquinha/I-206",
    },
    tickets: [
      ticket(1, "planejar"),
      ticket(3, "implementar", 2),
      ticket(7, "encerrar_rodada", 2),
      ticket(8, "implementar", 3),
    ],
    rodadas: [2, 3].map((rodada_id) => ({
      demanda_id: "I-206",
      rodada_id,
      titulo: `R${String(rodada_id)}`,
      fase: "concluida",
      e2e: false,
      branch: `fabriquinha/I-206-${String(rodada_id)}`,
    })),
    criterios_citados: [{ demanda_id: "I-206", rodada_id: 2, criterio_id: "CA-1" }],
    decisoes: [],
    evidencias: [
      { demanda_id: "I-206", ticket_id: 7, tipo: "pr_aberto", dados: { id: "41", url: "http://pr/41" }, em },
      {
        demanda_id: "I-206",
        tipo: "custos_realizados",
        dados: {
          sessoes: [
            { ferramenta: "claude", sessao: "a", linhas: linhas(1, 2) },
            { ferramenta: "codex", sessao: "b", linhas: linhas(4, null) },
          ],
        },
        em,
      },
    ],
    ...(comEncerramento
      ? {
          encerramento: {
            demanda_id: "I-206",
            branch: "fabriquinha/I-206",
            base: "develop",
            pr: { numero: 50, url: "http://pr/50" },
            integracao: { sha: "abc123" },
            limpeza_pendente: [],
          },
        }
      : {}),
  });
const sessao = (n: number): Sessao => ({
  id: `s${String(n)}`,
  demanda_id: "I-206",
  ticket_id: n,
  modo: "autonomo",
  conversa_referencia: "c",
});
const exec = (n: number): ExecucaoSessao => ({
  id: `e${String(n)}`,
  sessao_id: `s${String(n)}`,
  inicio: em,
  falha: false,
});
const uso = (n: number, custo?: number): UsoModeloExecucao => ({
  execucao_id: `e${String(n)}`,
  modelo_provedor: "p",
  modelo_nome: "m",
  tokens_entrada: 1,
  tokens_saida: 1,
  tokens_cache_leitura: 0,
  tokens_cache_escrita: 0,
  ...(custo === undefined ? {} : { custo }),
});

test("árvore: PR final, SHA, PR e critérios por rodada", () => {
  const a = montarArvorePRs(agregado(), [], [], []);
  assert.deepEqual(a.pr_final, { numero: 50, url: "http://pr/50" });
  assert.equal(a.base, "develop");
  assert.equal(a.sha_integracao, "abc123");
  assert.deepEqual(a.rodadas[0]?.pr, { id: "41", url: "http://pr/41" });
  assert.deepEqual(a.rodadas[0].criterios, ["CA-1"]);
  assert.equal(a.rodadas[1]?.pr, null);
  assert.equal(a.tickets_sem_rodada[0]?.ticket, "I-206.T1");
});

test("árvore sem encerramento gravado usa nulos", () => {
  const a = montarArvorePRs(agregado("problema", false), [], [], []);
  assert.deepEqual([a.pr_final, a.sha_integracao, a.base], [null, null, null]);
});

test("custo conhecido x incompleto, externos separados dos internos", () => {
  const a = montarArvorePRs(agregado(), [sessao(3), sessao(8)], [exec(3), exec(8)], [uso(3, 1.5), uso(8)]);
  assert.deepEqual(a.rodadas[0]?.tickets[0]?.custo, { valor: 1.5, situacao: "conhecido" });
  assert.deepEqual(a.rodadas[1]?.tickets[0]?.custo, { valor: 0, situacao: "incompleto" });
  // T7 e T1 sem nenhum uso: incompletos, nunca zero conhecido.
  assert.equal(a.rodadas[0].tickets[1]?.custo.situacao, "incompleto");
  assert.deepEqual(a.custos.internos, { valor: 1.5, situacao: "incompleto" });
  assert.deepEqual(
    a.custos.externos.sessoes.map((s) => s.custo),
    [
      { valor: 3, situacao: "conhecido" },
      { valor: 4, situacao: "incompleto" },
    ],
  );
  assert.deepEqual(a.custos.externos.total, { valor: 7, situacao: "incompleto" });
});

test("ticket com todo uso medido é conhecido", () => {
  const a = montarArvorePRs(agregado(), [sessao(3)], [exec(3)], [uso(3, 2)]);
  assert.deepEqual(a.rodadas[0]?.tickets[0]?.custo, { valor: 2, situacao: "conhecido" });
});

test("limpeza: sobras reprovam e removidas aprovam", () => {
  const ok = montarDemonstracaoLimpeza(["worktree:/a/b", "branch_local:x", "branch_remota:x"], []);
  assert.equal(ok.aprovada, true);
  assert.deepEqual(ok.removidas[0], { tipo: "worktree", alvo: "/a/b" });
  const ruim = montarDemonstracaoLimpeza([], ["branch_remota:x"]);
  assert.equal(ruim.aprovada, false);
  assert.deepEqual(ruim.sobras, [{ tipo: "branch_remota", alvo: "x" }]);
});

test("título, marca e corpo do PR final", () => {
  assert.equal(tituloDoPRFinal(agregado()), "feat: Encerrar [I-206]");
  assert.equal(tituloDoPRFinal(agregado("problema")), "fix: Encerrar [I-206]");
  assert.equal(marcaDoPRFinal("I-206"), "<!-- fabriquinha I-206 -->");
  const corpo = corpoDoPRFinal(agregado());
  assert.ok(corpo.startsWith("<!-- fabriquinha I-206 -->"));
  assert.ok(corpo.includes("- I-206.R2: R2 (http://pr/41)"));
  assert.ok(corpo.includes("- I-206.R3: R3\n"));
  assert.ok(corpoDoPRFinal({ ...agregado(), rodadas: [] }).includes("Nenhuma."));
});
