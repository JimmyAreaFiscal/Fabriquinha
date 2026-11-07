// Serviço de planejamento com banco real, git real em repositório temporário e pi falso mínimo (CA-1 a CA-13).
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";
import { abrirBancoTemporario } from "../../apoio-testes/banco_temporario.ts";
import { instalarPiFalso } from "../../apoio-testes/pi_falso.ts";
import type { AgregadoDemanda } from "../dominio/agregado_demanda.ts";
import { ErroDeRegra } from "../dominio/erros.ts";
import { submeterPlano } from "../dominio/transicoes_demanda.ts";
import { gravarConfiguracaoProjeto, substituirPreparacaoDoProjeto } from "../persistencia/configuracao_projeto.ts";
import { carregarDemanda, comDemanda, criarDemanda } from "../persistencia/demandas.ts";
import { registrarDependenciaDemanda } from "../persistencia/dependencias_demanda.ts";
import { carregarSessoesDoTicket } from "../persistencia/sessoes.ts";
import { criarRepositorioDeTeste, rodarGit } from "../../apoio-testes/repositorio_de_teste.ts";
import * as servico from "./planejamento.ts";
import {
  aprovarPlanejamentoDemanda,
  iniciarOuRetomarPlanejamento,
  reprovarPlanejamentoDemanda,
} from "./planejamento.ts";

const em = "2026-01-01T00:00:00.000Z";
const temporario = mkdtempSync(join(tmpdir(), "fabriquinha-planejamento-"));
process.env.PI_CODING_AGENT_DIR = join(temporario, "pi-agent");
delete process.env.FABRIQUINHA_PORTA;

const abertos: DatabaseSync[] = [];
after(() => {
  for (const b of abertos) b.close();
});

const CRITERIOS = ["CA-1", "CA-2"];
const plano = (criterios = CRITERIOS) => ({
  demanda_id: "I-1",
  criterios,
  rodadas: [1, 2].map((rodada_id) => ({
    demanda_id: "I-1",
    rodada_id,
    titulo: `r${String(rodada_id)}`,
    e2e: false,
    criterios: [criterios[0]],
    depende: rodada_id === 2 ? [{ demanda_id: "I-1", rodada_id: 1 }] : [],
  })),
  tickets: [1, 2].map((n) => ({
    demanda_id: "I-1",
    ticket_id: n,
    rodada_id: n,
    titulo: `t${String(n)}`,
    descricao: "d",
  })),
});

/** Preparação: marca `preparado`; com o arquivo `quebra` na raiz, falha só em rodadas/1. */
function preparacao(raiz: string): string {
  return `[ -e ${raiz}/quebra ] && [ "$(basename "$PWD")" = 1 ] && exit 1; touch preparado; true`;
}

function demanda(id: string, fase: string, extra: object = {}) {
  return {
    id,
    projeto: "loja",
    titulo: "t",
    tipo: "funcionalidade",
    descricao: "d",
    fase,
    fase_alterada_em: em,
    origem_ferramenta: "claude",
    origem_sessao: "s1",
    enviada: true,
    branch: `fabriquinha/${id}`,
    ...extra,
  };
}

