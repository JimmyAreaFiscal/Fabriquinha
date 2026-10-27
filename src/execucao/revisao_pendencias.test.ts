import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgregadoDemanda } from "../dominio/agregado_demanda.ts";
import { conferirAprovacao } from "./revisao_pendencias.ts";

const linha = (nome: string, codigoSaida: number) => ({ nome, codigoSaida });
const comprov = (atendido: boolean) => ({ criterios: [{ id: "CA-1", atendido, arquivos: [] }] });
const estresse = (resultado: string) => ({
  aplicavel: true,
  cenarios: [{ nome: "carga", objetivo: "o", comando: "c", resultado, observado: "x" }],
});
const seguranca = (severidade: string) => ({
  aplicavel: true,
  ameacas: [{ descricao: "a", mitigacao: "m" }],
  achados: [{ descricao: "injeção", severidade, recomendacao: "r" }],
});
const ag = (etapa: string, evidencias: Record<string, unknown>): AgregadoDemanda =>
  ({
    tickets: [{ ticket_id: 7, demanda_id: "D-1", etapa }],
    evidencias: Object.entries(evidencias).map(([tipo, dados]) => ({
      demanda_id: "D-1",
      ticket_id: 7,
      tipo,
      dados,
    })),
  }) as unknown as AgregadoDemanda;
const rodada = (fitness: unknown, comprovacao: unknown) =>
  ag("revisar_rodada", {
    arquivos_alterados: {},
    matriz_fitness: fitness,
    explicacao_fitness: {},
    ...(comprovacao === undefined ? {} : { comprovacao_criterios: comprovacao }),
  });
const integral = (e: unknown, s: unknown) =>
  ag("revisar_demanda", { comprovacao_criterios: comprov(true), testes_estresse: e, analise_seguranca: s });
const ok = { linhas: [linha("a", 0)] };
const recusa = (a: AgregadoDemanda, ...trechos: string[]) => {
  assert.throws(
    () => {
      conferirAprovacao(a, 7);
    },
    (e: Error) => trechos.every((t) => e.message.includes(t)),
  );
};

test("rodada aprovada com tudo em ordem (CA-7)", () => {
  conferirAprovacao(rodada(ok, comprov(true)), 7);
});

test("recusa citando a fitness que falhou (CA-5)", () => {
  recusa(rodada({ linhas: [linha("a", 0), linha("lint", 1)] }, comprov(true)), "matriz_fitness", "lint");
});

test("recusa evidência ausente e reprovada (CA-6)", () => {
  recusa(rodada(ok, undefined), "comprovacao_criterios ausente");
  recusa(rodada(ok, comprov(false)), "comprovacao_criterios reprovada");
});

test("recusa achado alto ou crítico (CA-13)", () => {
  recusa(integral(estresse("passou"), seguranca("critica")), "analise_seguranca", "injeção");
});

test("recusa cenário que quebrou (CA-14)", () => {
  recusa(integral(estresse("quebrou"), seguranca("baixa")), "testes_estresse", "carga");
});

test("recusa não se aplica sem justificativa (CA-15)", () => {
  const vazio = { aplicavel: false, justificativa: "  ", cenarios: [], ameacas: [], achados: [] };
  recusa(integral(vazio, seguranca("baixa")), "justificativa");
  recusa(integral(estresse("passou"), { ...vazio }), "justificativa");
});

test("integral aprovada, inclusive com não se aplica justificado (CA-16)", () => {
  conferirAprovacao(integral(estresse("passou"), seguranca("media")), 7);
  conferirAprovacao(integral({ aplicavel: false, justificativa: "sem carga", cenarios: [] }, seguranca("baixa")), 7);
});

test("tipo fora do catálogo da etapa é ignorado", () => {
  const base = rodada(ok, comprov(true));
  const extra = ag("revisar_rodada", {
    arquivos_alterados: {},
    matriz_fitness: ok,
    explicacao_fitness: {},
    comprovacao_criterios: comprov(true),
    testes_estresse: estresse("quebrou"),
    analise_seguranca: { aplicavel: false, justificativa: "", cenarios: [], ameacas: [], achados: [] },
  });
  conferirAprovacao(base, 7);
  conferirAprovacao(extra, 7);
  recusa(
    ag("revisar_rodada", { matriz_fitness: ok, testes_estresse: estresse("quebrou") }),
    "comprovacao_criterios ausente",
  );
});

test("ticket inexistente", () => {
  recusa({ ...rodada(ok, comprov(true)), tickets: [] }, "não existe");
});
