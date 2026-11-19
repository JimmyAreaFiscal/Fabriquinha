// Seção 12 de comparacao-sdlc-implementacao.md, CA-SDLC-04 a 06 (o planejamento): reprovação e retomada da mesma sessão,
// falha ao preparar a aprovação e demandas com os mesmos números de rodada e ticket; e a aprovação que reusa as
// dependências do Ambiente pronto (I-313 CA-4). O cenário é montado pelos serviços
// e pelo agendador, com banco e git reais numa raiz temporária e o pi falso; nada passa pela web.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { DatabaseSync } from "node:sqlite";
import {
  AUDITOR,
  type Ator,
  Endereco,
  decidirGate,
  esperarPreparacoesDaAprovacao,
  despachoDasEtapas,
  interromperExecucaoDemanda,
  cicloDoDespacho,
  executarAgora,
} from "../../apoio-testes/ciclo_de_vida/ciclo_de_vida_internos.ts";
import { Projeto } from "../../src/modulos/demandas/publico.ts";
import { base, type Cenario, criarCenario, demanda, demandaAprovada, esperar, proporPlanoDoAgente } from "../apoio.ts";
import { instalarPiFalso } from "../../apoio-testes/falsos/pi_falso.ts";
import { montarDemandasDoBanco } from "../../src/server/system/banco_da_fabriquinha.ts";
import { gravarProjeto } from "../../apoio-testes/demandas_de_teste.ts";
import {
  AmbienteComDependencias,
  gestaoQueSoUsa,
  ligarGestaoDeAmbientesNosModulos,
  modulosDoCicloDeTeste,
} from "../../apoio-testes/falsos/ambiente_falso.ts";
import { carregarSessoesDoContexto } from "../../apoio-testes/sessoes_de_teste.ts";
import { liberacaoDasDemandas } from "../../apoio-testes/ciclo_de_vida/ciclo_de_vida_de_teste.ts";

const pi = instalarPiFalso(base);

const decidirPlanejamento = async (banco: DatabaseSync, id: string, entrada: object) => {
  const decidido = await decidirGate(
    modulosDoCicloDeTeste(banco),
    "gate_planejamento",
    Endereco.daDemanda(id),
    entrada,
    AUDITOR,
  );
  await esperarPreparacoesDaAprovacao();
  return decidido;
};

/** O `planejar` da demanda aprovada é o ticket 2 (o 1 é o `demanda`). */
const PLANEJAR = 2;
const agente = (execucao: number): Ator => ({ tipo: "agente", trabalho_id: `execucao-${String(execucao)}` });

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
  const antes = pi.prompts().length;
  const fins = cicloDoDespacho(
    modulosDoCicloDeTeste(c.banco),
    c.config,
    despachoDasEtapas(),
    liberacaoDasDemandas(c.banco),
  );
  assert.equal(fins.length, ids.length, "o ciclo deveria iniciar só o planejamento de cada demanda");
  await esperar(() => pi.prompts().length === antes + ids.length, "o pi receber o prompt de cada planejamento");
  for (const id of ids)
    interromperExecucaoDemanda(modulosDoCicloDeTeste(c.banco), { demanda_id: id, ticket_id: PLANEJAR });
  await Promise.all(fins);
  return ids.map((id) => carregarSessoesDoContexto(c.banco, { demanda_id: id, ticket_id: PLANEJAR }).execucoes.length);
}

const etapasEStatus = (c: Cenario, id: string) => demanda(c, id).tickets.map((t) => [t.etapa, t.estado]);
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
  const id = await demandaAprovada(c);
  const ref = { demanda_id: id, ticket_id: PLANEJAR };
  await ciclaPlanejamentos(c, [id]);
  const [sessao] = carregarSessoesDoContexto(c.banco, ref).sessoes;
  assert.equal(carregarSessoesDoContexto(c.banco, ref).sessoes.length, 1);

  // O plano vai ao gate: o agendador não despacha nada e nenhuma rodada nasce.
  proporPlanoDoAgente(c.banco, id, plano(id, "v1"), agente(1));
  assert.equal(demanda(c, id).demanda.estado, "gate_planejamento");
  assert.equal(
    cicloDoDespacho(modulosDoCicloDeTeste(c.banco), c.config, despachoDasEtapas(), liberacaoDasDemandas(c.banco))
      .length,
    0,
  );
  semDesenvolvimento(c, id);

  // Reprovado: volta a `planejar` com o motivo, o `planejar` segue em execução e o agendador o retoma.
  await decidirPlanejamento(c.banco, id, { resultado: "reprovado", motivo: "faltam critérios na rodada 1" });
  assert.equal(demanda(c, id).demanda.estado, "planejar");
  assert.deepEqual(
    demanda(c, id)
      .decisoes.filter((d) => d.ticket_id === PLANEJAR)
      .map((d) => [d.resultado, d.motivo]),
    [["reprovado", "faltam critérios na rodada 1"]],
  );
  semDesenvolvimento(c, id);
  assert.deepEqual(await ciclaPlanejamentos(c, [id]), [2]);

  // Mesma sessão (e conversa) retomada com o motivo; o ticket de planejamento é o mesmo, sem outro `planejar`.
  const estado = carregarSessoesDoContexto(c.banco, ref);
  assert.deepEqual(estado.sessoes, [sessao]);
  assert.deepEqual(
    estado.execucoes.map((e) => e.trabalho_id),
    [sessao?.id, sessao?.id],
  );
  assert.match(pi.prompts().at(-1)?.prompt ?? "", /Motivo: faltam critérios na rodada 1/);
  assert.equal(demanda(c, id).tickets.filter((x) => x.etapa === "planejar").length, 1);
  semDesenvolvimento(c, id);

  // Reenviado e aprovado: só agora o desenvolvimento existe.
  proporPlanoDoAgente(c.banco, id, plano(id, "v2"), agente(2));
  await decidirPlanejamento(c.banco, id, { resultado: "aprovado" });
  const ag = demanda(c, id);
  assert.equal(ag.demanda.estado, "em_execucao");
  assert.deepEqual(
    ag.rodadas.map((r) => [r.rodada_id, r.titulo, r.estado]),
    [[1, "v2 1", "implementar"]],
  );
  assert.deepEqual(etapasEStatus(c, id), [
    ["entender_e_desenhar", "concluido"],
    ["planejar", "concluido"],
    ["implementar", "aberto"],
  ]);
});

