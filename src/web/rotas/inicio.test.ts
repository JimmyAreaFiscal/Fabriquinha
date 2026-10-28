// Rota do Início: o mês, o que aguarda o Auditor, o que roda e o board das demandas em andamento, sobre um banco real.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";
import type { SessaoDeDemanda } from "../../execucao/historico_demanda.ts";
import { abrir } from "../../persistencia/banco.ts";
import { criarDemanda } from "../../persistencia/demandas.ts";
import { demanda, servir } from "./demandas_cenario.test.ts";
import { type DadosDoInicio, esperaDaSessao, inicio } from "./inicio.ts";

const base = mkdtempSync(join(tmpdir(), "fabriquinha-inicio-web-"));
after(() => {
  rmSync(base, { recursive: true, force: true });
});

const em = (minuto: number) => `2026-01-01T00:${String(minuto).padStart(2, "0")}:00.000Z`;

const ticket = (demanda_id: string, ticket_id: number, etapa: string, status: string, extra: object = {}) => ({
  demanda_id,
  ticket_id,
  etapa,
  status,
  status_alterado_em: em(ticket_id),
  devolucoes: 0,
  ...extra,
});

const rodada = (demanda_id: string, rodada_id: number, fase: string) => ({
  demanda_id,
  rodada_id,
  titulo: `rodada ${String(rodada_id)}`,
  fase,
  e2e: false,
  branch: `fabriquinha/${demanda_id}-${String(rodada_id)}`,
});

/**
 * Uma demanda em cada lugar do board: I-300 no registro (com a conversa interativa parada), I-301 e I-302 nos gates da
 * demanda e do plano, I-303 em execução com uma rodada em cada fase, I-304 no encerramento com o ticket global falho e
 * I-305 na revisão, bloqueada pela I-303, e I-307 em execução com a única rodada concluída. A I-306 concluiu e fica
 * fora.
 */
function cenario(): DatabaseSync {
  const banco = abrir(mkdtempSync(join(base, "raiz-")));
  banco.exec(`INSERT INTO projeto (nome, repo, branch_base, hospedagem, sonar_project_key)
    VALUES ('loja', '/repos/loja', 'main', 'github', 'k')`);
  criarDemanda(banco, demanda("I-300", "registro", { tickets: [ticket("I-300", 1, "demanda", "aberto")] }));
  criarDemanda(
    banco,
    demanda("I-301", "aprovacao_demanda", { tickets: [ticket("I-301", 1, "demanda", "em_execucao")] }),
  );
  criarDemanda(banco, demanda("I-302", "aprovacao_planejamento"));
  criarDemanda(
    banco,
    demanda("I-303", "execucao", {
      rodadas: [
        rodada("I-303", 1, "concluida"),
        rodada("I-303", 2, "aprovacao_pull_request"),
        rodada("I-303", 3, "sessao"),
        rodada("I-303", 4, "desenvolvimento"),
        rodada("I-303", 5, "aprovacao_pull_request"),
      ],
      tickets: [
        ticket("I-303", 1, "implementar", "concluido", { rodada_id: 1 }),
        ticket("I-303", 2, "encerrar_rodada", "concluido", { rodada_id: 2 }),
        ticket("I-303", 3, "sessao_em_aberto", "em_execucao", { rodada_id: 3 }),
        ticket("I-303", 4, "implementar", "aberto", { rodada_id: 4 }),
        ticket("I-303", 5, "implementar", "em_execucao", { rodada_id: 4, titulo: "Busca por cupom" }),
        ticket("I-303", 6, "implementar", "falhou", { rodada_id: 4, motivo_falha: "testes falharam" }),
        ticket("I-303", 7, "implementar", "em_execucao", { rodada_id: 4 }),
      ],
      evidencias: [
        { demanda_id: "I-303", ticket_id: 2, tipo: "pr_aberto", dados: { id: "7", url: "https://pr/7" }, em: em(2) },
      ],
    }),
  );
  criarDemanda(
    banco,
    demanda("I-304", "encerramento", { tickets: [ticket("I-304", 8, "encerrar_demanda", "falhou")] }),
  );
  criarDemanda(banco, demanda("I-305", "revisao_demanda"));
  criarDemanda(banco, demanda("I-306", "concluida"));
  criarDemanda(banco, demanda("I-307", "execucao", { rodadas: [rodada("I-307", 1, "concluida")] }));
  banco.exec(`
    INSERT INTO dependencia_demanda (demanda_id, depende_demanda_id) VALUES ('I-305', 'I-303'), ('I-305', 'I-306');
    INSERT INTO sessao VALUES
      ('s-conversa', 'I-300', 1, 'interativo', 'c1'),
      ('s-ajustes', 'I-303', 3, 'interativo', 'c3'),
      ('s-titulo', 'I-303', 5, 'autonomo', 'c5'),
      ('s-falha', 'I-303', 6, 'autonomo', 'c6'),
      ('s-viva', 'I-303', 7, 'autonomo', 'c7');
    INSERT INTO execucao_sessao (id, sessao_id, inicio, fim, falha) VALUES
      ('x1', 's-conversa', '${em(0)}', '${em(40)}', 0),
      ('x3', 's-ajustes', '${em(0)}', '${em(41)}', 0),
      ('x5', 's-titulo', '${em(30)}', NULL, 0),
      ('x6', 's-falha', '${em(0)}', '${em(6)}', 1),
      ('x7', 's-viva', '${em(31)}', NULL, 0);
  `);
  return banco;
}

