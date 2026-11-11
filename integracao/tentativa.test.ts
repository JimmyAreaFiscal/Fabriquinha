// CA-2 da I-270: o motivo da falha mora na última Tentativa do ticket. Banco novo aberto por `abrir` numa raiz temporária,
// um ticket com duas Tentativas encerradas (motivos A e depois B): o esquema não tem mais os contadores nem o `erro`, e
// o CLI do agente e a página da demanda mostram o motivo B.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { join } from "node:path";
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
import { Endereco } from "../src/compartilhado/nucleo/vocabulario_do_sdlc/endereco.ts";
import { criarTrabalho, iniciarProcesso } from "../src/trabalho_agentico/nucleo/trabalho_agentico.ts";
import type { Tentativa } from "../src/sdlc/nucleo/tentativa.ts";
import {
  comTrabalhosDoTicket,
  gravarTokenDoProcesso,
} from "../src/trabalho_agentico/armazenamento/trabalho_agentico.ts";
import type { PaginaDaDemanda } from "../src/entrega/contrato/demanda.ts";
import { pagina } from "../src/entrega/cliente-web/telas/demandas.ts";

const ticket = Endereco.doTicket("I-206", 3);
const falhaDeInfraestrutura = (numero: number, motivo: string): Tentativa => ({
  ticket,
  numero,
  inicio: INSTANTE_DO_CENARIO,
  fim: INSTANTE_DO_CENARIO,
  resultado: { tipo: "falha_infraestrutura", causa: "tempo_limite", motivo },
});

test("CA-2: sem os contadores e o erro, o motivo B da última Tentativa aparece no CLI e na página da demanda", async () => {
  const { banco } = abrirBancoTemporario();
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
  assert.ok(!colunas("processo_do_trabalho").includes("erro"));

  comTrabalhosDoTicket(banco, { demanda_id: "I-206", ticket_id: 3 }, (estado) => {
    const sessoes = criarTrabalho(estado.sessoes, {
      id: "s-exec-3",
      demanda_id: "I-206",
      ticket_id: 3,
      modo: "autonomo",
      conversa_referencia: "s-exec-3",
    });
    const execucao = { id: "exec-3", trabalho_id: "s-exec-3", inicio: INSTANTE_DO_CENARIO, falha: false };
    return { ...estado, sessoes, execucoes: iniciarProcesso(sessoes, estado.execucoes, execucao) };
  });
  gravarTokenDoProcesso(banco, "exec-3", "token-exec-3");
  const { pedir, porta } = await servir(banco);
  const { codigo, saida } = await new Promise<{ codigo: number; saida: string }>((resolve) => {
    execFile(
      process.execPath,
      [join(import.meta.dirname, "../pacote-pi/bin/fabriquinha"), "ticket", "ver", "I-206.T3"],
      { env: { FABRIQUINHA_API: `127.0.0.1:${String(porta)}`, FABRIQUINHA_TOKEN: "token-exec-3" } },
      (erro, stdout) => {
        resolve({ codigo: typeof erro?.code === "number" ? erro.code : 0, saida: stdout });
      },
    );
  });
  assert.equal(codigo, 0);
  assert.equal((JSON.parse(saida) as { motivo?: string }).motivo, "motivo B");

  const demanda = (await pedir("/api/demandas/I-206")).json<PaginaDaDemanda>();
  assert.equal(demanda.tickets.find((t) => t.ref === "I-206.T3")?.motivo, "motivo B");
  const html = pagina(demanda);
  assert.match(html, /Motivo da falha:<\/strong> motivo B/);
  assert.doesNotMatch(html, /motivo A/);
});