/** Projeto `loja`, demanda I-1 na fase dada com o ticket `planejar` (e o plano, se submetido) e uma predecessora I-0. */
function cenario({ fase = "planejamento", status = "aberto", comPlano = false, predecessora = "concluida" } = {}) {
  const c = criarRepositorioDeTeste();
  const { banco } = abrirBancoTemporario(c.raiz);
  abertos.push(banco);
  banco
    .prepare(
      `INSERT INTO projeto (nome, repo, branch_base, hospedagem, sonar_project_key)
       VALUES ('loja', ?, 'integracao', 'github', 'k')`,
    )
    .run(c.repo);
  gravarConfiguracaoProjeto(banco, {
    nome: "loja",
    branch_base: "integracao",
    chave_sonarqube: "k",
    raiz_git: c.repo,
    hospedagem: "github",
    etapas: [],
    fitness: [{ nome: "f", comando: "true", descricao: "d" }],
    linguagens: [{ caminho: ".", linguagem: "ts", comando_teste: "true" }],
  });
  substituirPreparacaoDoProjeto(banco, "loja", [preparacao(c.raiz)]);
  const base = {
    rodadas: [],
    dependencias_rodada: [],
    criterios_citados: [],
    dependencias_ticket: [],
    caminhos_ticket: [],
  };
  criarDemanda(banco, {
    demanda: demanda("I-0", predecessora),
    tickets: [],
    decisoes: [],
    evidencias: [],
    ...base,
  } as unknown as AgregadoDemanda);
  criarDemanda(banco, {
    demanda: demanda("I-1", fase, { enviada: false }),
    tickets: [{ demanda_id: "I-1", ticket_id: 1, etapa: "planejar", status, status_alterado_em: em, devolucoes: 0 }],
    decisoes: [],
    evidencias: [
      {
        demanda_id: "I-1",
        tipo: "criterios_aceite",
        dados: { criterios: CRITERIOS.map((id) => ({ id, dado: "d", quando: "q", entao: "e" })) },
        em,
      },
      ...(comPlano ? [{ demanda_id: "I-1", ticket_id: 1, tipo: "plano", dados: plano(), em }] : []),
    ],
    ...base,
  } as unknown as AgregadoDemanda);
  registrarDependenciaDemanda(banco, "I-1", "I-0"); // só antes do envio
  banco.exec("UPDATE demanda SET enviada = 1 WHERE id = 'I-1'");
  const piFalso = instalarPiFalso(c.dir);
  return {
    c,
    banco,
    prompts: () => piFalso.prompts().map((entrada) => entrada.prompt),
    sessoes: () => carregarSessoesDoTicket(banco, { demanda_id: "I-1", ticket_id: 1 }),
    status: () => carregarDemanda(banco, "I-1").tickets[0]?.status,
  };
}

const agente = { tipo: "agente", execucao: 1, ticket: 1 } as const;
const submeterPlanoDoAgente = (banco: DatabaseSync, demandaId: string, planoEntrada: unknown) =>
  comDemanda(banco, demandaId, (ag) => submeterPlano(ag, planoEntrada, agente, { agora: new Date().toISOString() }));

test("CA-1: planejamento com predecessoras satisfeitas reserva o planejar e cria a sessão", async () => {
  for (const predecessora of ["concluida", "arquivada"]) {
    const { banco, sessoes, status } = cenario({ predecessora });
    await iniciarOuRetomarPlanejamento(banco, "I-1", 0.02).fim;
    assert.equal(status(), "em_execucao");
    assert.equal(sessoes().sessoes.length, 1);
    assert.equal(sessoes().sessoes[0]?.modo, "interativo");
  }
});

test("CA-2: predecessora em execução recusa, sem reservar nem criar sessão", () => {
  const { banco, sessoes, status } = cenario({ predecessora: "execucao" });
  assert.throws(
    () => iniciarOuRetomarPlanejamento(banco, "I-1", 0.02),
    /predecessoras da demanda ainda não foram satisfeitas/,
  );
  assert.equal(status(), "aberto");
  assert.equal(sessoes().sessoes.length, 0);
});

