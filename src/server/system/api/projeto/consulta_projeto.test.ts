import { CATALOGO_DO_CICLO_DE_VIDA } from "../../../../../apoio-testes/ciclo_de_vida/ciclo_de_vida_de_teste.ts";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { fabricaDeBancosTemporarios } from "../../../../../apoio-testes/banco/banco_temporario.ts";
import {
  gravarAgregadoPronto,
  INSTANTE_DO_CENARIO,
  montarAgregadoDemanda,
  montarRodada,
  montarTicket,
} from "../../../../../apoio-testes/cenarios/cenarios_de_demanda.ts";
import { Projeto } from "../../../../modulos/demandas/publico.ts";
import { relogioFixo } from "../../../../shared/nucleo/relogio.ts";
import { ListaDoProjeto } from "../contrato/projeto.ts";
import { consultarProjeto, estadoNaLinhaDoTempo } from "./consulta_projeto.ts";
import { montarCicloDeVidaDoBanco, montarDemandasDoBanco } from "../../banco_da_fabriquinha.ts";
import { gravarProjeto, registrarProjeto } from "../../../../../apoio-testes/demandas_de_teste.ts";

const abrirBancoTemporario = fabricaDeBancosTemporarios();
const relogio = relogioFixo("2026-01-01T00:00:00.000Z");
const semSessaoViva = () => undefined;
const SEM_FILTRO = { concluidas: false, arquivadas: false, canceladas: false };

function bancoComProjetos(...nomes: string[]): DatabaseSync {
  const { banco } = abrirBancoTemporario();
  for (const nome of nomes) {
    registrarProjeto(banco, {
      nome,
      raiz_git: `/repos/${nome}`,
      branch_base: "main",
      hospedagem: "github",
      chave_sonarqube: nome,
    });
  }
  return banco;
}

const consultar = (banco: DatabaseSync, nome: string, filtro: Partial<typeof SEM_FILTRO> = {}) =>
  consultarProjeto(
    banco,
    montarCicloDeVidaDoBanco(banco),
    montarDemandasDoBanco(banco),
    nome,
    { ...SEM_FILTRO, ...filtro },
    relogio,
    semSessaoViva,
  );

const concluido = (demanda_id: string, ticket_id: number, etapa: string, extra: object = {}) =>
  montarTicket(demanda_id, ticket_id, etapa, { estado: "concluido", ...extra });

/**
 * loja: I-203 arquivada, I-204 concluída, I-205 cancelada, I-206 em execução (R1 concluída com o PR 7, R2 em
 * desenvolvimento) e I-207 em planejamento, dependente das três últimas. A etapa `implementar` tem modelo no projeto.
 */
function semearDemandas(banco: DatabaseSync): void {
  gravarProjeto(
    banco,
    Projeto.parse({
      nome: "loja",
      branch_base: "main",
      chave_sonarqube: "loja",
      raiz_git: "/repos/loja",
      hospedagem: "github",
      verificacoes: {
        fitness: [{ nome: "f", comando: "true", descricao: "d" }],
        linguagens: [{ caminho: ".", linguagem: "ts", comando_teste: "true" }],
      },
      etapas: [
        { etapa: "implementar", configuracao_agente: { modelo: { provedor: "anthropic", nome: "claude-sonnet-5-5" } } },
      ],
    }),
  );
  gravarAgregadoPronto(banco, montarAgregadoDemanda("I-203", "arquivada"));
  gravarAgregadoPronto(banco, montarAgregadoDemanda("I-204", "concluida"));
  gravarAgregadoPronto(banco, montarAgregadoDemanda("I-205", "cancelada"));
  gravarAgregadoPronto(
    banco,
    montarAgregadoDemanda("I-206", "em_execucao", {
      rodadas: [montarRodada("I-206", 1, "concluida"), montarRodada("I-206", 2, "implementar")],
      tickets: [
        concluido("I-206", 1, "planejar"),
        concluido("I-206", 2, "implementar", { rodada_id: 1, titulo: "Cache" }),
        concluido("I-206", 3, "encerrar_rodada", { rodada_id: 1 }),
        concluido("I-206", 4, "implementar", {
          rodada_id: 2,
          estado: "em_execucao",
          configuracao_agente: { modelo: { provedor: "llamacpp", nome: "qwen3-coder-30b" } },
        }),
      ],
      evidencias: [
        {
          demanda_id: "I-206",
          ticket_id: 3,
          tipo: "pr_aberto",
          autor: { tipo: "fabriquinha" },
          dados: { id: "7", url: "https://pr/7" },
          em: INSTANTE_DO_CENARIO,
        },
      ],
      pull_requests: [
        {
          rodada_id: 1,
          numero: 7,
          url: "https://pr/7",
          head: "abc",
          estado: "integrado",
          atualizado_em: INSTANTE_DO_CENARIO,
        },
        {
          rodada_id: 2,
          numero: 8,
          url: "https://pr/8",
          head: "def",
          estado: "aberto",
          atualizado_em: INSTANTE_DO_CENARIO,
        },
      ],
    }),
  );
  banco.exec(
    `INSERT INTO trabalho_agentico VALUES ('s-antiga', 'I-206', 4, 'autonomo', 'c1'), ('s-nova', 'I-206', 4, 'autonomo', 'c2');
    INSERT INTO processo_do_trabalho (id, trabalho_id, inicio, fim, falha, grupo_processo) VALUES
      ('e-antiga', 's-antiga', '${INSTANTE_DO_CENARIO}', '${INSTANTE_DO_CENARIO}', 0, 4241),
      ('e-nova', 's-nova', '${INSTANTE_DO_CENARIO}', NULL, 0, 4242)`,
  );
  gravarAgregadoPronto(banco, montarAgregadoDemanda("I-207", "planejar"));
  banco.exec(`INSERT INTO dependencia_demanda (demanda_id, depende_demanda_id)
    VALUES ('I-207', 'I-206'), ('I-207', 'I-205'), ('I-207', 'I-204')`);
}

