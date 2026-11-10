// evidencia schema/add do agente da demanda contra banco real numa raiz temporária (CA-4 a CA-9, CA-15): I-206 em
// planejamento, com o planejar (T1) e a revisão integral (T5) em execução, e o T3/T4 de implementação.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { Readable } from "node:stream";
import { test } from "node:test";
import { fabricaDeBancosTemporarios } from "../../../apoio-testes/banco_temporario.ts";
import type { AgregadoDemanda } from "../../nucleo/agregado_demanda.ts";
import { criarTrabalho, iniciarProcesso } from "../../nucleo/trabalho_agentico.ts";
import { gravarAgregadoPronto } from "../../../apoio-testes/cenarios_de_demanda.ts";
import { carregarDemanda } from "../../armazenamento/demandas.ts";
import { comTrabalhosDoTicket } from "../../armazenamento/trabalho_agentico.ts";
import { principal } from "./cli.ts";

const abrirBancoTemporario = fabricaDeBancosTemporarios();

const em = "2026-01-01T00:00:00.000Z";

const PLANO = {
  demanda_id: "I-206",
  criterios: ["CA-1"],
  rodadas: [{ demanda_id: "I-206", rodada_id: 1, titulo: "r1", e2e: false, criterios: ["CA-1"], depende: [] }],
  tickets: [
    {
      demanda_id: "I-206",
      ticket_id: 1,
      rodada_id: 1,
      titulo: "t",
      descricao: "d",
      arquivos_previstos: [],
      depende: [],
    },
  ],
};
const ESTRESSE = {
  aplicavel: true,
  cenarios: [{ nome: "carga", objetivo: "o", comando: "npm test", resultado: "passou", observado: "ok" }],
};
const SEGURANCA = {
  aplicavel: true,
  ameacas: [{ descricao: "injeção", mitigacao: "parâmetros" }],
  achados: [{ descricao: "a", severidade: "baixa", recomendacao: "m" }],
};

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8" }).trim();

// A worktree da rodada 1 de verdade: a.ts tem 3 linhas, 2 delas mudadas entre base e head.
const RODADA = (raiz: string) => join(raiz, "worktrees", "loja", "I-206", "rodadas", "1");
let ALTERADOS: object = {};

function worktreeDaRodada(raiz: string): void {
  const dir = RODADA(raiz);
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q");
  writeFileSync(join(dir, "a.ts"), "x\ny\nz\n");
  git(dir, "add", ".");
  git(dir, "commit", "-qm", "base");
  const baseSha = git(dir, "rev-parse", "HEAD");
  writeFileSync(join(dir, "a.ts"), "x\nY\nZ\n");
  git(dir, "commit", "-qam", "head");
  ALTERADOS = {
    base: baseSha,
    head: git(dir, "rev-parse", "HEAD"),
    arquivos: [
      { caminho: "a.ts", status: "M", adicionadas: 2, removidas: 2, previsto: "src/**" },
      { caminho: "b.ts", status: "A", adicionadas: 1, removidas: 0, previsto: null },
    ],
    previstosNaoTocados: [],
  };
}

