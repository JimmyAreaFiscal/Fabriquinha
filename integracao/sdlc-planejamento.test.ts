// Seção 12 de comparacao-sdlc-implementacao.md, CA-SDLC-04 a 06 (o planejamento): reprovação e retomada da mesma sessão,
// falha ao preparar a aprovação e demandas com os mesmos números de rodada e ticket. O cenário é montado pelos serviços
// e pelo agendador, com banco e git reais numa raiz temporária e o pi falso; nada passa pela web.
import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { Ator } from "../src/dominio/agregado.ts";
import { interromperExecucaoDemanda } from "../src/execucao/execucao_demanda.ts";
import { despacharDemandas, executarAgoraDemanda } from "../src/execucao/despacho_demanda.ts";
import {
  aprovarPlanejamentoDemanda,
  reprovarPlanejamentoDemanda,
  submeterPlanejamento,
} from "../src/execucao/planejamento.ts";
import { gravarConfiguracaoProjeto } from "../src/persistencia/configuracao_projeto.ts";
import { carregarSessoesDoTicket } from "../src/persistencia/sessoes.ts";
import { base, type Cenario, criarCenario, demanda, demandaAprovada, esperar } from "./apoio.ts";
import { piFalso } from "./falsos.ts";

const pi = piFalso(base);

/** O `planejar` da demanda aprovada é o ticket 2 (o 1 é o `demanda`). */
const PLANEJAR = 2;
const agente = (execucao: number): Ator => ({ tipo: "agente", execucao, ticket: PLANEJAR });

/** Plano de `rodadas` rodadas independentes, cada uma com um ticket; o `titulo` distingue as demandas. */
const plano = (id: string, titulo: string, rodadas = 1) => ({
  demanda_id: id,
  criterios: ["CA-1"],
  rodadas: Array.from({ length: rodadas }, (_, i) => ({
    demanda_id: id,
    rodada_id: i + 1,
    titulo: `${titulo} ${String(i + 1)}`,
    e2e: false,
    criterios: ["CA-1"],
    depende: [],
  })),
  tickets: Array.from({ length: rodadas }, (_, i) => ({
    demanda_id: id,
    ticket_id: i + 1,
    rodada_id: i + 1,
    titulo: `${titulo} t${String(i + 1)}`,
    descricao: "d",
  })),
});

/**
 * Um ciclo do agendador inicia (ou retoma) o planejamento de cada demanda de `ids`; a sessão interativa fica de pé até
 * a interrupção, e o `planejar` segue em execução esperando o plano. Devolve o número da execução de cada uma.
 */
async function ciclaPlanejamentos(c: Cenario, ids: string[]): Promise<number[]> {
  const antes = pi.chamadas().length;
  const fins = despacharDemandas(c.banco, c.config);
  assert.equal(fins.length, ids.length, "o ciclo deveria iniciar só o planejamento de cada demanda");
  await esperar(() => pi.chamadas().length === antes + ids.length, "o pi receber o prompt de cada planejamento");
  for (const id of ids) interromperExecucaoDemanda(c.banco, { demanda_id: id, ticket_id: PLANEJAR });
  await Promise.all(fins);
  return ids.map((id) => carregarSessoesDoTicket(c.banco, { demanda_id: id, ticket_id: PLANEJAR }).execucoes.length);
}

const etapasEStatus = (c: Cenario, id: string) => demanda(c, id).tickets.map((t) => [t.etapa, t.status]);
const semDesenvolvimento = (c: Cenario, id: string) => {
  const ag = demanda(c, id);
  assert.deepEqual(ag.rodadas, []);
  assert.equal(
    ag.tickets.some((t) => t.etapa === "implementar"),
    false,
  );
};

