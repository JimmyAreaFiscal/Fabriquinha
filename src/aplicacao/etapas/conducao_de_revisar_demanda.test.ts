// Condução do revisar_demanda com pi falso e git real temporário (concluir, falhar).
import assert from "node:assert/strict";
import { test } from "node:test";
import { Endereco } from "../../nucleo/item_de_trabalho.ts";
import { motivoDaFalhaDoTicket } from "../../nucleo/tentativa.ts";
import { abrir, raizDo } from "../../armazenamento/banco.ts";
import { servir } from "../../../apoio-testes/servidor_web_de_teste.ts";
import { carregarDemanda, comDemanda } from "../../armazenamento/demandas.ts";
import { caminhoDaWorktreeDemanda } from "../../infra/repositorio/worktree-demanda.ts";
import { anotar } from "../../infra/registro.ts";
import { cenarioRevisao } from "../../../apoio-testes/cenarios_de_demanda.ts";
import { relogioFixo } from "../../nucleo/relogio.ts";
import { condutor } from "../trabalho/condutor.ts";
import { ConducaoDeRevisarDemanda } from "./conducao_de_revisar_demanda.ts";

type Banco = Parameters<typeof carregarDemanda>[0];
const REVISOR = Endereco.doTicket("I-1", 3);

const conducao = (banco: Banco) =>
  new ConducaoDeRevisarDemanda({ banco, relogio: relogioFixo("2026-01-01T00:00:00.000Z"), condutor, registro: anotar });

const estado = (banco: Banco) => {
  const ag = carregarDemanda(banco, "I-1");
  const ticket = ag.tickets.find((t) => t.ticket_id === 3);
  assert.ok(ticket);
  return {
    ticket: ticket.estado,
    motivo: motivoDaFalhaDoTicket(ag.tentativas, ticket),
    demanda: ag.demanda.estado,
    decisoes: ag.decisoes.length,
  };
};

test("o ticket global roda na worktree da demanda e, sem decisão, falha", async () => {
  const { c, banco, pastas } = await cenarioRevisao({ integral: true });
  await conducao(banco).conduzir(REVISOR);
  assert.equal(estado(banco).motivo, "a revisão terminou sem registrar a decisão");
  assert.deepEqual(pastas(), [caminhoDaWorktreeDemanda(c.raiz, "loja", "I-1")]);
});

test("pi com falha deixa o ticket falhou e a demanda em revisar_demanda", async () => {
  const { banco, piFalso } = await cenarioRevisao({ integral: true });
  piFalso.roteirizar([{ parada: "error", erro: "limite de uso" }]);
  await conducao(banco).conduzir(REVISOR);
  const e = estado(banco);
  assert.deepEqual([e.ticket, e.demanda, e.decisoes], ["falhou", "revisar_demanda", 0]);
});

test("o revisor que decide deixa o ticket concluído, sem falha", async () => {
  const { banco, piFalso } = await cenarioRevisao({ integral: true });
  // O pi falso decide pelo cliente empacotado, que fala com a API sobre o mesmo banco.
  const { porta } = await servir(abrir(raizDo(banco)));
  condutor.urlDaApi = `http://127.0.0.1:${String(porta)}`;
  comDemanda(banco, "I-1", (ag) => ({
    ...ag,
    evidencias: [
      ...ag.evidencias,
      {
        demanda_id: "I-1",
        tipo: "criterios_aceite",
        autor: ag.demanda.criada_por,
        dados: { criterios: [{ id: "CA-2" }] },
        em: "2026-01-01T00:00:00.000Z",
      },
    ] as never,
  }));
  const plano = {
    demanda_id: "I-1",
    criterios: ["CA-2"],
    rodadas: [{ demanda_id: "I-1", rodada_id: 1, titulo: "corrige", e2e: false, criterios: ["CA-2"] }],
    tickets: [{ demanda_id: "I-1", ticket_id: 1, titulo: "c", descricao: "d", rodada_id: 1 }],
  };
  piFalso.roteirizar([
    {
      cli: [
        ["revisao", "decidir", "I-1.T3", "reprovar", "--motivo", "falta tratar erro", "--plano", JSON.stringify(plano)],
      ],
    },
  ]);
  await conducao(banco).conduzir(REVISOR);
  const e = estado(banco);
  assert.deepEqual([e.ticket, e.decisoes], ["concluido", 1]);
});