test("CA-SDLC-05: falha ao preparar a worktree de uma rodada na aprovação do planejamento vai ao log e não desfaz a aprovação", async (t) => {
  const c = criarCenario(t);
  pi.roteirizar();
  const id = await demandaAprovada(c);
  // A preparação só falha na worktree da rodada 2, depois da demanda e da rodada 1.
  const quebra = join(c.raiz, "quebra");
  const { banco, projeto } = c;
  const projetoDoCenario = montarDemandasDoBanco(banco).projeto(projeto);
  gravarProjeto(
    banco,
    Projeto.parse({
      ...projetoDoCenario,
      verificacoes: {
        ...projetoDoCenario.verificacoes,
        preparacao: [`[ -e ${quebra} ] && [ "$(basename "$PWD")" = 2 ] && exit 1; true`],
      },
    }),
  );
  await ciclaPlanejamentos(c, [id]);
  proporPlanoDoAgente(banco, id, plano(id, "r", 2), agente(1));
  writeFileSync(quebra, "");

  await decidirPlanejamento(banco, id, { resultado: "aprovado", nota: 4 });
  assert.deepEqual(
    demanda(c, id).rodadas.map((r) => [r.rodada_id, r.estado]),
    [
      [1, "implementar"],
      [2, "implementar"],
    ],
  );
  assert.match(
    readFileSync(join(c.raiz, "execucoes", `planejamento-${id}.log`), "utf8"),
    /preparação falhou em .*rodadas\/2/,
  );
});