const viva = (atividade?: string) => ({
  execucao: "x",
  ocupado: true,
  desde: em(31),
  dialogos: [],
  ...(atividade && { atividade }),
});

test("aguarda: gates, ajustes e falhos da demanda e a conversa parada, da espera mais antiga para a mais nova", () => {
  const { aguarda } = inicio(cenario(), () => undefined);
  const comum = (id: string) => ({ demanda: id, projeto: "loja", titulo: `demanda ${id}` });
  assert.deepEqual(aguarda, [
    {
      motivo: "gate_demanda",
      ...comum("I-301"),
      ticket: { ref: "I-301.T1", etapa: "demanda" },
      desde: "2026-01-01T00:00:00.000Z",
    },
    { motivo: "gate_planejamento", ...comum("I-302"), desde: "2026-01-01T00:00:00.000Z" },
    // A R5 aguarda o PR sem o encerramento da rodada: conta desde a fase da demanda.
    { motivo: "gate_pr", ...comum("I-303"), rodada: "I-303.R5", desde: "2026-01-01T00:00:00.000Z" },
    {
      motivo: "gate_pr",
      ...comum("I-303"),
      rodada: "I-303.R2",
      ticket: { ref: "I-303.T2", etapa: "encerrar_rodada" },
      pr: { id: "7", url: "https://pr/7" },
      desde: em(2),
    },
    {
      motivo: "ajustes",
      ...comum("I-303"),
      rodada: "I-303.R3",
      ticket: { ref: "I-303.T3", etapa: "sessao_em_aberto", modo: "interativo" },
      desde: em(3),
    },
    {
      motivo: "falha",
      ...comum("I-303"),
      rodada: "I-303.R4",
      ticket: { ref: "I-303.T6", etapa: "implementar", modo: "autonomo" },
      erro: "testes falharam",
      desde: em(6),
    },
    { motivo: "falha", ...comum("I-304"), ticket: { ref: "I-304.T8", etapa: "encerrar_demanda" }, desde: em(8) },
    {
      motivo: "conversa",
      ...comum("I-300"),
      ticket: { ref: "I-300.T1", etapa: "demanda", modo: "interativo" },
      sessao: "s-conversa",
      desde: em(40),
    },
  ]);
});

test("rodando: as sessões que rodam com o que o agente faz, ou o título do ticket", () => {
  const banco = cenario();
  const fazendo = (dados: DadosDoInicio) => dados.rodando.map((s) => [s.sessao, s.fazendo]);
  assert.deepEqual(fazendo(inicio(banco, () => undefined)), [
    ["s-titulo", "Busca por cupom"],
    ["s-viva", undefined],
  ]);
  assert.deepEqual(fazendo(inicio(banco, (s) => (s === "s-viva" ? viva("lendo src/cupom.ts") : viva()))), [
    ["s-titulo", "Busca por cupom"],
    ["s-viva", "lendo src/cupom.ts"],
  ]);
});

