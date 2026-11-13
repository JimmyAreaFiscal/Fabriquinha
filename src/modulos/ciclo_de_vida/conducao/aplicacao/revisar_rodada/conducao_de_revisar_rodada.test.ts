// Condução do revisar_rodada com pi falso e git real temporário (concluir, reprovar, falhar).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { AUDITOR, Endereco } from "../../../etapas/publico.ts";
import { motivoDaFalhaDoTicket, reabrirTicket, carregarDemanda } from "../../../processo/publico.ts";
import { raizDo } from "../../../../../shared/armazenamento/banco.ts";
import { abrirBancoDaFabriquinha } from "../../../../../server/composicao/banco_da_fabriquinha.ts";
import { servir } from "../../../../../../apoio-testes/servidor_web_de_teste.ts";
import { comDemanda } from "../../../processo/armazenamento/agregado_da_demanda.ts";
import { caminhoDaWorktreeRodada } from "../../../../../../apoio-testes/repositorio_de_teste.ts";
import { anotar } from "../../../../../shared/infra/registro.ts";
import { cenarioRevisao } from "../../../../../../apoio-testes/cenarios/cenarios_de_demanda.ts";
import { conferirPromptComFoto } from "../prompt/fotos_retorno/conferir_foto.ts";
import { relogioFixo } from "../../../../../shared/nucleo/relogio.ts";

const RELOGIO = relogioFixo("2026-01-01T00:00:00.000Z");
import { CondutorDeTrabalhos, condutor } from "../politica_dos_agentes/condutor.ts";
import { ConducaoDeRevisarRodada } from "./conducao_de_revisar_rodada.ts";
import { reservadoPeloDespacho } from "../../../../../../apoio-testes/reserva_do_despacho.ts";

type Banco = Parameters<typeof carregarDemanda>[0];
const REVISOR = Endereco.doTicket("I-1", 2);
const SEM_DECISAO = "a revisão terminou sem registrar a decisão";

const conducao = (banco: Banco, condutorDeTeste: CondutorDeTrabalhos = condutor) =>
  new ConducaoDeRevisarRodada({ banco, relogio: RELOGIO, condutor: condutorDeTeste, registro: anotar });

const estado = (banco: Banco) => {
  const ag = carregarDemanda(banco, "I-1");
  const ticket = ag.tickets.find((t) => t.ticket_id === 2);
  assert.ok(ticket);
  return {
    ticket: ticket.estado,
    motivo: motivoDaFalhaDoTicket(ag.tentativas, ticket),
    demanda: ag.demanda.estado,
    rodada: ag.rodadas[0]?.estado,
    decisoes: ag.decisoes.length,
    evidencias: ag.evidencias.filter((e) => e.ticket_id === 2 && e.tipo === "matriz_fitness").length,
  };
};

test("o pi roda na worktree da rodada, com a fitness gravada antes, e sem decisão o ticket falha com o motivo", async () => {
  const { c, banco, pastas } = await cenarioRevisao();
  await conducao(banco).conduzir(reservadoPeloDespacho(banco, REVISOR));
  const e = estado(banco);
  assert.deepEqual([e.ticket, e.motivo, e.evidencias], ["falhou", SEM_DECISAO, 1]);
  assert.deepEqual(pastas(), [caminhoDaWorktreeRodada(c.raiz, "loja", { demanda_id: "I-1", rodada_id: 1 })]);
});

test("o revisor que decide deixa o ticket concluído, sem falha", async () => {
  const { banco, piFalso } = await cenarioRevisao();
  // O pi falso decide pelo cliente empacotado, que fala com a API sobre o mesmo banco.
  const { porta } = await servir(abrirBancoDaFabriquinha(raizDo(banco)));
  condutor.urlDaApi = `http://127.0.0.1:${String(porta)}`;
  piFalso.roteirizar([
    {
      cli: [
        [
          "revisao",
          "decidir",
          "I-1.T2",
          "reprovar",
          "--motivo",
          "falta teste",
          "--correcoes",
          JSON.stringify([{ ticket_id: 1, titulo: "corrige", descricao: "d", arquivos_previstos: [], depende: [] }]),
        ],
      ],
    },
  ]);
  await conducao(banco).conduzir(reservadoPeloDespacho(banco, REVISOR));
  const e = estado(banco);
  assert.deepEqual([e.ticket, e.decisoes], ["concluido", 1]);
});

test("pi com falha deixa o ticket falhou, sem decisão e com a rodada em revisao", async () => {
  const { banco, piFalso } = await cenarioRevisao();
  piFalso.roteirizar([{ parada: "error", erro: "limite de uso" }]);
  await conducao(banco).conduzir(reservadoPeloDespacho(banco, REVISOR));
  const e = estado(banco);
  assert.deepEqual(
    [e.ticket, e.motivo, e.rodada, e.demanda, e.decisoes],
    ["falhou", "o agente parou com stopReason error: limite de uso", "revisar_rodada", "em_execucao", 0],
  );
});

test("preparação que lança falha o ticket sem rodar o pi e vai ao log", async () => {
  const { c, banco, pastas } = await cenarioRevisao();
  banco.exec("DELETE FROM linguagem_projeto");
  await conducao(banco).conduzir(reservadoPeloDespacho(banco, REVISOR));
  assert.match(estado(banco).motivo ?? "", /não tem configuração/);
  assert.deepEqual(pastas(), []);
  assert.match(readFileSync(`${c.raiz}/log`, "utf8"), /preparação falhou: .*não tem configuração/);
});

test("preparação interrompida pela parada do serviço falha como serviço reiniciado", async () => {
  const { banco } = await cenarioRevisao();
  banco.exec("DELETE FROM linguagem_projeto");
  const emParada = new CondutorDeTrabalhos();
  emParada.marcarParada();
  await conducao(banco, emParada).conduzir(reservadoPeloDespacho(banco, REVISOR));
  assert.equal(estado(banco).motivo, "serviço reiniciado");
});

test("ticket reaberto leva a instrução ao prompt como reabertura", async () => {
  const { c, banco, piFalso } = await cenarioRevisao();
  piFalso.roteirizar([{ parada: "error", erro: "limite de uso" }]);
  await conducao(banco).conduzir(reservadoPeloDespacho(banco, REVISOR));
  comDemanda(banco, "I-1", (ag) =>
    reabrirTicket(ag, { ticket_id: 2, instrucao: "refaça com atenção" }, AUDITOR, { agora: RELOGIO.agora() }),
  );
  piFalso.roteirizar([{}]);
  await conducao(banco).conduzir(reservadoPeloDespacho(banco, REVISOR));
  const prompts = readdirSync(`${c.raiz}/execucoes`).map((d) =>
    readFileSync(`${c.raiz}/execucoes/${d}/prompt.md`, "utf8"),
  );
  assert.ok(prompts.some((p) => p.includes("refaça com atenção")));
  conferirPromptComFoto(piFalso.prompts().at(-1)?.prompt ?? "", c.raiz, "revisao_reabertura");
});

test("ticket inexistente é rejeitado", async () => {
  const { banco } = await cenarioRevisao();
  await assert.rejects(conducao(banco).conduzir(Endereco.doTicket("I-1", 99)), /I-1.T99 não existe/);
});