function cenario() {
  const { raiz, banco } = abrirBancoTemporario();
  worktreeDaRodada(raiz);
  banco
    .prepare(
      `INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube)
       VALUES ('loja', '/repos/loja', 'main', 'github', 'k')`,
    )
    .run();
  const ticket = (ticket_id: number, etapa: string, extra: object = {}) => ({
    demanda_id: "I-206",
    ticket_id,
    etapa,
    estado: "em_execucao",
    estado_alterado_em: em,
    criado_por: { tipo: "fabriquinha" },
    ...extra,
  });
  gravarAgregadoPronto(banco, {
    demanda: {
      id: "I-206",
      projeto: "loja",
      titulo: "Busca",
      tipo: "funcionalidade",
      descricao: "d",
      estado: "planejar",
      estado_alterado_em: em,
      criada_por: { tipo: "externo", ferramenta: "claude", sessao: "s1" },
      enviada: true,
      branch: "fabriquinha/I-206",
    },
    rodadas: [
      {
        demanda_id: "I-206",
        rodada_id: 1,
        titulo: "r1",
        estado: "revisar_rodada",
        estado_alterado_em: "2026-01-01T00:00:00.000Z",
        e2e: false,
        branch: "fabriquinha/I-206-1",
      },
    ],
    dependencias_rodada: [],
    criterios_citados: [{ demanda_id: "I-206", rodada_id: 1, criterio_id: "CA-1" }],
    tickets: [
      ticket(1, "planejar"),
      ticket(4, "implementar"),
      ticket(5, "revisar_demanda"),
      ticket(6, "revisar_rodada", { rodada_id: 1 }),
      ticket(7, "encerrar_rodada", { rodada_id: 1 }),
      ticket(8, "revisar_rodada", { rodada_id: 1, estado: "concluido" }),
    ],
    tentativas: [],
    dependencias_ticket: [],
    caminhos_ticket: [],
    arquivos_previstos_rodada: [],
    arquivos_previstos_demanda: [],
    versoes_plano: [],
    decisoes: [],
    evidencias: [
      {
        demanda_id: "I-206",
        tipo: "criterios_aceite",
        autor: { tipo: "externo", ferramenta: "claude", sessao: "s1" },
        em,
        dados: { criterios: [{ id: "CA-1" }, { id: "CA-2" }] },
      },
      // Opcional da demanda, registrada pela ferramenta externa: impacto alto exige reversão na mensagem_pr.
      {
        demanda_id: "I-206",
        tipo: "relatorio_impactos_arquitetura",
        autor: { tipo: "externo", ferramenta: "claude", sessao: "s1" },
        em,
        dados: { impacto: "alto" },
      },
      {
        demanda_id: "I-206",
        ticket_id: 6,
        tipo: "matriz_fitness",
        autor: { tipo: "agente", trabalho_id: "exec-6" },
        em,
        dados: { linhas: [{ nome: "f" }] },
      },
      {
        demanda_id: "I-206",
        ticket_id: 8,
        tipo: "arquivos_alterados",
        autor: { tipo: "agente", trabalho_id: "exec-8" },
        em,
        dados: ALTERADOS,
      },
    ],
  } as unknown as AgregadoDemanda);
  for (const t of [1, 4, 5, 6, 7]) abrirExecucao(banco, `exec-${String(t)}`, t);
  return { raiz, banco, env: (t: number) => ({ FABRIQUINHA_ROOT: raiz, FABRIQUINHA_EXECUCAO: `exec-${String(t)}` }) };
}

function abrirExecucao(banco: DatabaseSync, id: string, ticket_id: number): void {
  comTrabalhosDoTicket(banco, { demanda_id: "I-206", ticket_id }, (e) => {
    const sessoes = criarTrabalho(e.sessoes, {
      id: `s-${id}`,
      demanda_id: "I-206",
      ticket_id,
      modo: "autonomo",
      conversa_referencia: `s-${id}`,
    });
    return {
      ...e,
      sessoes,
      execucoes: iniciarProcesso(sessoes, e.execucoes, { id, trabalho_id: `s-${id}`, inicio: em, falha: false }),
    };
  });
}

async function cli(env: NodeJS.ProcessEnv, args: string[], stdin = "") {
  let out = "";
  let err = "";
  const codigo = await principal(args, {
    env,
    stdin: Readable.from([stdin]),
    stdout: { write: (t: string) => (out += t) },
    stderr: { write: (t: string) => (err += t) },
    parada: () => Promise.resolve(),
  });
  return { codigo, out, err };
}

const gravadas = (banco: DatabaseSync) =>
  banco
    .prepare("SELECT ticket_id, tipo FROM evidencia_demanda WHERE em <> ?")
    .all(em)
    .map((l) => ({ ...l }));

function json(raiz: string, dados: unknown): string {
  const arquivo = join(raiz, `dados-${String(Math.random())}.json`);
  writeFileSync(arquivo, JSON.stringify(dados));
  return arquivo;
}

test("CA-6: o plano válido fica registrado e a leitura da demanda o mostra", async () => {
  const { raiz, banco, env } = cenario();
  const s = await cli(env(1), ["evidencia", "add", "I-206.T1", "plano", "--dados", json(raiz, PLANO)]);
  assert.deepEqual([s.codigo, s.err], [0, ""]);
  assert.deepEqual(JSON.parse(s.out), { ticket: "I-206.T1", tipo: "plano" });
  assert.deepEqual(gravadas(banco), [{ ticket_id: 1, tipo: "plano" }]);
  assert.deepEqual(carregarDemanda(banco, "I-206").evidencias.find((evidencia) => evidencia.tipo === "plano")?.autor, {
    tipo: "agente",
    trabalho_id: "exec-1",
  });
  const lida = JSON.parse((await cli(env(1), ["demanda", "ver", "I-206"])).out) as {
    demanda: { estado: string };
    tickets: { evidencias?: { tipo: string }[] }[];
  };
  assert.equal(lida.demanda.estado, "gate_planejamento");
  assert.deepEqual(
    lida.tickets[0]?.evidencias?.map((e) => e.tipo),
    ["plano"],
  );
});