/** O projeto `nome` com `quantas` demandas em andamento, cada uma dependente da primeira e com um ticket e uma rodada. */
function projetoComDemandas(nome: string, quantas: number, banco: DatabaseSync, primeiroId: number): void {
  for (let i = 0; i < quantas; i++) {
    const id = `I-${String(primeiroId + i)}`;
    gravarAgregadoPronto(
      banco,
      montarAgregadoDemanda(id, "gate_planejamento", {
        rodadas: [montarRodada(id, 1, "implementar")],
        tickets: [montarTicket(id, 1, "planejar"), montarTicket(id, 2, "implementar", { rodada_id: 1 })],
      }),
    );
    banco.prepare("UPDATE demanda SET projeto = ? WHERE id = ?").run(nome, id);
    if (i > 0) {
      banco
        .prepare("INSERT INTO dependencia_demanda (demanda_id, depende_demanda_id) VALUES (?, ?)")
        .run(id, `I-${String(primeiroId)}`);
    }
  }
}

/** Quantas vezes `consulta` pede ao banco para preparar um SQL. */
function contarPrepare(banco: DatabaseSync, consulta: () => unknown): number {
  const original = banco.prepare.bind(banco);
  let chamadas = 0;
  banco.prepare = (sql) => {
    chamadas++;
    return original(sql);
  };
  try {
    consulta();
  } finally {
    // @ts-expect-error devolve a função do protótipo, apagando a que o teste pôs na instância
    delete banco.prepare;
  }
  return chamadas;
}

test("CA-5: consultarProjeto prepara o mesmo número de SQL com 1 e com 20 demandas", () => {
  const banco = bancoComProjetos("loja", "um", "vinte");
  projetoComDemandas("um", 1, banco, 1);
  projetoComDemandas("vinte", 20, banco, 100);
  consultar(banco, "um"); // a 1ª consulta do processo prepara a mais o que as seguintes reaproveitam
  const preparosComUma = contarPrepare(banco, () => consultar(banco, "um"));
  const preparosComVinte = contarPrepare(banco, () => consultar(banco, "vinte"));
  assert.equal(preparosComVinte, preparosComUma);
  assert.equal(consultar(banco, "vinte").demandas.length, 20);
});

test("as em andamento, das mais novas às mais antigas, com a contagem de todas, e o contrato cumprido", () => {
  const banco = bancoComProjetos("loja", "site");
  semearDemandas(banco);
  const lista = consultar(banco, "loja");
  assert.deepEqual(
    lista.demandas.map((d) => d.id),
    ["I-207", "I-206"],
  );
  assert.deepEqual(lista.contagem, { andamento: 2, concluidas: 1, arquivadas: 1, canceladas: 1 });
  // Bloqueiam as predecessoras que não satisfazem a Dependência, pela regra única: a concluída não bloqueia.
  assert.deepEqual(lista.demandas[0]?.bloqueadaPor, ["I-206", "I-205"]);
  assert.deepEqual(ListaDoProjeto.parse(lista), lista);
  assert.deepEqual(consultar(banco, "site"), {
    demandas: [],
    contagem: { andamento: 0, concluidas: 0, arquivadas: 0, canceladas: 0 },
  });
  assert.equal(banco.isTransaction, false);
});