test("CA-SDLC-04: planejamento reprovado e reenviado retoma a mesma sessão, sem desenvolvimento antes da aprovação", async (t) => {
  const c = criarCenario(t);
  pi.roteirizar();
  const id = demandaAprovada(c);
  const ref = { demanda_id: id, ticket_id: PLANEJAR };
  await ciclaPlanejamentos(c, [id]);
  const [sessao] = carregarSessoesDoTicket(c.banco, ref).sessoes;
  assert.equal(carregarSessoesDoTicket(c.banco, ref).sessoes.length, 1);

  // O plano vai ao gate: o agendador não despacha nada e nenhuma rodada nasce.
  submeterPlanejamento(c.banco, id, plano(id, "v1"), agente(1));
  assert.equal(demanda(c, id).demanda.fase, "aprovacao_planejamento");
  assert.equal(despacharDemandas(c.banco, c.config).length, 0);
  semDesenvolvimento(c, id);

  // Reprovado: volta a `planejamento` com o motivo, o `planejar` segue em execução e o agendador o retoma.
  reprovarPlanejamentoDemanda(c.banco, id, "faltam critérios na rodada 1");
  assert.equal(demanda(c, id).demanda.fase, "planejamento");
  assert.deepEqual(
    demanda(c, id)
      .decisoes.filter((d) => d.ticket_id === PLANEJAR)
      .map((d) => [d.resultado, d.motivo]),
    [["recusado", "faltam critérios na rodada 1"]],
  );
  semDesenvolvimento(c, id);
  assert.deepEqual(await ciclaPlanejamentos(c, [id]), [2]);

  // Mesma sessão (e conversa) retomada com o motivo; o ticket de planejamento é o mesmo, sem outro `planejar`.
  const estado = carregarSessoesDoTicket(c.banco, ref);
  assert.deepEqual(estado.sessoes, [sessao]);
  assert.deepEqual(
    estado.execucoes.map((e) => e.sessao_id),
    [sessao?.id, sessao?.id],
  );
  assert.match(pi.chamadas().at(-1)?.prompt ?? "", /Motivo: faltam critérios na rodada 1/);
  assert.equal(demanda(c, id).tickets.filter((x) => x.etapa === "planejar").length, 1);
  semDesenvolvimento(c, id);

  // Reenviado e aprovado: só agora o desenvolvimento existe.
  submeterPlanejamento(c.banco, id, plano(id, "v2"), agente(2));
  await aprovarPlanejamentoDemanda(c.banco, id, {});
  const ag = demanda(c, id);
  assert.equal(ag.demanda.fase, "execucao");
  assert.deepEqual(
    ag.rodadas.map((r) => [r.rodada_id, r.titulo, r.fase]),
    [[1, "v2 1", "desenvolvimento"]],
  );
  assert.deepEqual(etapasEStatus(c, id), [
    ["demanda", "concluido"],
    ["planejar", "concluido"],
    ["implementar", "aberto"],
  ]);
});

test("CA-SDLC-05: falha ao preparar a aprovação do planejamento deixa o gate aberto, sem aprovação nem execução de rodada", async (t) => {
  const c = criarCenario(t);
  pi.roteirizar();
  const id = demandaAprovada(c);
  // A preparação só falha na worktree da rodada 2, depois da demanda e da rodada 1.
  const quebra = join(c.raiz, "quebra");
  const { banco, projeto, repo } = c;
  gravarConfiguracaoProjeto(banco, {
    nome: projeto,
    branch_base: "main",
    chave_sonarqube: `chave-${projeto}`,
    raiz_git: repo,
    hospedagem: "github",
    etapas: [],
    preparacao: [{ ordem: 1, comando: `[ -e ${quebra} ] && [ "$(basename "$PWD")" = 2 ] && exit 1; true` }],
    fitness: [{ nome: "f", comando: "true", descricao: "d" }],
    linguagens: [{ caminho: ".", linguagem: "ts", comando_teste: "true" }],
  });
  await ciclaPlanejamentos(c, [id]);
  submeterPlanejamento(banco, id, plano(id, "r", 2), agente(1));
  writeFileSync(quebra, "");
  const chamadas = pi.chamadas().length;

  await assert.rejects(aprovarPlanejamentoDemanda(banco, id, { nota: 4 }), /a preparação da worktree falhou/);
  const ag = demanda(c, id);
  assert.equal(ag.demanda.fase, "aprovacao_planejamento");
  assert.deepEqual(ag.rodadas, []);
  assert.deepEqual(etapasEStatus(c, id), [
    ["demanda", "concluido"],
    ["planejar", "em_execucao"],
  ]);
  assert.equal(
    ag.decisoes.some((d) => d.ticket_id === PLANEJAR),
    false,
  );
  assert.match(
    readFileSync(join(c.raiz, "execucoes", `planejamento-${id}.log`), "utf8"),
    /preparação falhou em .*rodadas\/2/,
  );
  // Nenhuma execução de rodada: o agendador não tem o que despachar e o pi não recebe mais nada.
  assert.equal(despacharDemandas(banco, c.config).length, 0);
  assert.equal(pi.chamadas().length, chamadas);

  // Corrigida a causa, a mesma aprovação conclui.
  rmSync(quebra);
  await aprovarPlanejamentoDemanda(banco, id, { nota: 4 });
  assert.deepEqual(
    demanda(c, id).rodadas.map((r) => [r.rodada_id, r.fase]),
    [
      [1, "desenvolvimento"],
      [2, "desenvolvimento"],
    ],
  );
});