test("CA-1, CA-3: fase errada e status inesperado recusam com orientação", () => {
  assert.throws(
    () => iniciarOuRetomarPlanejamento(cenario({ fase: "execucao" }).banco, "I-1", 0.02),
    /só na fase planejamento/,
  );
  assert.throws(
    () => iniciarOuRetomarPlanejamento(cenario({ status: "concluido" }).banco, "I-1", 0.02),
    /está concluido e não pode ser iniciado \(só se inicia ou retoma/,
  );
});

test("CA-3: com o planejar em execução, a mesma sessão é retomada", async () => {
  const { banco, sessoes } = cenario();
  await iniciarOuRetomarPlanejamento(banco, "I-1", 0.02).fim;
  const [primeira] = sessoes().sessoes;
  await iniciarOuRetomarPlanejamento(banco, "I-1", 0.02).fim;
  assert.deepEqual(sessoes().sessoes, [primeira]);
  assert.equal(sessoes().execucoes.length, 2);
  assert.equal(carregarDemanda(banco, "I-1").tickets.length, 1);
});

test("CA-4: plano válido leva ao gate e fica como evidência do planejar", () => {
  const { banco } = cenario({ status: "em_execucao" });
  const depois = submeterPlanoDoAgente(banco, "I-1", plano());
  assert.equal(depois.demanda.fase, "aprovacao_planejamento");
  const gravado = carregarDemanda(banco, "I-1").evidencias.find((e) => e.tipo === "plano");
  assert.equal(gravado?.ticket_id, 1);
  assert.deepEqual((gravado.dados as { criterios: string[] }).criterios, CRITERIOS);
});

test("CA-2: plano com critério que nenhuma rodada cita é aceito e vai ao gate", () => {
  const { banco } = cenario({ status: "em_execucao" });
  const umPlano = plano();
  assert.ok(umPlano.rodadas.every((r) => !r.criterios.includes("CA-2")));
  assert.equal(submeterPlanoDoAgente(banco, "I-1", umPlano).demanda.fase, "aprovacao_planejamento");
});

test("CA-5: plano que cita CA inexistente é recusado e nada é gravado", () => {
  const { banco } = cenario({ status: "em_execucao" });
  assert.throws(
    () => submeterPlanoDoAgente(banco, "I-1", plano(["CA-1", "CA-99"])),
    /o plano cita CA-99, que a definição da demanda I-1 não tem/,
  );
  const ag = carregarDemanda(banco, "I-1");
  assert.equal(ag.demanda.fase, "planejamento");
  assert.equal(
    ag.evidencias.some((e) => e.tipo === "plano"),
    false,
  );
});

test("CA-6, CA-7: reprovação registra o motivo e a retomada reusa a sessão com o motivo", async () => {
  const { banco, sessoes, prompts, status } = cenario({ status: "em_execucao" });
  await iniciarOuRetomarPlanejamento(banco, "I-1", 0.02).fim;
  const [sessao] = sessoes().sessoes;
  submeterPlanoDoAgente(banco, "I-1", plano());
  reprovarPlanejamentoDemanda(banco, "I-1", "faltam critérios na rodada 2");
  const ag = carregarDemanda(banco, "I-1");
  assert.equal(ag.demanda.fase, "planejamento");
  assert.deepEqual(
    ag.decisoes.map((d) => [d.resultado, d.motivo]),
    [["recusado", "faltam critérios na rodada 2"]],
  );
  assert.equal(status(), "em_execucao");
  await iniciarOuRetomarPlanejamento(banco, "I-1", 0.02).fim;
  assert.deepEqual(sessoes().sessoes, [sessao]);
  assert.match(prompts().at(-1) ?? "", /Motivo: faltam critérios na rodada 2/);
});

test("CA-1: com o pi vivo e ocioso, a reprovação manda o motivo à mesma sessão", async () => {
  const { banco, prompts } = cenario({ status: "em_execucao" });
  const { fim } = iniciarOuRetomarPlanejamento(banco, "I-1", 0.2);
  while (prompts().length === 0) await new Promise((r) => setTimeout(r, 20));
  await new Promise((r) => setTimeout(r, 100)); // o pi assenta: ocioso, à espera do gate
  submeterPlanoDoAgente(banco, "I-1", plano());
  reprovarPlanejamentoDemanda(banco, "I-1", "faltam critérios na rodada 2");
  while (prompts().length < 2) await new Promise((r) => setTimeout(r, 20));
  assert.match(prompts()[1] ?? "", /Motivo: faltam critérios na rodada 2/);
  await fim;
});

test("a reprovação sem sessão do planejar só grava a decisão", () => {
  const { banco, prompts } = cenario({ fase: "aprovacao_planejamento", status: "em_execucao", comPlano: true });
  reprovarPlanejamentoDemanda(banco, "I-1", "falta");
  assert.deepEqual(prompts(), []);
});

test("CA-3: reprovar com o planejar Falhou o reabre com o motivo e o despacho retoma a mesma sessão", async () => {
  const { banco, sessoes, prompts } = cenario({ status: "em_execucao" });
  await iniciarOuRetomarPlanejamento(banco, "I-1", 0.02).fim;
  const [sessao] = sessoes().sessoes;
  submeterPlanoDoAgente(banco, "I-1", plano());
  banco.exec("UPDATE ticket_demanda SET status = 'falhou', motivo_falha = 'serviço reiniciado'");
  reprovarPlanejamentoDemanda(banco, "I-1", "faltam critérios na rodada 2");
  const ticket = carregarDemanda(banco, "I-1").tickets[0] as { status: string; instrucao?: string };
  assert.equal(ticket.status, "aberto");
  assert.equal(ticket.instrucao, "faltam critérios na rodada 2");
  const antes = sessoes().execucoes.length;
  await iniciarOuRetomarPlanejamento(banco, "I-1", 0.02).fim;
  assert.deepEqual(sessoes().sessoes, [sessao]);
  assert.equal(sessoes().execucoes.length, antes + 1);
  assert.match(prompts().at(-1) ?? "", /Motivo: faltam critérios na rodada 2/);
});

test("plano aprovado e reaberto com instrução replaneja em sessão nova com a instrução; a retomada fica nela", async () => {
  const { banco, sessoes, prompts } = cenario({ status: "em_execucao" });
  const { fim } = iniciarOuRetomarPlanejamento(banco, "I-1", 0.2);
  while (prompts().length === 0) await new Promise((r) => setTimeout(r, 20));
  submeterPlanoDoAgente(banco, "I-1", plano());
  await aprovarPlanejamentoDemanda(banco, "I-1", {});
  await fim;
  const [descartada] = sessoes().sessoes;
  // O Auditor descarta o plano aprovado (incidente da I-259): volta ao planejamento com a instrução no ticket.
  banco.exec("UPDATE demanda SET fase = 'planejamento' WHERE id = 'I-1'");
  banco.exec(
    "UPDATE ticket_demanda SET status = 'aberto', instrucao = 'Refaça o plano com até 30 arquivos por rodada' WHERE etapa = 'planejar'",
  );
  await iniciarOuRetomarPlanejamento(banco, "I-1", 0.02).fim;
  const replanejamento = sessoes().sessoes.at(-1);
  assert.equal(sessoes().sessoes.length, 2);
  assert.notEqual(replanejamento?.id, descartada?.id);
  assert.match(prompts().at(-1) ?? "", /## Reabertura[\s\S]*Motivo: Refaça o plano com até 30 arquivos por rodada/);
  // Serviço reiniciado no meio do replanejamento: retoma a sessão nova, não abre outra nem volta à descartada.
  await iniciarOuRetomarPlanejamento(banco, "I-1", 0.02).fim;
  assert.equal(sessoes().sessoes.length, 2);
  assert.equal(sessoes().execucoes.at(-1)?.sessao_id, replanejamento?.id);
});

test("CA-8: motivo vazio recusa a reprovação e nada é registrado", () => {
  const { banco } = cenario({ fase: "aprovacao_planejamento", status: "em_execucao", comPlano: true });
  assert.throws(() => reprovarPlanejamentoDemanda(banco, "I-1", "   "));
  const ag = carregarDemanda(banco, "I-1");
  assert.equal(ag.demanda.fase, "aprovacao_planejamento");
  assert.deepEqual(ag.decisoes, []);
});

const aprovacao = () => cenario({ fase: "aprovacao_planejamento", status: "em_execucao", comPlano: true });

test("CA-9: aprovar cria as worktrees a partir da branch da demanda e prepara cada uma; a dependente fica para quando começar", async () => {
  const { c, banco } = aprovacao();
  await aprovarPlanejamentoDemanda(banco, "I-1", {});
  const dir = join(c.raiz, "worktrees", "loja", "I-1");
  const demandaTopo = rodarGit(c.repo, "rev-parse", "fabriquinha/I-1");
  for (const w of ["demanda", "rodadas/1"]) assert.ok(existsSync(join(dir, w, "preparado")), w);
  assert.equal(rodarGit(c.repo, "merge-base", "fabriquinha/I-1", "fabriquinha/I-1-1"), demandaTopo);
  // D04: a rodada 2 depende da 1 e nasce da ponta da demanda só quando começar.
  assert.equal(existsSync(join(dir, "rodadas/2")), false);
  assert.equal(rodarGit(c.repo, "branch", "--list", "fabriquinha/I-1-2"), "");
});

test("CA-4: aprovar encerra o pi vivo e grava o fim da execução do planejamento", async () => {
  const { banco, prompts } = cenario({ status: "em_execucao" });
  const { fim } = iniciarOuRetomarPlanejamento(banco, "I-1", 0.2);
  while (prompts().length === 0) await new Promise((r) => setTimeout(r, 20));
  await new Promise((r) => setTimeout(r, 100));
  submeterPlanoDoAgente(banco, "I-1", plano());
  await aprovarPlanejamentoDemanda(banco, "I-1", {});
  await fim;
  const { n } = banco.prepare("SELECT COUNT(*) AS n FROM execucao_sessao WHERE fim IS NULL").get() as { n: number };
  assert.equal(n, 0);
});

test("CA-10, CA-11: preparação que falha na rodada 1 deixa o gate aberto; corrigida, a aprovação conclui", async () => {
  const { c, banco, status } = aprovacao();
  writeFileSync(join(c.raiz, "quebra"), "");
  const caminho = join(c.raiz, "worktrees", "loja", "I-1", "rodadas", "1");
  await assert.rejects(
    aprovarPlanejamentoDemanda(banco, "I-1", {}),
    (e: Error) =>
      e instanceof ErroDeRegra &&
      e.message.includes("a preparação da worktree falhou") &&
      e.message.endsWith(`(worktree ${caminho})`),
  );
  let ag = carregarDemanda(banco, "I-1");
  assert.deepEqual([ag.demanda.fase, ag.rodadas.length, ag.tickets.length], ["aprovacao_planejamento", 0, 1]);
  assert.match(
    readFileSync(join(c.raiz, "execucoes", "planejamento-I-1.log"), "utf8"),
    /preparação falhou em .*rodadas\/1/,
  );

  rmSync(join(c.raiz, "quebra"));
  await aprovarPlanejamentoDemanda(banco, "I-1", { nota: 4 });
  ag = carregarDemanda(banco, "I-1");
  assert.equal(ag.demanda.fase, "execucao");
  assert.deepEqual(
    ag.rodadas.map((r) => [r.rodada_id, r.fase]),
    [
      [1, "desenvolvimento"],
      [2, "desenvolvimento"],
    ],
  );
  assert.deepEqual(
    ag.tickets.map((t) => [t.etapa, t.status]),
    [
      ["planejar", "concluido"],
      ["implementar", "aberto"],
      ["implementar", "aberto"],
    ],
  );
  assert.equal(status(), "concluido");
});

test("CA-12: falha de gravação depois da primeira rodada desfaz tudo", async () => {
  const { banco } = aprovacao();
  banco.exec(
    "CREATE TRIGGER falha BEFORE INSERT ON rodada WHEN NEW.rodada_id = 2 BEGIN SELECT RAISE(ABORT, 'falha de gravação'); END",
  );
  const antes = carregarDemanda(banco, "I-1");
  await assert.rejects(aprovarPlanejamentoDemanda(banco, "I-1", {}), /falha de gravação/);
  assert.deepEqual(carregarDemanda(banco, "I-1"), antes);
});

test("CA-13: as três operações estão exportadas", () => {
  assert.deepEqual(Object.keys(servico).sort(), [
    "aprovarPlanejamentoDemanda",
    "iniciarOuRetomarPlanejamento",
    "reprovarPlanejamentoDemanda",
  ]);
});

test("aprovar fora do gate recusa antes de tocar o git", async () => {
  const { c, banco } = cenario();
  await assert.rejects(aprovarPlanejamentoDemanda(banco, "I-1", {}), /só na fase aprovacao_planejamento/);
  assert.equal(existsSync(join(c.raiz, "worktrees")), false);
});
