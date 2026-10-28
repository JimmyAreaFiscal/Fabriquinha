// Seção 12 de comparacao-sdlc-implementacao.md, CA-SDLC-23 e 25 (cancelamento e avaliação): cancelamento e arquivamento
// com dependentes e execução em andamento (D08) e a avaliação de melhoria com o achado encaminhado (D12). Banco sempre
// numa raiz temporária; git real, pi falso.
import assert from "node:assert/strict";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { AUDITOR } from "../src/dominio/agregado.ts";
import { predecessorasPendentes } from "../src/dominio/dependencia_demanda.ts";
import {
  abrir as abrirAvaliacao,
  encaminharAchado,
  estadoDaAvaliacao,
  iniciarAvaliacao,
} from "../src/execucao/avaliacao.ts";
import { encerrar, situacao } from "../src/execucao/gerente.ts";
import * as gestao from "../src/execucao/gestao_demandas.ts";
import { metricasDaDemanda } from "../src/metricas/demanda.ts";
import { achadoDaDemanda } from "../src/persistencia/avaliacoes.ts";
import { predecessorasDaDemanda } from "../src/persistencia/dependencias_demanda.ts";
import { alterarLimiteParalelismo, configuracao } from "../src/persistencia/servico.ts";
import { carregarSessoesDoTicket } from "../src/persistencia/sessoes.ts";
import {
  abrirPortao,
  agente,
  demandaEmExecucao,
  despacho,
  pi,
  rodadaDe,
  statusDe,
  ticketDe,
} from "./apoio-execucao.ts";
import { base, criarCenario, CTX, demanda, esperar, registrarExterna } from "./apoio.ts";
import { despacharDemandas } from "../src/execucao/despacho_demanda.ts";

const ler = (b: DatabaseSync, sql: string) =>
  b
    .prepare(sql)
    .all()
    .map((l) => ({ ...l }));

test("CA-SDLC-23: cancelar interrompe só a demanda e as dependentes abertas, arquivada satisfaz dependência e o histórico fica", async (t) => {
  const c = criarCenario(t);
  alterarLimiteParalelismo(c.banco, 4);
  const config = configuracao(c.banco);
  const a = await demandaEmExecucao(c, [{ tickets: 1 }]);
  const alheia = await demandaEmExecucao(c, [{ tickets: 1 }]);
  // Dependentes de `a`: uma aberta (registro) e outra que já terminou (concluída), que o cancelamento poupa.
  const aberta = registrarExterna(c, [a]);
  const terminada = registrarExterna(c, [a]);
  c.banco.prepare("UPDATE demanda SET fase = 'concluida' WHERE id = ?").run(terminada);
  // Dependência de uma demanda que será arquivada.
  const feita = registrarExterna(c);
  const dependeDaFeita = registrarExterna(c, [feita]);
  c.banco.prepare("UPDATE demanda SET fase = 'concluida' WHERE id = ?").run(feita);

  // As duas demandas em execução têm um agente aberto (o portão fechado o segura).
  pi.roteirizar([{ modo: "ok", agente }]);
  const fins = despacharDemandas(c.banco, config, despacho());
  assert.equal(fins.length, 2);
  await esperar(() => pi.chamadas().length === 2, "os dois agentes abertos");
  const refA = ticketDe(c, a, 1);
  const refAlheia = ticketDe(c, alheia, 1);
  const antes = demanda(c, a);
  const execucoesAntes = carregarSessoesDoTicket(c.banco, refA).execucoes.length;

  const { canceladas } = gestao.cancelar(c.banco, a, AUDITOR, CTX);
  assert.deepEqual([...canceladas].sort(), [a, aberta].sort());
  assert.equal(demanda(c, a).demanda.fase, "cancelada");
  assert.equal(demanda(c, aberta).demanda.fase, "cancelada");
  assert.equal(demanda(c, terminada).demanda.fase, "concluida");
  assert.equal(statusDe(c, refA), "cancelado");

  // Libera o agente que sobrou: só a execução da cancelada foi interrompida; a alheia termina normalmente.
  abrirPortao();
  await Promise.all(fins);
  assert.ok(carregarSessoesDoTicket(c.banco, refA).execucoes.every((e) => e.fim));
  assert.equal(carregarSessoesDoTicket(c.banco, refA).execucoes.length, execucoesAntes);
  assert.equal(statusDe(c, refA), "cancelado");
  assert.equal(demanda(c, alheia).demanda.fase, "execucao");
  assert.equal(rodadaDe(c, alheia, 1)?.fase, "revisao");
  assert.notEqual(statusDe(c, refAlheia), "cancelado");
  // O histórico continua no banco: decisões, evidências, rodadas e sessões da cancelada.
  const depois = demanda(c, a);
  assert.deepEqual(depois.decisoes, antes.decisoes);
  assert.deepEqual(depois.evidencias, antes.evidencias);
  assert.deepEqual(depois.rodadas, antes.rodadas);
  assert.equal(carregarSessoesDoTicket(c.banco, refA).sessoes.length > 0, true);
  // A terminada não se cancela de novo.
  assert.throws(() => gestao.cancelar(c.banco, terminada, AUDITOR, CTX), /já terminou/);

  // Arquivar só vale para concluída, e a arquivada satisfaz a dependência de quem a esperava (D08).
  assert.throws(() => gestao.arquivar(c.banco, a, AUDITOR, CTX), /só demanda concluída/);
  assert.deepEqual(predecessorasPendentes(predecessorasDaDemanda(c.banco, dependeDaFeita)), []);
  gestao.arquivar(c.banco, feita, AUDITOR, CTX);
  assert.equal(demanda(c, feita).demanda.fase, "arquivada");
  assert.deepEqual(predecessorasPendentes(predecessorasDaDemanda(c.banco, dependeDaFeita)), []);
  assert.equal(demanda(c, dependeDaFeita).demanda.fase, "registro");
  assert.throws(() => gestao.cancelar(c.banco, feita, AUDITOR, CTX), /já terminou/);
});