test("as rodadas trazem o PR e os tickets o modelo efetivo, a sessão mais recente e o pi ativo", () => {
  const banco = bancoComProjetos("loja");
  semearDemandas(banco);
  const i206 = consultar(banco, "loja").demandas[1];
  assert.ok(i206);
  assert.deepEqual(
    [i206.titulo, i206.tipo, i206.estado, i206.estadoAlteradoEm],
    ["demanda I-206", "funcionalidade", "em_execucao", INSTANTE_DO_CENARIO],
  );
  assert.deepEqual(i206.rodadas, [
    { ref: "I-206.R1", titulo: "rodada 1", estado: "concluida", pr: { id: "7", url: "https://pr/7" } },
    { ref: "I-206.R2", titulo: "rodada 2", estado: "implementar", pr: { id: "8", url: "https://pr/8" } },
  ]);
  const comum = { terminal: true, satisfazDependencia: true, estadoAlteradoEm: INSTANTE_DO_CENARIO };
  assert.deepEqual(i206.tickets, [
    { ref: "I-206.T1", etapa: "planejar", estado: "concluido", ...comum },
    {
      ref: "I-206.T2",
      etapa: "implementar",
      estado: "concluido",
      ...comum,
      rodada: "I-206.R1",
      titulo: "Cache",
      modelo: "anthropic / claude-sonnet-5-5",
    },
    { ref: "I-206.T3", etapa: "encerrar_rodada", estado: "concluido", ...comum, rodada: "I-206.R1" },
    {
      ref: "I-206.T4",
      etapa: "implementar",
      estado: "em_execucao",
      terminal: false,
      satisfazDependencia: false,
      estadoAlteradoEm: INSTANTE_DO_CENARIO,
      rodada: "I-206.R2",
      modelo: "llamacpp / qwen3-coder-30b",
      sessao: "s-nova",
      pi_ativo: true,
    },
  ]);
});

test("cada demanda traz as Pendências que a regra única acha; a encerrada não tem", () => {
  const banco = bancoComProjetos("loja");
  semearDemandas(banco);
  gravarAgregadoPronto(banco, montarAgregadoDemanda("I-210", "gate_planejamento"));
  gravarAgregadoPronto(
    banco,
    montarAgregadoDemanda("I-211", "em_execucao", {
      rodadas: [montarRodada("I-211", 1, "ajustar_resultado")],
      tickets: [concluido("I-211", 1, "ajustar_resultado", { rodada_id: 1, estado: "em_execucao" })],
    }),
  );
  gravarAgregadoPronto(
    banco,
    montarAgregadoDemanda("I-212", "cancelada", {
      tickets: [concluido("I-212", 1, "implementar", { estado: "falhou" })],
    }),
  );
  const resumo = (filtro: Partial<typeof SEM_FILTRO> = {}) =>
    consultar(banco, "loja", filtro)
      .demandas.filter((d) => ["I-210", "I-211", "I-212"].includes(d.id))
      .map((d) => [d.id, d.pendencias.map((p) => [p.tipo, p.item, p.rodada, p.acao_esperada, p.desde])]);
  assert.deepEqual(resumo(), [
    ["I-211", [["dialogo_do_agente", "I-211.R1", "I-211.R1", "responder", INSTANTE_DO_CENARIO]]],
    ["I-210", [["gate_humano", "I-210", undefined, "decidir_gate", INSTANTE_DO_CENARIO]]],
  ]);
  // A cancelada com ticket falho não aguarda ninguém.
  assert.deepEqual(resumo({ canceladas: true })[0], ["I-212", []]);
});

test("os filtros trazem as concluídas, as arquivadas e as canceladas", () => {
  const banco = bancoComProjetos("loja");
  semearDemandas(banco);
  const ids = (filtro: Partial<typeof SEM_FILTRO>) => consultar(banco, "loja", filtro).demandas.map((d) => d.id);
  assert.deepEqual(ids({ concluidas: true }), ["I-207", "I-206", "I-204"]);
  assert.deepEqual(ids({ arquivadas: true }), ["I-207", "I-206", "I-203"]);
  assert.deepEqual(ids({ canceladas: true }), ["I-207", "I-206", "I-205"]);
});

test("projeto inexistente: erro de inexistência com a orientação da Configuração", () => {
  const banco = bancoComProjetos();
  assert.throws(
    () => consultar(banco, "nao"),
    /o projeto nao não existe.*escolha um projeto cadastrado na Configuração/s,
  );
});

test("a linha do tempo: o estado em andamento, tudo feito na concluída e na arquivada, e a etapa mais adiantada na cancelada", () => {
  const tickets = [montarTicket("I-1", 1, "implementar", { rodada_id: 1 }), montarTicket("I-1", 2, "planejar")];
  const noEstado = (estado: string, resto: object = {}) => montarAgregadoDemanda("I-1", estado, resto);
  assert.equal(
    estadoNaLinhaDoTempo(CATALOGO_DO_CICLO_DE_VIDA, noEstado("gate_planejamento", { tickets })),
    "gate_planejamento",
  );
  assert.equal(estadoNaLinhaDoTempo(CATALOGO_DO_CICLO_DE_VIDA, noEstado("concluida", { tickets })), "concluida");
  assert.equal(estadoNaLinhaDoTempo(CATALOGO_DO_CICLO_DE_VIDA, noEstado("arquivada", { tickets })), "concluida");
  assert.equal(estadoNaLinhaDoTempo(CATALOGO_DO_CICLO_DE_VIDA, noEstado("cancelada", { tickets })), "em_execucao");
  assert.equal(
    estadoNaLinhaDoTempo(CATALOGO_DO_CICLO_DE_VIDA, noEstado("cancelada", { tickets: tickets.slice(1) })),
    "planejar",
  );
  assert.equal(estadoNaLinhaDoTempo(CATALOGO_DO_CICLO_DE_VIDA, noEstado("cancelada")), "entender_e_desenhar");
});