test("CA-SDLC-06: duas demandas com rodada_id 1 e ticket_id 1 não cruzam leitura, escrita, decisão e evidência; FKs recusam referências inválidas", async (t) => {
  const c = criarCenario(t);
  pi.roteirizar();
  const a = demandaAprovada(c);
  const b = demandaAprovada(c);
  assert.deepEqual(await ciclaPlanejamentos(c, [a, b]), [1, 1]);

  // A é reprovada uma vez e reenviada (decisão só dela); B, no gate, não é tocada pelo ciclo que retoma A.
  submeterPlanejamento(c.banco, a, plano(a, "A-v1"), agente(1));
  submeterPlanejamento(c.banco, b, plano(b, "B"), agente(2));
  reprovarPlanejamentoDemanda(c.banco, a, "refaça");
  assert.deepEqual(await ciclaPlanejamentos(c, [a]), [2]);
  submeterPlanejamento(c.banco, a, plano(a, "A"), agente(3));
  await aprovarPlanejamentoDemanda(c.banco, b, {});
  await aprovarPlanejamentoDemanda(c.banco, a, {});

  // Leitura: o mesmo (rodada 1, ticket 1) em cada demanda, com o conteúdo da própria.
  const dono = (id: string) => {
    const ag = demanda(c, id);
    for (const x of [...ag.rodadas, ...ag.tickets, ...ag.decisoes, ...ag.evidencias]) assert.equal(x.demanda_id, id);
    return ag;
  };
  for (const [id, titulo] of [
    [a, "A 1"],
    [b, "B 1"],
  ] as const) {
    const ag = dono(id);
    assert.deepEqual(
      ag.rodadas.map((r) => [r.rodada_id, r.titulo]),
      [[1, titulo]],
    );
    assert.equal(ag.tickets[0]?.ticket_id, 1);
    assert.equal(ag.tickets.find((x) => x.etapa === "implementar")?.titulo, `${titulo.slice(0, -2)} t1`);
  }
  // Decisão: a recusa do planejamento de A não aparece em B; cada uma numera as suas a partir de 1.
  const recusas = (id: string) => dono(id).decisoes.filter((d) => d.resultado === "recusado").length;
  assert.deepEqual([recusas(a), recusas(b)], [1, 0]);
  assert.deepEqual(
    [a, b].map((id) => Math.min(...dono(id).decisoes.map((d) => d.decisao_id))),
    [1, 1],
  );
  // Evidência: cada plano é da própria demanda e do próprio `planejar`.
  const planos = (id: string) =>
    dono(id)
      .evidencias.filter((e) => e.tipo === "plano")
      .map((e) => (e.dados as { rodadas: { titulo: string }[] }).rodadas[0]?.titulo);
  assert.deepEqual([planos(a), planos(b)], [["A 1"], ["B 1"]]);

  // Escrita: falhar o implementar de A (rodada 1) não toca em nada de B.
  const antesB = demanda(c, b);
  const tA = dono(a).tickets.find((x) => x.etapa === "implementar");
  pi.roteirizar([{ modo: "erro" }]);
  await executarAgoraDemanda(c.banco, { demanda_id: a, ticket_id: tA?.ticket_id ?? 0 }, c.config);
  assert.equal(dono(a).tickets.find((x) => x.ticket_id === tA?.ticket_id)?.status, "falhou");
  assert.deepEqual(demanda(c, b), antesB);
  assert.equal(dono(b).tickets.find((x) => x.etapa === "implementar")?.status, "aberto");

  // FKs: referência a demanda, rodada ou ticket que a demanda não tem é recusada pelo banco.
  const agora = "2026-01-01T00:00:00.000Z";
  const recusa = (sql: string, ...args: (string | number)[]) => {
    assert.throws(() => c.banco.prepare(sql).run(...args), /FOREIGN KEY/);
  };
  recusa(
    "INSERT INTO rodada (demanda_id, rodada_id, titulo, fase, e2e, branch) VALUES (?, 1, 'x', 'desenvolvimento', 0, 'b')",
    "I-999",
  );
  recusa(
    "INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, status, status_alterado_em, rodada_id) VALUES (?, 99, 'implementar', 'aberto', ?, 7)",
    a,
    agora,
  );
  recusa(
    "INSERT INTO decisao_ticket (demanda_id, ticket_id, decisao_id, resultado, por, em) VALUES (?, 99, 1, 'aprovado', 'auditor', ?)",
    b,
    agora,
  );
  recusa(
    "INSERT INTO evidencia_demanda (id, demanda_id, ticket_id, tipo, dados, em) VALUES ('x', ?, 99, 'plano', '{}', ?)",
    a,
    agora,
  );
  recusa(
    "INSERT INTO evidencia_demanda (id, demanda_id, rodada_id, tipo, dados, em) VALUES ('y', ?, 5, 'plano', '{}', ?)",
    b,
    agora,
  );
});

test("o planejador recebe o desenho aprovado da demanda, com o HTML anexo num arquivo que ele consegue ler", async (t) => {
  const c = criarCenario(t);
  pi.roteirizar();
  const id = demandaAprovada(c);
  await ciclaPlanejamentos(c, [id]);
  const prompt = pi.chamadas()[0]?.prompt ?? "";
  assert.match(prompt, /## Desenho aprovado[\s\S]*\nr\n[\s\S]*- `src\/a\.ts` \(criar\): porque/);
  const [, html] = /- `d\.html`: `([^`]+)`/.exec(prompt) ?? [];
  assert.equal(readFileSync(html ?? "", "utf8"), "<p>x</p>");
});