// pi falso da avaliação: sobe (agent_start), grava dois achados em achados.jsonl e assenta. Sem esse formato, o
// `iniciarAvaliacao` não resolve; o pi falso comum da suíte não emite `agent_start`.
const PI_AVALIACAO = `#!/usr/bin/env node
import { appendFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
const arg = (nome) => process.argv[process.argv.indexOf(nome) + 1];
const dir = arg("--session-dir");
const id = arg("--session-id");
mkdirSync(dir, { recursive: true });
const sessao = join(dir, readdirSync(dir).find((n) => n.endsWith("_" + id + ".jsonl")) ?? "2026-10-11T10-00-00-000Z_" + id + ".jsonl");
appendFileSync(sessao, JSON.stringify({ type: "session", version: 3, id }) + "\\n");
const emitir = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
let resto = "";
process.stdin.setEncoding("utf8").on("data", (parte) => {
  const linhas = (resto + parte).split("\\n");
  resto = linhas.pop();
  for (const linha of linhas) {
    const c = JSON.parse(linha);
    if (c.type !== "prompt") continue;
    emitir({ type: "response", command: "prompt", success: true });
    emitir({ type: "agent_start" });
    for (const n of [1, 2])
      appendFileSync(join(process.cwd(), "achados.jsonl"), JSON.stringify({ titulo: "Achado " + n, descricao: "desc " + n, evidencia: "ev " + n }) + "\\n");
    emitir({ type: "agent_end" });
    emitir({ type: "agent_settled" });
  }
});
`;

