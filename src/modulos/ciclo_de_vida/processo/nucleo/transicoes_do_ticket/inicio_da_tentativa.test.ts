import assert from "node:assert/strict";
import { test } from "node:test";
import { AUDITOR, FABRIQUINHA } from "../../../../compartilhado/nucleo/vocabulario_do_sdlc/ator.ts";
import { AgregadoDemanda } from "../agregado/agregado_demanda.ts";
import { ErroDeEscopo, ErroDeRegra } from "../../../../compartilhado/nucleo/erros.ts";
import { iniciarTentativaDoTicket } from "./inicio_da_tentativa.ts";
import { Endereco } from "../../../../compartilhado/nucleo/vocabulario_do_sdlc/endereco.ts";

const t0 = "2026-01-01T00:00:00Z";
const t1 = "2026-01-02T00:00:00Z";
const tk = (ticket_id: number, rodada_id: number | undefined, status = "aberto", etapa = "implementar") => ({
  demanda_id: "I-1",
  ticket_id,
  rodada_id,
  etapa,
  estado: status,
  estado_alterado_em: t0,
  criado_por: FABRIQUINHA,
});
const montar = (extra: Record<string, unknown>, estado = "em_execucao") =>
  AgregadoDemanda.parse({
    demanda: {
      id: "I-1",
      projeto: "p",
      titulo: "t",
      tipo: "funcionalidade",
      descricao: "d",
      estado,
      estado_alterado_em: t0,
      criada_por: { tipo: "externo", ferramenta: "f", sessao: "s" },
      enviada: true,
      branch: "fabriquinha/I-1",
    },
    decisoes: [],
    evidencias: [],
    tickets: [],
    ...extra,
  });
test("iniciar Tentativa abre uma só por ticket aberto ou em execução, com processo e sem mutar o agregado", () => {
  for (const estado of ["aberto", "em_execucao"]) {
    const agregado = montar({ tickets: [tk(2, undefined, estado)] });
    const iniciado = iniciarTentativaDoTicket(agregado, { ticket_id: 2, processo_id: "exec-1" }, FABRIQUINHA, {
      agora: t1,
    });
    assert.deepEqual(iniciado.tentativas, [
      { ticket: Endereco.doTicket("I-1", 2), numero: 1, processo_id: "exec-1", inicio: t1 },
    ]);
    assert.deepEqual(agregado.tentativas, []);
    assert.deepEqual(iniciado.tickets, agregado.tickets);
    const retomado = iniciarTentativaDoTicket(iniciado, { ticket_id: 2, processo_id: "exec-2" }, FABRIQUINHA, {
      agora: t1,
    });
    assert.deepEqual(retomado, iniciado);
  }
});

test("iniciar Tentativa recusa ticket falho, concluído ou cancelado, ator indevido, processo vazio e ticket inexistente", () => {
  for (const estado of ["falhou", "concluido", "cancelado"]) {
    const agregado = montar({ tickets: [tk(2, undefined, estado)] });
    assert.throws(
      () => iniciarTentativaDoTicket(agregado, { ticket_id: 2, processo_id: "exec-1" }, FABRIQUINHA, { agora: t1 }),
      ErroDeRegra,
    );
    assert.deepEqual(agregado.tentativas, []);
  }
  const agregado = montar({ tickets: [tk(2, undefined)] });
  assert.throws(
    () => iniciarTentativaDoTicket(agregado, { ticket_id: 2, processo_id: "exec-1" }, AUDITOR, { agora: t1 }),
    ErroDeEscopo,
  );
  assert.throws(() =>
    iniciarTentativaDoTicket(agregado, { ticket_id: 2, processo_id: "" }, FABRIQUINHA, { agora: t1 }),
  );
  assert.throws(
    () => iniciarTentativaDoTicket(agregado, { ticket_id: 9, processo_id: "exec-1" }, FABRIQUINHA, { agora: t1 }),
    /I-1\.T9 não existe/,
  );
});
