// A consulta do Início: o mês, o que aguarda o Auditor, o que roda e o board das demandas em andamento, sobre um banco real.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { cenarioDoInicio, em, rodada, ticket } from "../../../apoio-testes/cenario_do_inicio.ts";
import { fabricaDeBancosTemporarios } from "../../../apoio-testes/banco_temporario.ts";
import { gravarAgregadoPronto, montarAgregadoDemanda } from "../../../apoio-testes/cenarios_de_demanda.ts";
import { Endereco } from "../../modulos/compartilhado/nucleo/vocabulario_do_sdlc/endereco.ts";
import { relogioDoSistema, relogioFixo } from "../../modulos/compartilhado/nucleo/relogio.ts";
import type { DadosDoInicio } from "../contrato/inicio.ts";
import type { SessaoDeDemanda } from "./sessoes/historico_demanda.ts";
import { consultarInicio } from "./inicio.ts";
import { trabalhoVivoDaSessao } from "./demandas/pendencias.ts";

const abrirBancoTemporario = fabricaDeBancosTemporarios();

function cenario(): DatabaseSync {
  const { banco } = abrirBancoTemporario();
  cenarioDoInicio(banco);
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
  const { aguarda } = consultarInicio(cenario(), relogioDoSistema, () => undefined);
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
    dialogos: [{ type: "extension_ui_request" as const, id: "d", method: "select", title: "Qual ordem?", em: em(9) }],
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
  const tipos = () =>
    consultarInicio(banco, relogioDoSistema, () => undefined).aguarda.map((p) => [p.tipo, p.item, p.motivo, p.desde]);
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
  const aguarda = (agora: string) =>
    consultarInicio(banco, relogioFixo(agora), () => undefined).aguarda.filter((p) => p.demanda === "I-308");
  // A I-308 concluiu a última rodada agora: dentro da tolerância de 2 min, nada aguarda.
  assert.deepEqual(aguarda(new Date().toISOString()), []);
  const daqui3Minutos = new Date(Date.now() + 3 * 60_000).toISOString();
  assert.deepEqual(
    aguarda(daqui3Minutos).map((p) => [p.tipo, p.motivo]),
    [["revisao_parada", "A revisão integral não começou; veja o log do serviço (journalctl --user -u fabriquinha)"]],
  );
  // Sem sonda: a consulta nem conhece a transição que abre a revisão integral (só o agendador a abre).
  assert.doesNotMatch(readFileSync(new URL("./inicio.ts", import.meta.url), "utf8"), /iniciarRevisaoDemanda/);
  assert.equal(
    (banco.prepare("SELECT estado FROM processo_demanda WHERE demanda_id = 'I-308'").get() as { estado: string })
      .estado,
    "em_execucao",
  );
});

test("rodando: as sessões que rodam com o que o agente faz, ou o título do ticket", () => {
  const banco = cenario();
  const fazendo = (dados: DadosDoInicio) => dados.rodando.map((s) => [s.sessao, s.fazendo]);
  assert.deepEqual(fazendo(consultarInicio(banco, relogioDoSistema, () => undefined)), [
    ["s-titulo", "Busca por cupom"],
    ["s-viva", undefined],
  ]);
  assert.deepEqual(
    fazendo(consultarInicio(banco, relogioDoSistema, (s) => (s === "s-viva" ? viva("lendo src/cupom.ts") : viva()))),
    [
      ["s-titulo", "Busca por cupom"],
      ["s-viva", "lendo src/cupom.ts"],
    ],
  );
});

test("board: um cartão por demanda fora da execução e um por rodada aberta nela, só das em andamento", () => {
  const dados = consultarInicio(cenario(), relogioDoSistema, () => undefined);
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
      ["encerrar_demanda", "I-304", "I-304.T8", "falhou", undefined, 0, []],
      ["revisar_demanda", "I-305", undefined, undefined, undefined, 0, ["I-303"]],
      // Em execução sem rodada aberta: a demanda inteira no Desenvolvimento, até a revisão abrir.
      ["implementar", "I-307", undefined, undefined, undefined, 0, []],
      ["implementar", "I-308", undefined, undefined, undefined, 0, []],
      ["implementar", "I-309", undefined, undefined, undefined, 0, []],
    ],
  );
  // Só o ticket com o pi no ar (execução aberta e grupo gravado) marca `pi_ativo`.
  assert.deepEqual(
    dados.board.filter((c) => c.ticket?.pi_ativo).map((c) => c.ticket?.ref),
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