test("CA-SDLC-25: avaliação de melhoria com achado encaminhado vira uma demanda em registro, ligada a um só achado e sem fan-out", async (t) => {
  const c = criarCenario(t);
  const origem = await demandaEmExecucao(c, [{ tickets: 1 }]);
  const piAvaliacao = join(base, "pi-avaliacao.mjs");
  writeFileSync(piAvaliacao, PI_AVALIACAO);
  chmodSync(piAvaliacao, 0o755);
  const piAnterior = process.env.FABRIQUINHA_PI;
  process.env.FABRIQUINHA_PI = piAvaliacao;
  t.after(() => {
    process.env.FABRIQUINHA_PI = piAnterior;
  });

  const id = await iniciarAvaliacao(
    c.banco,
    { projeto: c.projeto, de: "2020-01-01", ate: "2099-12-31" },
    { ociosidadeMin: 5 },
  );
  await esperar(() => abrirAvaliacao(c.banco, id).achados.length === 2, "os dois achados importados");
  const avaliacao = abrirAvaliacao(c.banco, id);
  // Escopo e matrizes rastreáveis: as demandas avaliadas e as métricas delas, gravadas na pasta da avaliação.
  assert.deepEqual(avaliacao.demandas, [origem]);
  const metricas = join(c.raiz, "avaliacoes", id, "demandas", origem, "metricas.json");
  assert.ok(existsSync(metricas));
  assert.deepEqual(
    JSON.parse(readFileSync(metricas, "utf8")),
    JSON.parse(JSON.stringify(metricasDaDemanda(c.banco, origem))),
  );

  // O Auditor encaminha um achado: uma demanda nova, em registro, e o outro achado segue sem demanda.
  const total = () => ler(c.banco, "SELECT id FROM demanda").length;
  const antes = total();
  const { demanda: nova } = encaminharAchado(c.banco, id, 1);
  assert.equal(total(), antes + 1);
  assert.deepEqual(
    [nova.fase, nova.enviada, nova.tipo, nova.projeto],
    ["registro", false, "funcionalidade", c.projeto],
  );
  assert.deepEqual([nova.origem_ferramenta, nova.origem_sessao], ["avaliacao", `${id}#1`]);
  assert.match(nova.descricao, /desc 1[\s\S]*ev 1/);
  assert.equal(achadoDaDemanda(c.banco, nova.id)?.achado_id, 1);
  assert.deepEqual(
    abrirAvaliacao(c.banco, id).achados.map((a) => [a.achado_id, a.demanda_id]),
    [
      [1, nova.id],
      [2, null],
    ],
  );
  assert.equal(demanda(c, nova.id).rodadas.length, 0);
  assert.equal(demanda(c, origem).demanda.fase, "execucao");

  // A demanda resultante segue o SDLC normal a partir do registro: a sessão do achado completa, envia e o Auditor decide.
  const autor = { ferramenta: "avaliacao", sessao: `${id}#1` };
  const submeter = (tipo: string, dados: unknown, arquivos?: gestao.EntradaEvidencia["arquivos"]) =>
    gestao.submeterEvidencia(c.banco, nova.id, { tipo, dados, arquivos } as gestao.EntradaEvidencia, autor, CTX);
  submeter("criterios_aceite", { criterios: [{ id: "CA-1", dado: "um dado", quando: "quando", entao: "então" }] });
  submeter(
    "desenho_solucao",
    { resumo: "r", arquivosPrevistos: [{ caminho: "src/a.ts", acao: "criar", motivo: "porque" }] },
    [{ nome: "d.html", mime: "text/html; charset=utf-8", conteudo: Buffer.from("<p>x</p>") }],
  );
  submeter("custos_realizados", {
    sessoes: [
      {
        ferramenta: "avaliacao",
        sessao: autor.sessao,
        linhas: [
          {
            provedor: "a",
            modelo: "m",
            tokens_entrada: 1,
            tokens_saida: 1,
            tokens_cache_leitura: 0,
            tokens_cache_escrita: 0,
          },
        ],
      },
    ],
  });
  gestao.enviar(c.banco, nova.id, autor, CTX);
  assert.equal(demanda(c, nova.id).demanda.fase, "aprovacao_demanda");
  gestao.decidir(c.banco, nova.id, { aprovado: true }, AUDITOR, CTX);
  assert.equal(demanda(c, nova.id).demanda.fase, "planejamento");

  encerrar(id);
  await esperar(() => !situacao(id) && estadoDaAvaliacao(id) === "concluida", "o pi da avaliação parar");
});
