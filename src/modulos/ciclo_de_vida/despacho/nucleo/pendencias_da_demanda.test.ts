import assert from "node:assert/strict";
import { test } from "node:test";
import { AgregadoDemanda } from "../../processo/nucleo/agregado/agregado_demanda.ts";
import { FABRIQUINHA } from "../../../compartilhado/nucleo/vocabulario_do_sdlc/ator.ts";
import { Endereco } from "../../../compartilhado/nucleo/vocabulario_do_sdlc/endereco.ts";
import {
  type AcaoEsperada,
  motivoDaRevisaoParada,
  type Pendencia,
  type TipoPendencia,
  type TrabalhoVivo,
} from "../../processo/nucleo/agregado/pendencia.ts";
import { pendenciasDaDemanda } from "./pendencias_da_demanda.ts";

const instante = (minuto: number) => new Date(Date.UTC(2026, 0, 1, 0, minuto)).toISOString();
const t0 = instante(0);
const ticket = (ticket_id: number, rodada_id: number | undefined, estado = "aberto", etapa = "implementar") => ({
  demanda_id: "I-1",
  ticket_id,
  rodada_id,
  etapa,
  estado,
  estado_alterado_em: t0,
  criado_por: FABRIQUINHA,
});
const rodada = (rodada_id: number, estado = "implementar", estado_alterado_em = t0) => ({
  demanda_id: "I-1",
  rodada_id,
  titulo: "r",
  estado,
  estado_alterado_em,
  e2e: false,
  branch: `fabriquinha/I-1-${String(rodada_id)}`,
});
const pullRequest = (numero: number, rodada_id?: number) => ({
  numero,
  url: `https://exemplo.test/pr/${String(numero)}`,
  head: "fabriquinha/I-1",
  estado: "aberto" as const,
  atualizado_em: t0,
  rodada_id,
});
const agregado = (estado: string, extra: Record<string, unknown> = {}, estado_alterado_em = t0) =>
  AgregadoDemanda.parse({
    demanda: {
      id: "I-1",
      projeto: "p",
      titulo: "t",
      tipo: "funcionalidade",
      descricao: "d",
      estado,
      estado_alterado_em,
      criada_por: { tipo: "externo", ferramenta: "f", sessao: "s" },
      enviada: true,
      branch: "fabriquinha/I-1",
    },
    decisoes: [],
    evidencias: [],
    tickets: [],
    ...extra,
  });
const aguardandoMerge = {
  demanda_id: "I-1",
  branch: "fabriquinha/I-1",
  base: "main",
  limpeza_pendente: [],
  aguardando_merge_humano: true,
};
const vivo = (ticket_id: number, resto: Partial<TrabalhoVivo> = {}): TrabalhoVivo => ({
  ticket: Endereco.doTicket("I-1", ticket_id),
  desde: instante(7),
  ...resto,
});
const resumo = (pendencias: Pendencia[]) =>
  pendencias.map(({ tipo, item, acao_esperada, desde }) => [tipo, item.toString(), acao_esperada, desde]);

const comAgendadorDesligado = (
  ag: AgregadoDemanda,
  vivos: TrabalhoVivo[] = [],
  prs: AgregadoDemanda["pull_requests"] = [],
) => pendenciasDaDemanda(ag, vivos, prs, false);