test("CA-7: plano com campo inválido não grava e o erro aponta o caminho do campo", async () => {
  const { raiz, banco, env } = cenario();
  const s = await cli(env(1), [
    "evidencia",
    "add",
    "I-206.T1",
    "plano",
    "--dados",
    json(raiz, { ...PLANO, criterios: "CA-1" }),
  ]);
  assert.deepEqual([s.codigo, s.out], [1, ""]);
  assert.match(s.err, /^[^\n]*dados\.criterios[^\n]*\n$/);
  assert.deepEqual(gravadas(banco), []);
});

test("CA-2: a submissão recusa Ticket fora da Rodada e Rodada fora da Demanda, sem gravar, e aceita o plano incluído", async () => {
  const { raiz, banco, env } = cenario();
  const planoCom = (demanda: string[], rodada: string[], ticket: string[]) => ({
    ...PLANO,
    arquivos_previstos: demanda,
    rodadas: [{ ...PLANO.rodadas[0], arquivos_previstos: rodada }],
    tickets: [{ ...PLANO.tickets[0], arquivos_previstos: ticket }],
  });
  const contarEvidencias = () =>
    (banco.prepare("SELECT COUNT(*) AS n FROM evidencia_demanda").get() as { n: number }).n;
  const submeter = (plano: object) =>
    cli(env(1), ["evidencia", "add", "I-206.T1", "plano", "--dados", json(raiz, plano)]);

  const antes = contarEvidencias();
  const ticketForaDaRodada = await submeter(planoCom(["src/a.ts"], ["src/a.ts"], ["src/b.ts"]));
  assert.equal(ticketForaDaRodada.codigo, 1);
  assert.match(ticketForaDaRodada.err, /src\/b\.ts/);
  assert.match(ticketForaDaRodada.err, /ticket 1/);
  assert.match(ticketForaDaRodada.err, /rodada 1/);
  const rodadaForaDaDemanda = await submeter(planoCom(["src/a.ts"], ["src/b.ts"], ["src/b.ts"]));
  assert.equal(rodadaForaDaDemanda.codigo, 1);
  assert.match(rodadaForaDaDemanda.err, /src\/b\.ts/);
  assert.match(rodadaForaDaDemanda.err, /rodada 1/);
  assert.match(rodadaForaDaDemanda.err, /demanda I-206/);
  assert.equal(contarEvidencias(), antes);

  const valido = await submeter(planoCom(["src/a.ts", "src/b.ts"], ["src/a.ts", "src/b.ts"], ["src/b.ts"]));
  assert.deepEqual([valido.codigo, valido.err], [0, ""]);
  assert.equal(contarEvidencias(), antes + 1);
});

test("CA-8: testes_estresse válido, com --dados do stdin e com anexo da saída, fica no ticket com veredito", async () => {
  const { raiz, banco, env } = cenario();
  const sem = await cli(
    env(5),
    ["evidencia", "add", "I-206.T5", "testes_estresse", "--dados", "-"],
    JSON.stringify(ESTRESSE),
  );
  assert.deepEqual([sem.codigo, sem.err], [0, ""]);
  assert.deepEqual(JSON.parse(sem.out), { ticket: "I-206.T5", tipo: "testes_estresse", veredito: "atende" });
  const saida = join(raiz, "execucoes", "E-exec-5", "saida");
  mkdirSync(saida, { recursive: true });
  const log = join(saida, "estresse.log");
  writeFileSync(log, "tudo certo\n");
  const com = await cli(env(5), [
    "evidencia",
    "add",
    "I-206.T5",
    "testes_estresse",
    "--dados",
    json(raiz, ESTRESSE),
    "--arquivo",
    log,
  ]);
  assert.deepEqual([com.codigo, com.err], [0, ""]);
  assert.deepEqual(gravadas(banco), [{ ticket_id: 5, tipo: "testes_estresse" }]);
  assert.deepEqual(
    carregarDemanda(banco, "I-206").evidencias.find((evidencia) => evidencia.tipo === "testes_estresse")?.autor,
    { tipo: "agente", trabalho_id: "exec-5" },
  );
  assert.deepEqual(
    banco
      .prepare("SELECT caminho, mime FROM arquivo_evidencia")
      .all()
      .map((a) => ({ ...a })),
    [{ caminho: "estresse.log", mime: "text/plain; charset=utf-8" }],
  );
  const lida = JSON.parse((await cli(env(5), ["demanda", "ver", "I-206"])).out) as {
    tickets: { ticket: string; evidencias?: unknown[] }[];
  };
  assert.equal(lida.tickets.find((t) => t.ticket === "I-206.T5")?.evidencias?.length, 1);
});

