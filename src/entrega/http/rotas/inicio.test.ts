// Rota do Início: o mês, o que aguarda o Auditor, o que roda e o board das demandas em andamento, sobre um banco real.
import { Endereco } from "../../../nucleo/item_de_trabalho.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { fabricaDeBancosTemporarios } from "../../../../apoio-testes/banco_temporario.ts";
import { cicloDoDespacho } from "../../../aplicacao/despacho.ts";
import type { SessaoDeDemanda } from "../../../aplicacao/historico_demanda.ts";
import { configuracao } from "../../../armazenamento/servico.ts";
import { gravarAgregadoPronto, montarAgregadoDemanda } from "../../../../apoio-testes/cenarios_de_demanda.ts";
import { servir } from "../../../../apoio-testes/servidor_web_de_teste.ts";
import { type DadosDoInicio, inicio, trabalhoVivoDaSessao } from "./inicio.ts";

const abrirBancoTemporario = fabricaDeBancosTemporarios();

const em = (minuto: number) => `2026-01-01T00:${String(minuto).padStart(2, "0")}:00.000Z`;

const ticket = (demanda_id: string, ticket_id: number, etapa: string, status: string, extra: object = {}) => ({
  demanda_id,
  ticket_id,
  etapa,
  estado: status,
  estado_alterado_em: em(ticket_id),
  criado_por: { tipo: "fabriquinha" },
  ...extra,
});

const rodada = (demanda_id: string, rodada_id: number, estado: string) => ({
  demanda_id,
  rodada_id,
  titulo: `rodada ${String(rodada_id)}`,
  estado,
  estado_alterado_em: "2026-01-01T00:00:00.000Z",
  e2e: false,
  branch: `fabriquinha/${demanda_id}-${String(rodada_id)}`,
});

/**
 * Uma demanda em cada lugar do board: I-300 no registro (com a conversa interativa parada), I-301 e I-302 nos gates da
 * demanda e do plano, I-303 em execução com uma rodada em cada estado, I-304 no encerramento com o ticket global falho e
 * I-305 na revisão, bloqueada pela I-303, e I-307 em execução com a única rodada concluída. A I-306 concluiu e fica
 * fora.
 */
