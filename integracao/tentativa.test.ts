// CA-2 da I-270: o motivo da falha mora na última Tentativa do ticket. Banco novo aberto por `abrir` numa raiz temporária,
// um ticket com duas Tentativas encerradas (motivos A e depois B): o esquema não tem mais os contadores nem o `erro`, e
// o CLI do agente e a página da demanda mostram o motivo B.
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { test } from "node:test";
import { abrirBancoTemporario } from "../apoio-testes/banco_temporario.ts";
import {
  cadastrarProjetoLoja,
  gravarAgregadoPronto,
  INSTANTE_DO_CENARIO,
  montarAgregadoDemanda,
  montarRodada,
  montarTicket,
} from "../apoio-testes/cenarios_de_demanda.ts";
import { servir } from "../apoio-testes/servidor_web_de_teste.ts";
import { Endereco } from "../src/nucleo/item_de_trabalho.ts";
import { criarSessao, iniciarExecucao } from "../src/nucleo/sessoes.ts";
import type { Tentativa } from "../src/nucleo/tentativa.ts";
import { comSessoesDoTicket } from "../src/armazenamento/sessoes.ts";
import { principal } from "../src/entrega/cli/cli.ts";
import { pagina, type DadosDaPagina } from "../src/entrega/cliente-web/telas/demandas.ts";

const ticket = Endereco.doTicket("I-206", 3);
const falhaDeInfraestrutura = (numero: number, motivo: string): Tentativa => ({
  ticket,
  numero,
  inicio: INSTANTE_DO_CENARIO,
  fim: INSTANTE_DO_CENARIO,
  resultado: { tipo: "falha_infraestrutura", causa: "tempo_limite", motivo },
});

test("CA-2: sem os contadores e o erro, o motivo B da última Tentativa aparece no CLI e na página da demanda", async () => {
  const { raiz, banco } = abrirBancoTemporario();
  cadastrarProjetoLoja(banco);
  gravarAgregadoPronto(
    banco,
    montarAgregadoDemanda("I-206", "em_execucao", {
      rodadas: [montarRodada("I-206", 1, "implementar")],
      tickets: [montarTicket("I-206", 3, "implementar", { rodada_id: 1, estado: "falhou" })],
      tentativas: [falhaDeInfraestrutura(1, "motivo A"), falhaDeInfraestrutura(2, "motivo B")],
    }),
  );

  const colunas = (tabela: string) =>
    banco
      .prepare(`SELECT name FROM pragma_table_info('${tabela}')`)
      .all()
      .map((c) => String(c.name));
  for (const antiga of ["motivo_falha", "devolucoes", "retomadas_automaticas"]) {
    assert.ok(!colunas("ticket_demanda").includes(antiga), `ticket_demanda ainda tem ${antiga}`);
  }
  assert.ok(!colunas("execucao_sessao").includes("erro"));

  comSessoesDoTicket(banco, { demanda_id: "I-206", ticket_id: 3 }, (estado) => {
    const sessoes = criarSessao(estado.sessoes, {
      id: "s-exec-3",
      demanda_id: "I-206",
      ticket_id: 3,
      modo: "autonomo",
      conversa_referencia: "s-exec-3",
    });
    const execucao = { id: "exec-3", sessao_id: "s-exec-3", inicio: INSTANTE_DO_CENARIO, falha: false };
    return { ...estado, sessoes, execucoes: iniciarExecucao(sessoes, estado.execucoes, execucao) };
  });
  let saida = "";
  const codigo = await principal(["ticket", "ver", "I-206.T3"], {
    env: { FABRIQUINHA_ROOT: raiz, FABRIQUINHA_EXECUCAO: "exec-3" },
    stdin: Readable.from([""]),
    stdout: { write: (texto: string) => (saida += texto) },
    stderr: { write: () => true },
    parada: () => Promise.resolve(),
  });
  assert.equal(codigo, 0);
  assert.equal((JSON.parse(saida) as { motivo?: string }).motivo, "motivo B");

  const { pedir } = await servir(banco);
  const demanda = (await pedir("/api/demandas/I-206")).json<DadosDaPagina>();
  assert.equal(demanda.tickets.find((t) => t.ref === "I-206.T3")?.motivo, "motivo B");
  const html = pagina(demanda);
  assert.match(html, /Motivo da falha:<\/strong> motivo B/);
  assert.doesNotMatch(html, /motivo A/);
});