test("CA-9: analise_seguranca com campo inválido não grava e o erro aponta o caminho", async () => {
  const { raiz, banco, env } = cenario();
  const ruim = { ...SEGURANCA, achados: [{ descricao: "a", severidade: "enorme", recomendacao: "m" }] };
  const s = await cli(env(5), ["evidencia", "add", "I-206.T5", "analise_seguranca", "--dados", json(raiz, ruim)]);
  assert.deepEqual([s.codigo, s.out], [1, ""]);
  assert.match(s.err, /^[^\n]*dados\.achados\[0\]\.severidade[^\n]*\n$/);
  assert.deepEqual(gravadas(banco), []);
  const ok = await cli(env(5), ["evidencia", "add", "I-206.T5", "analise_seguranca", "--dados", json(raiz, SEGURANCA)]);
  assert.equal((JSON.parse(ok.out) as { veredito: string }).veredito, "atende");
});

test("CA-4 e CA-15: ticket alheio, T-5 e rodada não gravam nada e mostram a forma certa", async () => {
  const { raiz, banco, env } = cenario();
  const dados = json(raiz, ESTRESSE);
  const alheio = await cli(env(5), ["evidencia", "add", "I-206.T4", "testes_estresse", "--dados", dados]);
  assert.deepEqual([alheio.codigo, alheio.out], [1, ""]);
  assert.equal(alheio.err, "o agente só age no próprio ticket (aja em I-206.T5)\n");
  for (const ref of ["T-5", "I-206.R1"]) {
    const s = await cli(env(5), ["evidencia", "add", ref, "testes_estresse", "--dados", dados]);
    assert.deepEqual([s.codigo, s.out], [1, ""]);
    assert.match(s.err, /I-206\.T5/);
  }
  assert.deepEqual(gravadas(banco), []);
});

test("CA-5: execução terminada, ticket já concluído e execução inexistente não gravam nada", async () => {
  const { raiz, banco, env } = cenario();
  const dados = json(raiz, ESTRESSE);
  const args = ["evidencia", "add", "I-206.T5", "testes_estresse", "--dados", dados];
  banco.prepare("UPDATE ticket_demanda SET estado = 'concluido' WHERE ticket_id = 5").run();
  const concluido = await cli(env(5), args);
  assert.equal(concluido.err, "o ticket I-206.T5 está concluido e não recebe evidência (siga com o seu ticket)\n");
  banco.prepare("UPDATE processo_do_trabalho SET fim = ? WHERE id = 'exec-5'").run(em);
  const s = await cli(env(5), args);
  assert.deepEqual([s.codigo, s.out], [1, ""]);
  assert.equal(s.err, "a execução exec-5 já terminou (peça ao Auditor uma nova execução)\n");
  assert.deepEqual(gravadas(banco), []);
});

test("tipo que o agente não submete, ou de outra etapa, é rejeitado", async () => {
  const { raiz, env } = cenario();
  const dados = json(raiz, ESTRESSE);
  const outro = await cli(env(5), ["evidencia", "add", "I-206.T5", "pr_aberto", "--dados", dados]);
  assert.equal(
    outro.err,
    "pr_aberto não é evidência que o agente submete (use um de plano, explicacao_fitness, comprovacao_criterios, mensagem_pr, aula_codigo, video_demonstracao, testes_estresse, analise_seguranca)\n",
  );
  const etapa = await cli(env(4), ["evidencia", "add", "I-206.T4", "plano", "--dados", json(raiz, PLANO)]);
  assert.match(etapa.err, /T-4 \(implementar\) não aceita evidência plano/);
});