function cenario(): DatabaseSync {
  const { banco } = abrirBancoTemporario();
  banco.exec(`INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube)
    VALUES ('loja', '/repos/loja', 'main', 'github', 'k')`);
  gravarAgregadoPronto(
    banco,
    montarAgregadoDemanda("I-300", "entender_e_desenhar", {
      tickets: [ticket("I-300", 1, "entender_e_desenhar", "aberto")],
    }),
  );
  gravarAgregadoPronto(
    banco,
    montarAgregadoDemanda("I-301", "gate_demanda", {
      tickets: [ticket("I-301", 1, "entender_e_desenhar", "em_execucao")],
    }),
  );
  gravarAgregadoPronto(banco, montarAgregadoDemanda("I-302", "gate_planejamento"));
  gravarAgregadoPronto(
    banco,
    montarAgregadoDemanda("I-303", "em_execucao", {
      rodadas: [
        rodada("I-303", 1, "concluida"),
        rodada("I-303", 2, "gate_pr"),
        rodada("I-303", 3, "ajustar_resultado"),
        rodada("I-303", 4, "implementar"),
        rodada("I-303", 5, "gate_pr"),
      ],
      tickets: [
        ticket("I-303", 1, "implementar", "concluido", { rodada_id: 1 }),
        ticket("I-303", 2, "encerrar_rodada", "concluido", { rodada_id: 2 }),
        ticket("I-303", 3, "ajustar_resultado", "em_execucao", { rodada_id: 3 }),
        ticket("I-303", 4, "implementar", "aberto", { rodada_id: 4 }),
        ticket("I-303", 5, "implementar", "em_execucao", { rodada_id: 4, titulo: "Busca por cupom" }),
        ticket("I-303", 6, "implementar", "falhou", { rodada_id: 4 }),
        ticket("I-303", 7, "implementar", "em_execucao", { rodada_id: 4 }),
      ],
      tentativas: [
        {
          ticket: Endereco.doTicket("I-303", 6),
          numero: 1,
          inicio: em(0),
          fim: em(6),
          processo_id: "x6",
          resultado: { tipo: "interrompida", por: { tipo: "fabriquinha" }, motivo: "testes falharam" },
        },
      ],
      evidencias: [
        {
          demanda_id: "I-303",
          ticket_id: 2,
          tipo: "pr_aberto",
          autor: { tipo: "fabriquinha" },
          dados: { id: "7", url: "https://pr/7" },
          em: em(2),
        },
      ],
      pull_requests: [
        { rodada_id: 1, numero: 6, url: "https://pr/6", head: "abc", estado: "integrado", atualizado_em: em(2) },
        { rodada_id: 2, numero: 7, url: "https://pr/7", head: "abc", estado: "aberto", atualizado_em: em(2) },
      ],
    }),
  );
  gravarAgregadoPronto(
    banco,
    montarAgregadoDemanda("I-304", "encerrar_demanda", { tickets: [ticket("I-304", 8, "encerrar_demanda", "falhou")] }),
  );
  gravarAgregadoPronto(banco, montarAgregadoDemanda("I-305", "revisar_demanda"));
  gravarAgregadoPronto(banco, montarAgregadoDemanda("I-306", "concluida"));
  // I-307: rodadas concluídas, mas a regra recusa a revisão integral pela implementação cancelada.
  gravarAgregadoPronto(
    banco,
    montarAgregadoDemanda("I-307", "em_execucao", {
      rodadas: [rodada("I-307", 1, "concluida")],
      tickets: [
        ticket("I-307", 1, "implementar", "concluido", { rodada_id: 1 }),
        ticket("I-307", 9, "implementar", "cancelado", { rodada_id: 1 }),
      ],
    }),
  );
  // I-308 acabou de concluir a última rodada (o agendador ainda tem o ciclo); I-309 a regra aceita, mas nada abriu.
  for (const [id, quando] of [
    ["I-308", new Date().toISOString()],
    ["I-309", em(10)],
  ] as const) {
    gravarAgregadoPronto(
      banco,
      montarAgregadoDemanda(id, "em_execucao", {
        rodadas: [rodada(id, 1, "concluida")],
        tickets: [
          ticket(id, 1, "implementar", "concluido", { rodada_id: 1, estado_alterado_em: quando }),
          ticket(id, 2, "implementar", "concluido", { rodada_id: 1, estado_alterado_em: em(1) }),
        ],
      }),
    );
  }
  banco.exec(`
    INSERT INTO dependencia_demanda (demanda_id, depende_demanda_id) VALUES ('I-305', 'I-303'), ('I-305', 'I-306');
    INSERT INTO trabalho_agentico VALUES
      ('s-conversa', 'I-300', 1, 'interativo', 'c1'),
      ('s-ajustes', 'I-303', 3, 'interativo', 'c3'),
      ('s-titulo', 'I-303', 5, 'autonomo', 'c5'),
      ('s-falha', 'I-303', 6, 'autonomo', 'c6'),
      ('s-viva', 'I-303', 7, 'autonomo', 'c7');
    INSERT INTO processo_do_trabalho (id, trabalho_id, inicio, fim, falha, grupo_processo) VALUES
      ('x1', 's-conversa', '${em(0)}', '${em(40)}', 0, NULL),
      ('x3', 's-ajustes', '${em(0)}', '${em(41)}', 0, NULL),
      ('x5', 's-titulo', '${em(30)}', NULL, 0, 4242),
      ('x6', 's-falha', '${em(0)}', '${em(6)}', 1, NULL),
      ('x7', 's-viva', '${em(31)}', NULL, 0, NULL);
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

test("aguarda: as Pendências da regra única, da mais antiga para a mais nova", () => {
  const { aguarda } = inicio(cenario(), () => undefined);
  const comum = (id: string) => ({ demanda: id, projeto: "loja", titulo: `demanda ${id}` });
  const inicioDosTempos = "2026-01-01T00:00:00.000Z";
  assert.deepEqual(aguarda, [
    {
      tipo: "gate_humano",
      item: "I-301",
      motivo: "Aprovação da demanda aguarda decisão",
      acao_esperada: "decidir_gate",
      desde: inicioDosTempos,
      ...comum("I-301"),
    },
    {
      tipo: "gate_humano",
      item: "I-302",
      motivo: "Aprovação do planejamento aguarda decisão",
      acao_esperada: "decidir_gate",
      desde: inicioDosTempos,
      ...comum("I-302"),
    },
    {
      tipo: "gate_humano",
      item: "I-303.R2",
      motivo: "PR #7 da rodada aguarda decisão",
      acao_esperada: "decidir_gate",
      desde: inicioDosTempos,
      ...comum("I-303"),
      rodada: "I-303.R2",
    },
    {
      tipo: "gate_humano",
      item: "I-303.R5",
      motivo: "PR da rodada aguarda decisão",
      acao_esperada: "decidir_gate",
      desde: inicioDosTempos,
      ...comum("I-303"),
      rodada: "I-303.R5",
    },
    {
      tipo: "item_bloqueado",
      item: "I-303.T6",
      motivo: "Tentativas esgotadas: testes falharam",
      acao_esperada: "reabrir_com_instrucao",
      desde: em(6),
      ...comum("I-303"),
      rodada: "I-303.R4",
    },
    {
      tipo: "item_bloqueado",
      item: "I-304.T8",
      motivo: "Tentativas esgotadas",
      acao_esperada: "reabrir_com_instrucao",
      desde: em(8),
      ...comum("I-304"),
    },
    {
      tipo: "revisao_parada",
      item: "I-307",
      motivo:
        "A revisão integral foi rejeitada: o ticket 9 está cancelado (conclua todo o trabalho pendente antes da revisão integral)",
      acao_esperada: "reabrir_com_instrucao",
      desde: em(9),
      ...comum("I-307"),
    },
    {
      tipo: "revisao_parada",
      item: "I-309",
      motivo: "A revisão integral não começou; veja o log do serviço (journalctl --user -u fabriquinha)",
      acao_esperada: "reabrir_com_instrucao",
      desde: em(10),
      ...comum("I-309"),
    },
    {
      tipo: "dialogo_do_agente",
      item: "I-300.T1",
      motivo: "A conversa da sessão aguarda o Auditor",
      acao_esperada: "responder",
      desde: em(40),
      ...comum("I-300"),
      sessao: "s-conversa",
    },
    // A sessão de ajustes da R3 tem a conversa viva, e ela é a Pendência da rodada.
    {
      tipo: "dialogo_do_agente",
      item: "I-303.T3",
      motivo: "A conversa da sessão aguarda o Auditor",
      acao_esperada: "responder",
      desde: em(41),
      ...comum("I-303"),
      rodada: "I-303.R3",
      sessao: "s-ajustes",
    },
  ]);
});

test("trabalhoVivoDaSessao: o diálogo traz a pergunta do processo vivo; a conversa, não", () => {
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
    pendencia: {
      tipo: "dialogo_do_agente",
      item: "I-303.T5",
      motivo: "O agente pergunta: Qual ordem?",
      acao_esperada: "responder",
      desde: em(9),
    },
    desde: em(9),
    inicio: em(1),
    resultado: "concluida",
  };
  const comPergunta = () => ({
    ...viva(),
    dialogos: [{ type: "extension_ui_request", title: "Qual ordem?", em: em(9) }],
  });
  assert.deepEqual(trabalhoVivoDaSessao(sessao, comPergunta), {
    ticket: Endereco.doTicket("I-303", 5),
    pergunta: "Qual ordem?",
    desde: em(9),
  });
  assert.equal(trabalhoVivoDaSessao(sessao, () => undefined).pergunta, undefined);
});

test("aguarda: o merge final do PR da demanda e o despacho parado com o agendador desligado", () => {
  const { banco } = abrirBancoTemporario();
  banco.exec(`INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube)
    VALUES ('loja', '/repos/loja', 'main', 'github', 'k')`);
  gravarAgregadoPronto(
    banco,
    montarAgregadoDemanda("I-310", "encerrar_demanda", {
      tickets: [ticket("I-310", 1, "encerrar_demanda", "aberto")],
      encerramento: {
        demanda_id: "I-310",
        branch: "fabriquinha/I-310",
        base: "main",
        limpeza_pendente: [],
        aguardando_merge_humano: true,
      },
      pull_requests: [{ numero: 12, url: "https://pr/12", head: "abc", estado: "aberto", atualizado_em: em(2) }],
    }),
  );
  gravarAgregadoPronto(
    banco,
    montarAgregadoDemanda("I-311", "em_execucao", {
      rodadas: [rodada("I-311", 1, "implementar")],
      tickets: [ticket("I-311", 5, "implementar", "aberto", { rodada_id: 1 })],
    }),
  );
  const tipos = () => inicio(banco, () => undefined).aguarda.map((p) => [p.tipo, p.item, p.motivo, p.desde]);
  assert.deepEqual(tipos(), [
    ["acao_externa", "I-310", "Integrar o PR final #12 na plataforma", em(1)],
    ["despacho_parado", "I-311.T5", "Ticket aberto e elegível, com o agendador desligado", em(5)],
  ]);
  banco.exec("UPDATE configuracao SET agendador_ativo = 1");
  assert.deepEqual(
    tipos().map(([tipo]) => tipo),
    ["acao_externa"],
  );
});

test("aguarda: a revisão parada vem da regra pura, com o agora do teste e sem abrir a revisão", () => {
  const banco = cenario();
  const aguarda = (agora: Date) => inicio(banco, () => undefined, agora).aguarda.filter((p) => p.demanda === "I-308");
  // A I-308 concluiu a última rodada agora: dentro da tolerância de 2 min, nada aguarda.
  assert.deepEqual(aguarda(new Date()), []);
  const daqui3Minutos = new Date(Date.now() + 3 * 60_000);
  assert.deepEqual(
    aguarda(daqui3Minutos).map((p) => [p.tipo, p.motivo]),
    [["revisao_parada", "A revisão integral não começou; veja o log do serviço (journalctl --user -u fabriquinha)"]],
  );
  // Sem sonda: a rota nem conhece a transição que abre a revisão integral (só o agendador a abre).
  assert.doesNotMatch(readFileSync(new URL("./inicio.ts", import.meta.url), "utf8"), /iniciarRevisaoDemanda/);
  assert.equal(
    (banco.prepare("SELECT estado FROM demanda WHERE id = 'I-308'").get() as { estado: string }).estado,
    "em_execucao",
  );
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
  assert.equal(dados.quantidadeEmAndamento, 9);
  assert.deepEqual(
    dados.board.map((c) => [c.coluna, c.ref, c.ticket?.ref, c.ticket?.estado, c.ticket?.modo, c.outros, c.bloqueios]),
    [
      ["entender_e_desenhar", "I-300", "I-300.T1", "aberto", "interativo", 0, []],
      ["gate_demanda", "I-301", "I-301.T1", "em_execucao", undefined, 0, []],
      ["gate_planejamento", "I-302", undefined, undefined, undefined, 0, []],
      ["gate_pr", "I-303.R2", undefined, undefined, undefined, 0, []],
      ["ajustar_resultado", "I-303.R3", "I-303.T3", "em_execucao", "interativo", 0, []],
      // O em execução e o falho antes do aberto, na ordem dos tickets.
      ["implementar", "I-303.R4", "I-303.T5", "em_execucao", "autonomo", 3, []],
      ["gate_pr", "I-303.R5", undefined, undefined, undefined, 0, []],
      ["encerramento_demanda", "I-304", "I-304.T8", "falhou", undefined, 0, []],
      ["revisar_demanda", "I-305", undefined, undefined, undefined, 0, ["I-303"]],
      // Em execução sem rodada aberta: a demanda inteira no Desenvolvimento, até a revisão abrir.
      ["implementar", "I-307", undefined, undefined, undefined, 0, []],
      ["implementar", "I-308", undefined, undefined, undefined, 0, []],
      ["implementar", "I-309", undefined, undefined, undefined, 0, []],
    ],
  );
  // Só o ticket com o pi no ar (execução aberta e grupo gravado) marca `piAtivo`.
  assert.deepEqual(
    dados.board.filter((c) => c.ticket?.piAtivo).map((c) => c.ticket?.ref),
    ["I-303.T5"],
  );
  assert.deepEqual(dados.board[0], {
    coluna: "entender_e_desenhar",
    ref: "I-300",
    demanda: "I-300",
    projeto: "loja",
    titulo: "demanda I-300",
    ticket: { ref: "I-300.T1", etapa: "entender_e_desenhar", estado: "aberto", modo: "interativo" },
    outros: 0,
    bloqueios: [],
  });
});

test("GET /api/inicio responde com o mês corrente de todos os projetos", async () => {
  const { pedir } = await servir(cenario());
  const r = await pedir("/api/inicio");
  assert.equal(r.status, 200);
  const dados = r.json<DadosDoInicio>();
  const agora = new Date();
  assert.equal(dados.mes.mes, `${String(agora.getFullYear())}-${String(agora.getMonth() + 1).padStart(2, "0")}`);
  assert.equal(dados.mes.projeto, null);
  assert.equal(dados.aguarda.length, 10);
  assert.equal((await pedir("/api/inicio", { cookie: false })).status, 401);
});

test("GET /api/despacho devolve as recusas do último ciclo, com os endereços em texto", async () => {
  const banco = cenario();
  const { pedir } = await servir(banco);
  assert.deepEqual((await pedir("/api/despacho")).json(), { recusas: [] });
  await Promise.all(cicloDoDespacho(banco, configuracao(banco)));
  const { recusas } = (await pedir("/api/despacho")).json<{ recusas: { item: string; motivo: unknown }[] }>();
  assert.deepEqual(
    recusas.find((r) => r.item === "I-303.T4"),
    { item: "I-303.T4", motivo: { tipo: "ocupado", por: "I-303.T5" } },
  );
  assert.equal((await pedir("/api/despacho", { cookie: false })).status, 401);
});

test("GET /api/inicio: o custo do mês sai no texto do Uso somado, com ≥ e o aviso quando uma sessão não trouxe custo", async () => {
  const banco = cenario();
  const agoraIso = new Date().toISOString();
  banco.exec(`
    INSERT INTO processo_do_trabalho (id, trabalho_id, inicio, fim, falha) VALUES
      ('xu1', 's-conversa', '${agoraIso}', '${agoraIso}', 0),
      ('xu2', 's-ajustes', '${agoraIso}', '${agoraIso}', 0);
    INSERT INTO uso_modelo_execucao VALUES ('xu1', 'p', 'm', 10, 1, 0, 0, 4.2), ('xu2', 'p', 'm', 5, 1, 0, 0, NULL);`);
  const { pedir } = await servir(banco);
  const { mes } = (await pedir("/api/inicio")).json<DadosDoInicio>();
  assert.equal(mes.total.textoDoCusto, "≥ US$ 4,20 (1 sessão sem custo)");
  assert.equal(mes.total.modelos[0]?.tokens_entrada, 15);
});

test("GET /api/inicio: o Uso declarado soma ao medido do mês, e a sessão declarada sem custo traz o ≥", async () => {
  const banco = cenario();
  const agoraIso = new Date().toISOString();
  banco.exec(`
    UPDATE demanda SET estado_alterado_em = '${agoraIso}' WHERE id = 'I-300';
    INSERT INTO processo_do_trabalho (id, trabalho_id, inicio, fim, falha) VALUES ('xu1', 's-conversa', '${agoraIso}', '${agoraIso}', 0);
    INSERT INTO uso_modelo_execucao VALUES ('xu1', 'p', 'm', 10, 1, 0, 0, 4.2);`);
  const declarar = (sessao: string, custo: string) => {
    banco.exec(`INSERT INTO uso_declarado VALUES ('claude', '${sessao}', 'I-300', json_array(json_object(
      'modelo', 'p/m', 'tokens_entrada', 5, 'tokens_saida', 1, 'tokens_cache_leitura', 0, 'tokens_cache_escrita', 0,
      'custo', ${custo}, 'chamadas', 0)))`);
  };
  declarar("d1", "1.8");
  const { pedir } = await servir(banco);
  const comCusto = (await pedir("/api/inicio")).json<DadosDoInicio>().mes.total;
  assert.equal(comCusto.textoDoCusto, "US$ 6,00");
  assert.equal(comCusto.modelos[0]?.tokens_entrada, 15);
  declarar("d2", "NULL");
  const totalComSessaoSemCusto = (await pedir("/api/inicio")).json<DadosDoInicio>().mes.total;
  assert.equal(totalComSessaoSemCusto.textoDoCusto, "≥ US$ 6,00 (1 sessão sem custo)");
});