test("CA-SDLC-06: duas demandas com rodada_id 1 e ticket_id 1 não cruzam leitura, escrita, decisão e evidência; FKs rejeitam referências inválidas", async (t) => {
  const c = criarCenario(t);
  pi.roteirizar();
  const a = await demandaAprovada(c);
  const b = await demandaAprovada(c);
  assert.deepEqual(await ciclaPlanejamentos(c, [a, b]), [1, 1]);

  // A é reprovada uma vez e reenviada (decisão só dela); B, no gate, não é tocada pelo ciclo que retoma A.
  proporPlanoDoAgente(c.banco, a, plano(a, "A-v1"), agente(1));
  proporPlanoDoAgente(c.banco, b, plano(b, "B"), agente(2));
  await decidirPlanejamento(c.banco, a, { resultado: "reprovado", motivo: "refaça" });
  assert.deepEqual(await ciclaPlanejamentos(c, [a]), [2]);
  proporPlanoDoAgente(c.banco, a, plano(a, "A"), agente(3));
  await decidirPlanejamento(c.banco, b, { resultado: "aprovado" });
  await decidirPlanejamento(c.banco, a, { resultado: "aprovado" });

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
  // Decisão: a reprovação do planejamento de A não aparece em B; cada uma numera as suas a partir de 1.
  const reprovacoes = (id: string) => dono(id).decisoes.filter((d) => d.resultado === "reprovado").length;
  assert.deepEqual([reprovacoes(a), reprovacoes(b)], [1, 0]);
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
  pi.roteirizar([{ sai: { codigo: 1, stderr: "falha do pi falso" } }]);
  await executarAgora(
    modulosDoCicloDeTeste(c.banco),
    { demanda_id: a, ticket_id: tA?.ticket_id ?? 0 },
    c.config,
    despachoDasEtapas(),
    liberacaoDasDemandas(c.banco),
  );
  assert.equal(dono(a).tickets.find((x) => x.ticket_id === tA?.ticket_id)?.estado, "falhou");
  assert.deepEqual(demanda(c, b), antesB);
  assert.equal(dono(b).tickets.find((x) => x.etapa === "implementar")?.estado, "aberto");

  // FKs: referência a demanda, rodada ou ticket que a demanda não tem é rejeitada pelo banco.
  const agora = "2026-01-01T00:00:00.000Z";
  const recusa = (sql: string, ...args: (string | number)[]) => {
    assert.throws(() => c.banco.prepare(sql).run(...args), /FOREIGN KEY/);
  };
  recusa(
    "INSERT INTO rodada (demanda_id, rodada_id, titulo, estado, estado_alterado_em, e2e, branch) VALUES (?, 1, 'x', 'implementar', '2026-01-01T00:00:00.000Z', 0, 'b')",
    "I-999",
  );
  recusa(
    "INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, estado, estado_alterado_em, rodada_id) VALUES (?, 99, 'implementar', 'aberto', ?, 7)",
    a,
    agora,
  );
  recusa(
    "INSERT INTO decisao_ticket (demanda_id, ticket_id, decisao_id, gate, resultado, por_tipo, em) VALUES (?, 99, 1, 'gate_demanda', 'aprovado', 'auditor', ?)",
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
  const id = await demandaAprovada(c);
  await ciclaPlanejamentos(c, [id]);
  const prompt = pi.prompts()[0]?.prompt ?? "";
  assert.match(prompt, /## Desenho aprovado[\s\S]*\nr\n[\s\S]*- `src\/a\.ts` \(criar\): porque/);
  const [, html] = /- `d\.html`: `([^`]+)`/.exec(prompt) ?? [];
  assert.equal(readFileSync(html ?? "", "utf8"), "<!doctype html><p>x</p>");
});

/** A instalação que, se rodasse na aprovação, a atrasaria por minutos e a faria falhar. */
const INSTALACAO_DEMORADA_QUE_FALHA = "sleep 120; exit 1";
const LIMITE_DA_APROVACAO_MS = 10_000;

test("I-313 CA-4: aprovar o planejamento de duas rodadas com o Ambiente pronto não roda a instalação e termina em segundos", async (t) => {
  const c = criarCenario(t);
  pi.roteirizar();
  const { banco, projeto, repo } = c;
  // A branch base com o package.json e o lockfile que a imagem do Ambiente já instalou em `/dependencias`.
  const dependenciasDaImagem = join(c.raiz, "dependencias");
  mkdirSync(join(dependenciasDaImagem, "node_modules"), { recursive: true });
  const arquivosDeDependenciasDaBase = { "package.json": "{}", "package-lock.json": "lock-da-base" };
  for (const [arquivo, conteudo] of Object.entries(arquivosDeDependenciasDaBase)) {
    writeFileSync(join(repo, arquivo), conteudo);
    writeFileSync(join(dependenciasDaImagem, arquivo), conteudo);
  }
  execFileSync("git", ["add", "package.json", "package-lock.json"], { cwd: repo });
  execFileSync("git", ["commit", "-q", "-m", "dependências"], { cwd: repo });
  execFileSync("git", ["push", "-q", "origin", "main"], { cwd: repo });
  ligarGestaoDeAmbientesNosModulos(gestaoQueSoUsa(new AmbienteComDependencias(dependenciasDaImagem)));
  t.after(() => {
    ligarGestaoDeAmbientesNosModulos();
  });
  const projetoDoCenario = montarDemandasDoBanco(banco).projeto(projeto);
  gravarProjeto(
    banco,
    Projeto.parse({
      ...projetoDoCenario,
      verificacoes: { ...projetoDoCenario.verificacoes, instalacao: [INSTALACAO_DEMORADA_QUE_FALHA] },
    }),
  );
  const id = await demandaAprovada(c);
  await ciclaPlanejamentos(c, [id]);
  proporPlanoDoAgente(banco, id, plano(id, "r", 2), agente(1));

  const inicio = performance.now();
  await decidirPlanejamento(banco, id, { resultado: "aprovado", nota: 4 });
  const duracaoMs = performance.now() - inicio;

  assert.ok(duracaoMs < LIMITE_DA_APROVACAO_MS, `a aprovação levou ${String(Math.round(duracaoMs))} ms`);
  assert.deepEqual(
    demanda(c, id).rodadas.map((r) => [r.rodada_id, r.estado]),
    [
      [1, "implementar"],
      [2, "implementar"],
    ],
  );
  const logDoPlanejamento = readFileSync(join(c.raiz, "execucoes", `planejamento-${id}.log`), "utf8");
  assert.doesNotMatch(logDoPlanejamento, /sleep 120/);
  for (const rodada of ["1", "2"])
    assert.equal(
      readlinkSync(join(c.raiz, "worktrees", projeto, id, "rodadas", rodada, "node_modules")),
      join(dependenciasDaImagem, "node_modules"),
    );
});