test("board: um cartão por demanda fora da execução e um por rodada aberta nela, só das em andamento", () => {
  const dados = inicio(cenario(), () => undefined);
  assert.equal(dados.emAndamento, 7);
  assert.deepEqual(
    dados.board.map((c) => [c.coluna, c.ref, c.ticket?.ref, c.ticket?.status, c.ticket?.modo, c.outros, c.bloqueios]),
    [
      ["registro", "I-300", "I-300.T1", "aberto", "interativo", 0, []],
      ["aprovacao_demanda", "I-301", "I-301.T1", "em_execucao", undefined, 0, []],
      ["aprovacao_planejamento", "I-302", undefined, undefined, undefined, 0, []],
      ["aprovacao_pull_request", "I-303.R2", undefined, undefined, undefined, 0, []],
      ["sessao", "I-303.R3", "I-303.T3", "em_execucao", "interativo", 0, []],
      // O em execução e o falho antes do aberto, na ordem dos tickets.
      ["desenvolvimento", "I-303.R4", "I-303.T5", "em_execucao", "autonomo", 3, []],
      ["aprovacao_pull_request", "I-303.R5", undefined, undefined, undefined, 0, []],
      ["encerramento_demanda", "I-304", "I-304.T8", "falhou", undefined, 0, []],
      ["revisao_demanda", "I-305", undefined, undefined, undefined, 0, ["I-303"]],
      // Em execução sem rodada aberta: a demanda inteira no Desenvolvimento, até a revisão abrir.
      ["desenvolvimento", "I-307", undefined, undefined, undefined, 0, []],
    ],
  );
  assert.deepEqual(dados.board[0], {
    coluna: "registro",
    ref: "I-300",
    demanda: "I-300",
    projeto: "loja",
    titulo: "demanda I-300",
    ticket: { ref: "I-300.T1", etapa: "demanda", status: "aberto", modo: "interativo" },
    outros: 0,
    bloqueios: [],
  });
});

test("esperaDaSessao: o diálogo traz a pergunta do processo vivo; a falha e a sessão de ajustes não se repetem", () => {
  const sessao: SessaoDeDemanda = {
    sessao: "s1",
    projeto: "loja",
    demanda: "I-303",
    titulo: "demanda I-303",
    rodada: "I-303.R4",
    ticket: "I-303.T5",
    etapa: "implementar",
    modo: "interativo",
    estado: "aguardando_humano",
    motivo: "dialogo",
    desde: em(9),
    inicio: em(1),
    resultado: "concluida",
  };
  const comPergunta = () => ({
    ...viva(),
    dialogos: [{ type: "extension_ui_request", title: "Qual ordem?", em: em(9) }],
  });
  assert.deepEqual(esperaDaSessao(sessao, comPergunta), [
    {
      motivo: "dialogo",
      demanda: "I-303",
      rodada: "I-303.R4",
      projeto: "loja",
      titulo: "demanda I-303",
      ticket: { ref: "I-303.T5", etapa: "implementar", modo: "interativo" },
      sessao: "s1",
      pergunta: "Qual ordem?",
      desde: em(9),
    },
  ]);
  assert.equal(esperaDaSessao(sessao, () => undefined)[0]?.pergunta, undefined);
  assert.deepEqual(esperaDaSessao({ ...sessao, motivo: "falha" }, comPergunta), []);
  assert.deepEqual(esperaDaSessao({ ...sessao, motivo: "conversa", etapa: "sessao_em_aberto" }, comPergunta), []);
});

test("GET /api/inicio responde com o mês corrente de todos os projetos", async () => {
  const { pedir } = await servir(cenario());
  const r = await pedir("/api/inicio");
  assert.equal(r.status, 200);
  const dados = r.json<DadosDoInicio>();
  const agora = new Date();
  assert.equal(dados.mes.mes, `${String(agora.getFullYear())}-${String(agora.getMonth() + 1).padStart(2, "0")}`);
  assert.equal(dados.mes.projeto, null);
  assert.equal(dados.aguarda.length, 8);
  assert.equal((await pedir("/api/inicio", { cookie: false })).status, 401);
});