test("--dados ausente ou que não é JSON é rejeitado", async () => {
  const { raiz, env } = cenario();
  const falta = await cli(env(5), ["evidencia", "add", "I-206.T5", "testes_estresse"]);
  assert.equal(falta.err, "falta --dados (passe --dados <arquivo.json|->)\n");
  const ruim = join(raiz, "ruim.json");
  writeFileSync(ruim, "{");
  const s = await cli(env(5), ["evidencia", "add", "I-206.T5", "testes_estresse", "--dados", ruim]);
  assert.match(s.err, /ruim\.json não é um JSON válido/);
});

test("anexo fora da worktree e da saída é rejeitado sem gravar", async () => {
  const { raiz, banco, env } = cenario();
  const fora = join(raiz, "fora.log");
  writeFileSync(fora, "x");
  const s = await cli(env(5), [
    "evidencia",
    "add",
    "I-206.T5",
    "testes_estresse",
    "--dados",
    json(raiz, ESTRESSE),
    "--arquivo",
    fora,
  ]);
  assert.match(s.err, /está fora da worktree do ticket e do diretório de saída/);
  assert.deepEqual(gravadas(banco), []);
});

test("evidencia schema devolve o JSON Schema e as regras de arquivo; tipo desconhecido é rejeitado", async () => {
  const { env } = cenario();
  const s = await cli(env(5), ["evidencia", "schema", "testes_estresse"]);
  const lido = JSON.parse(s.out) as { dados: { properties: object }; arquivos: { classes: string[] } };
  assert.ok("cenarios" in lido.dados.properties);
  assert.deepEqual(lido.arquivos.classes, ["texto"]);
  const ruim = await cli(env(5), ["evidencia", "schema", "nada"]);
  assert.match(ruim.err, /nada não é evidência que o agente submete/);
});

const rodar = (env: NodeJS.ProcessEnv, t: number, tipo: string, dados: object, ...arquivos: string[]) =>
  cli(env, [
    "evidencia",
    "add",
    `I-206.T${String(t)}`,
    tipo,
    "--dados",
    json(env.FABRIQUINHA_ROOT ?? "", dados),
    ...arquivos.flatMap((a) => ["--arquivo", a]),
  ]);

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);

const anexos = (banco: DatabaseSync) =>
  banco
    .prepare("SELECT caminho FROM arquivo_evidencia ORDER BY caminho")
    .all()
    .map((a) => a.caminho);

function arquivoNaSaida(raiz: string, exec: number, nome: string, conteudo: string | Buffer): string {
  const saida = join(raiz, "execucoes", `E-exec-${String(exec)}`, "saida");
  mkdirSync(saida, { recursive: true });
  const caminho = join(saida, nome);
  writeFileSync(caminho, conteudo);
  return caminho;
}

test("explicacao_fitness sem anexo: cruza com a matriz do ticket, e linha faltando é reprovada", async () => {
  const { env, banco } = cenario();
  const ruim = await rodar(env(6), 6, "explicacao_fitness", { explicacoes: [{ nome: "g", explicacao: "e" }] });
  assert.match(ruim.err, /explicacao_fitness explica \[g\], e a matriz_fitness de T-6 tem as linhas \[f\]/);
  assert.deepEqual(gravadas(banco), []);
  const ok = await rodar(env(6), 6, "explicacao_fitness", { explicacoes: [{ nome: "f", explicacao: "e" }] });
  assert.deepEqual([ok.codigo, ok.err], [0, ""]);
  assert.deepEqual(gravadas(banco), [{ ticket_id: 6, tipo: "explicacao_fitness" }]);
});

test("comprovacao_criterios: anexo obrigatório, critérios só os da rodada, veredito derivado, na revisão de rodada e na integral", async () => {
  const { raiz, env, banco } = cenario();
  const comprovacao = (atendido: boolean, ids = ["CA-1"]) => ({
    criterios: ids.map((id) => ({ id, atendido, comoVerificado: "v", arquivos: ["cena.png"] })),
  });
  const sem = await rodar(env(6), 6, "comprovacao_criterios", comprovacao(true));
  assert.match(sem.err, /precisa de pelo menos 1 arquivo/);
  const png = arquivoNaSaida(raiz, 6, "cena.png", PNG);
  const demais = await rodar(env(6), 6, "comprovacao_criterios", comprovacao(true, ["CA-1", "CA-2"]), png);
  assert.match(demais.err, /comprova \[CA-1, CA-2\], e os critérios de aceite do registro são \[CA-1\]/);
  const ok = await rodar(env(6), 6, "comprovacao_criterios", comprovacao(false), png);
  assert.deepEqual([ok.codigo, ok.err], [0, ""]);
  assert.equal((JSON.parse(ok.out) as { veredito: string }).veredito, "nao_atende");
  assert.deepEqual(anexos(banco), ["cena.png"]);
  const integral = await rodar(
    env(5),
    5,
    "comprovacao_criterios",
    comprovacao(true, ["CA-1", "CA-2"]),
    arquivoNaSaida(raiz, 5, "cena.png", PNG),
  );
  assert.equal((JSON.parse(integral.out) as { veredito: string }).veredito, "atende");
});