test("um caso por tipo: o tipo, o item, a ação esperada e o desde exato", () => {
  const tabela: {
    nome: string;
    pendencias: Pendencia[];
    esperado: [TipoPendencia, string, AcaoEsperada, string, string];
  }[] = [
    {
      nome: "gate da demanda",
      pendencias: pendenciasDaDemanda(agregado("gate_demanda", {}, instante(1)), [], [], true),
      esperado: ["gate_humano", "I-1", "decidir_gate", instante(1), "Aprovação da demanda aguarda decisão"],
    },
    {
      nome: "gate do planejamento",
      pendencias: pendenciasDaDemanda(agregado("gate_planejamento", {}, instante(2)), [], [], true),
      esperado: ["gate_humano", "I-1", "decidir_gate", instante(2), "Aprovação do planejamento aguarda decisão"],
    },
    {
      nome: "gate do PR da rodada",
      pendencias: pendenciasDaDemanda(
        agregado("em_execucao", { rodadas: [rodada(1, "gate_pr", instante(3))] }),
        [],
        [pullRequest(9, 1)],
        true,
      ),
      esperado: ["gate_humano", "I-1.R1", "decidir_gate", instante(3), "PR #9 da rodada aguarda decisão"],
    },
    {
      nome: "gate do PR da rodada sem PR registrado",
      pendencias: pendenciasDaDemanda(
        agregado("em_execucao", { rodadas: [rodada(1, "gate_pr", instante(3))] }),
        [],
        [],
        true,
      ),
      esperado: ["gate_humano", "I-1.R1", "decidir_gate", instante(3), "PR da rodada aguarda decisão"],
    },
    {
      nome: "item bloqueado pelo fim da Tentativa",
      pendencias: pendenciasDaDemanda(
        agregado("em_execucao", {
          rodadas: [rodada(1)],
          tickets: [ticket(1, 1, "falhou")],
          tentativas: [
            {
              ticket: Endereco.doTicket("I-1", 1),
              numero: 1,
              inicio: instante(4),
              fim: instante(5),
              resultado: { tipo: "reprovacao", motivo: "o teste falha" },
            },
          ],
        }),
        [],
        [],
        true,
      ),
      esperado: [
        "item_bloqueado",
        "I-1.T1",
        "reabrir_com_instrucao",
        instante(5),
        "Tentativas esgotadas: o teste falha",
      ],
    },
    {
      nome: "item bloqueado sem Tentativa registrada",
      pendencias: pendenciasDaDemanda(
        agregado("em_execucao", { rodadas: [rodada(1)], tickets: [ticket(1, 1, "falhou")] }),
        [],
        [],
        true,
      ),
      esperado: ["item_bloqueado", "I-1.T1", "reabrir_com_instrucao", t0, "Tentativas esgotadas"],
    },
    {
      nome: "diálogo do agente com a pergunta na hora dela",
      pendencias: pendenciasDaDemanda(
        agregado("em_execucao", { rodadas: [rodada(1)], tickets: [ticket(1, 1, "em_execucao")] }),
        [vivo(1, { pergunta: "Qual ordem?" })],
        [],
        true,
      ),
      esperado: ["dialogo_do_agente", "I-1.T1", "responder", instante(7), "O agente pergunta: Qual ordem?"],
    },
    {
      nome: "conversa da sessão viva",
      pendencias: pendenciasDaDemanda(
        agregado("em_execucao", { rodadas: [rodada(1)], tickets: [ticket(1, 1, "em_execucao")] }),
        [vivo(1)],
        [],
        true,
      ),
      esperado: ["dialogo_do_agente", "I-1.T1", "responder", instante(7), "A conversa da sessão aguarda o Auditor"],
    },
    {
      nome: "Ajustar Resultado aguardando o Auditor",
      pendencias: pendenciasDaDemanda(
        agregado("em_execucao", {
          rodadas: [rodada(1, "ajustar_resultado", instante(8))],
          tickets: [ticket(1, 1, "em_execucao", "ajustar_resultado")],
        }),
        [],
        [],
        true,
      ),
      esperado: [
        "dialogo_do_agente",
        "I-1.R1",
        "responder",
        instante(8),
        "A sessão de ajustes do resultado aguarda o Auditor",
      ],
    },
    {
      nome: "revisão parada há mais de 2 min",
      pendencias: pendenciasDaDemanda(
        agregado("em_execucao", {
          rodadas: [rodada(1, "concluida")],
          tickets: [{ ...ticket(1, 1, "concluido"), estado_alterado_em: instante(9) }],
        }),
        [],
        [],
        true,
        { agora: instante(12) },
      ),
      esperado: [
        "revisao_parada",
        "I-1",
        "reabrir_com_instrucao",
        instante(9),
        "A revisão integral não começou; veja o log do serviço (journalctl --user -u fabriquinha)",
      ],
    },
    {
      nome: "ação externa: merge do PR final",
      pendencias: pendenciasDaDemanda(
        agregado("encerrar_demanda", {
          tickets: [{ ...ticket(1, undefined, "aberto", "encerrar_demanda"), estado_alterado_em: instante(10) }],
          encerramento: aguardandoMerge,
          pull_requests: [pullRequest(11)],
        }),
        [],
        [pullRequest(11)],
        true,
      ),
      esperado: [
        "acao_externa",
        "I-1",
        "integrar_na_plataforma",
        instante(10),
        "Integrar o PR final #11 na plataforma",
      ],
    },
    {
      nome: "ação externa sem ticket nem PR registrados",
      pendencias: pendenciasDaDemanda(
        agregado("encerrar_demanda", { encerramento: aguardandoMerge }, instante(13)),
        [],
        [],
        true,
      ),
      esperado: ["acao_externa", "I-1", "integrar_na_plataforma", instante(13), "Integrar o PR final na plataforma"],
    },
    {
      nome: "despacho parado com o agendador desligado",
      pendencias: comAgendadorDesligado(
        agregado("em_execucao", {
          rodadas: [rodada(1)],
          tickets: [{ ...ticket(1, 1), estado_alterado_em: instante(14) }],
        }),
      ),
      esperado: [
        "despacho_parado",
        "I-1.T1",
        "executar",
        instante(14),
        "Ticket aberto e elegível, com o agendador desligado",
      ],
    },
  ];
  for (const { nome, pendencias, esperado } of tabela) {
    const [tipo, item, acao_esperada, desde, motivo] = esperado;
    assert.deepEqual(
      pendencias.map((p) => ({ ...p, item: p.item.toString() })),
      [{ tipo, item, motivo, acao_esperada, desde }],
      nome,
    );
  }
});