test("mensagem_pr cruza com os não previstos da última revisão e pede reversão; sem anexo", async () => {
  const { env, banco } = cenario();
  const msg = (naoPrevistos: object[]) => ({
    titulo: "Adiciona a",
    oQueMudou: "m",
    decisoesNaoObvias: [],
    naoFeito: [],
    naoPrevistos,
    comoRevisar: ["a"],
    naoVerificado: [],
  });
  const ruim = await rodar(env(7), 7, "mensagem_pr", msg([]));
  assert.match(ruim.err, /explica os não previstos \[\], e a última revisão concluída tem \[b.ts\]/);
  const semReversao = await rodar(env(7), 7, "mensagem_pr", msg([{ caminho: "b.ts", motivo: "novo" }]));
  assert.match(semReversao.err, /mensagem_pr não tem reversao, e o impacto do desenho aprovado é alto/);
  assert.deepEqual(gravadas(banco), []);
  const ok = await rodar(env(7), 7, "mensagem_pr", {
    ...msg([{ caminho: "b.ts", motivo: "novo" }]),
    reversao: "reverter o merge",
  });
  assert.deepEqual([ok.codigo, ok.err], [0, ""]);
  assert.deepEqual(gravadas(banco), [{ ticket_id: 7, tipo: "mensagem_pr" }]);
});

test("aula_codigo: o agente envia só trechos e a Fabriquinha gera o HTML; anexo do agente e trecho fora do diff são rejeitados", async () => {
  const { raiz, env, banco } = cenario();
  const trecho = (inicio: number, fim: number) => ({
    trechos: [{ arquivo: "a.ts", inicio, fim, oQueFaz: "f", porQue: "p", decisaoDoDesenho: "d" }],
  });
  const comAnexo = await rodar(env(7), 7, "aula_codigo", trecho(2, 3), arquivoNaSaida(raiz, 7, "x.html", "<html>"));
  assert.match(comAnexo.err, /aula_codigo não aceita anexo do agente/);
  const invalido = await rodar(env(7), 7, "aula_codigo", { trechos: "a.ts" });
  assert.match(invalido.err, /^[^\n]*dados\.trechos[^\n]*\n$/);
  const fora = await rodar(env(7), 7, "aula_codigo", trecho(1, 1));
  assert.match(fora.err, /não toca nenhuma linha alterada/);
  assert.deepEqual(gravadas(banco), []);
  const ok = await rodar(env(7), 7, "aula_codigo", trecho(2, 3));
  assert.deepEqual([ok.codigo, ok.err], [0, ""]);
  assert.deepEqual(anexos(banco), ["aula.html"]);
  assert.deepEqual(gravadas(banco), [{ ticket_id: 7, tipo: "aula_codigo" }]);
});

test("video_demonstracao exige um vídeo; anexo do worktree da rodada é aceito e fora dela é rejeitado", async () => {
  const { raiz, env, banco } = cenario();
  const sem = await rodar(env(7), 7, "video_demonstracao", { roteiro: "r" });
  assert.match(sem.err, /precisa de pelo menos 1 arquivo/);
  const mp4 = join(RODADA(raiz), "demo.mp4");
  writeFileSync(mp4, Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypmp42"), Buffer.alloc(16)]));
  const ok = await rodar(env(7), 7, "video_demonstracao", { roteiro: "r" }, mp4);
  assert.deepEqual([ok.codigo, ok.err], [0, ""]);
  assert.deepEqual(anexos(banco), ["demo.mp4"]);
  const demanda = join(raiz, "worktrees", "loja", "I-206", "demanda");
  mkdirSync(demanda, { recursive: true });
  const alheio = join(demanda, "demo.mp4");
  writeFileSync(alheio, "x");
  const fora = await rodar(env(7), 7, "video_demonstracao", { roteiro: "r" }, alheio);
  assert.match(fora.err, /está fora da worktree do ticket e do diretório de saída/);
});