test("o mesmo ticket com o agendador ligado não gera despacho_parado", () => {
  const ag = agregado("em_execucao", { rodadas: [rodada(1)], tickets: [ticket(1, 1)] });
  assert.equal(comAgendadorDesligado(ag).length, 1);
  assert.deepEqual(pendenciasDaDemanda(ag, [], [], true), []);
});

test("esperar Dependência devolve lista vazia, da demanda predecessora e do ticket", () => {
  const planejar = agregado("planejar", { tickets: [ticket(1, undefined, "aberto", "planejar")] });
  assert.equal(comAgendadorDesligado(planejar).length, 1);
  assert.deepEqual(pendenciasDaDemanda(planejar, [], [], false, { predecessorasSatisfeitas: false }), []);
  const ticketsEncadeados = agregado("em_execucao", {
    rodadas: [rodada(1)],
    tickets: [ticket(1, 1, "em_execucao"), ticket(2, 1)],
    dependencias_ticket: [{ demanda_id: "I-1", ticket_id: 2, depende_ticket_id: 1 }],
  });
  assert.deepEqual(comAgendadorDesligado(ticketsEncadeados), []);
});

test("a ordem é a das regras: gate, ajustes, bloqueio, diálogo e despacho", () => {
  const ag = agregado(
    "em_execucao",
    {
      rodadas: [rodada(1, "gate_pr", instante(20)), rodada(2, "ajustar_resultado", instante(21)), rodada(3), rodada(4)],
      tickets: [ticket(1, 3, "falhou"), ticket(2, 3, "em_execucao"), ticket(3, 4)],
    },
    t0,
  );
  const pendencias = pendenciasDaDemanda(ag, [vivo(2)], [], false);
  assert.deepEqual(resumo(pendencias), [
    ["gate_humano", "I-1.R1", "decidir_gate", instante(20)],
    ["dialogo_do_agente", "I-1.R2", "responder", instante(21)],
    ["item_bloqueado", "I-1.T1", "reabrir_com_instrucao", t0],
    ["dialogo_do_agente", "I-1.T2", "responder", instante(7)],
    ["despacho_parado", "I-1.T3", "executar", t0],
  ]);
});

test("a sessão viva do ticket de ajustes substitui a Pendência da rodada; trabalho de outra demanda é ignorado", () => {
  const ag = agregado("em_execucao", {
    rodadas: [rodada(1, "ajustar_resultado")],
    tickets: [ticket(1, 1, "em_execucao", "ajustar_resultado")],
  });
  const deOutraDemanda: TrabalhoVivo = { ticket: Endereco.doTicket("I-2", 1), desde: instante(7) };
  assert.deepEqual(resumo(pendenciasDaDemanda(ag, [vivo(1, { pergunta: "Posso?" }), deOutraDemanda], [], true)), [
    ["dialogo_do_agente", "I-1.T1", "responder", instante(7)],
  ]);
});

test("ao esperar o merge, o encerrar_demanda aberto não vira despacho_parado", () => {
  const ag = agregado("encerrar_demanda", {
    tickets: [ticket(1, undefined, "aberto", "encerrar_demanda")],
    encerramento: aguardandoMerge,
  });
  assert.deepEqual(
    comAgendadorDesligado(ag).map((p) => p.tipo),
    ["acao_externa"],
  );
});

test("motivoDaRevisaoParada: parada além da tolerância, rejeitada pela regra, ou ainda dentro do prazo", () => {
  const parada = agregado("em_execucao", {
    rodadas: [rodada(1, "concluida")],
    tickets: [{ ...ticket(1, 1, "concluido"), estado_alterado_em: instante(9) }],
  });
  assert.equal(motivoDaRevisaoParada(parada, instante(10))?.motivo, undefined);
  assert.equal(motivoDaRevisaoParada(parada, instante(11))?.desde, instante(9));
  const comTicketCancelado = agregado("em_execucao", {
    rodadas: [rodada(1, "concluida")],
    tickets: [ticket(1, 1, "cancelado")],
  });
  assert.equal(
    motivoDaRevisaoParada(comTicketCancelado, instante(30))?.motivo,
    "A revisão integral foi rejeitada: o ticket 1 está cancelado (conclua todo o trabalho pendente antes da revisão integral)",
  );
});

test("motivoDaRevisaoParada: nada quando a demanda não está pronta para a revisão", () => {
  const agora = instante(60);
  const fechado = ticket(1, 1, "concluido");
  assert.equal(
    motivoDaRevisaoParada(agregado("revisar_demanda", { rodadas: [rodada(1, "concluida")] }), agora),
    undefined,
  );
  assert.equal(motivoDaRevisaoParada(agregado("em_execucao"), agora), undefined);
  assert.equal(
    motivoDaRevisaoParada(agregado("em_execucao", { rodadas: [rodada(1, "implementar")], tickets: [fechado] }), agora),
    undefined,
  );
  assert.equal(
    motivoDaRevisaoParada(
      agregado("em_execucao", { rodadas: [rodada(1, "concluida")], tickets: [ticket(1, 1, "aberto")] }),
      agora,
    ),
    undefined,
  );
});
