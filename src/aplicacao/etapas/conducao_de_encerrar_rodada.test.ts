// Condução do encerrar_rodada com pi falso, git real e hospedagem falsa (concluir, reprovar, falhar).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  cenario,
  DEMANDA,
  hospedagem,
  MARCA,
  BRANCH_DEMANDA,
  BRANCH_RODADA,
} from "../../../apoio-testes/cenario_de_encerramento_rodada.ts";
import { Endereco } from "../../nucleo/item_de_trabalho.ts";
import { motivoDaFalhaDoTicket } from "../../nucleo/tentativa.ts";
import { carregarDemanda } from "../../armazenamento/demandas.ts";
import { carregarTrabalhosDoTicket } from "../../armazenamento/trabalho_agentico.ts";
import { anotar } from "../../infra/registro.ts";
import { conferirPromptComFoto } from "../fotos_retorno/conferir_foto.ts";
import { instanteAtual } from "../relogio.ts";
import { condutor } from "../trabalho/condutor.ts";
import { ConducaoDeEncerrarRodada } from "./conducao_de_encerrar_rodada.ts";

type Banco = Parameters<typeof carregarDemanda>[0];
const ENCERRAR = Endereco.doTicket(DEMANDA, 8);

const conduzir = (banco: Banco) =>
  new ConducaoDeEncerrarRodada({ banco, relogio: instanteAtual, condutor, registro: anotar }).conduzir(ENCERRAR);

const motivoDaFalha = (banco: Banco) => {
  const ag = carregarDemanda(banco, DEMANDA);
  const ticket = ag.tickets.find((t) => t.ticket_id === 8);
  assert.ok(ticket);
  return motivoDaFalhaDoTicket(ag.tentativas, ticket);
};

test("concluir: reserva o ticket aberto, roda o pi na worktree da rodada, publica o PR e leva a rodada ao gate", async () => {
  const { c, banco, piFalso, ticket, estado, evidencia, prompt } = await cenario({
    statusEncerrar: "aberto",
    instrucao: "refaça a aula",
  });

  await conduzir(banco);

  assert.equal(ticket()?.estado, "em_execucao");
  assert.equal(estado(), "gate_pr");
  assert.deepEqual(
    hospedagem.prs().map((pr) => [pr.head, pr.base]),
    [[BRANCH_RODADA, BRANCH_DEMANDA]],
  );
  assert.ok(hospedagem.prs()[0]?.corpo.startsWith(MARCA));
  assert.ok(evidencia("relatorio_produtividade"));
  assert.ok(evidencia("pr_aberto"));
  const { sessoes, execucoes } = carregarTrabalhosDoTicket(banco, { demanda_id: DEMANDA, ticket_id: 8 });
  assert.equal(sessoes.length, 1);
  assert.equal(execucoes[0]?.falha, false);
  assert.match(prompt(), /refaça a aula/);
  conferirPromptComFoto(piFalso.prompts().at(-1)?.prompt ?? "", c.raiz, "encerramento_rodada_reabertura");
});

test("reprovar: check falho no PR conclui o ticket e devolve a rodada a implementar com a correção", async () => {
  const { banco, ticket, estado, ag } = await cenario({ statusEncerrar: "aberto" });
  hospedagem.abrirPr({
    head: BRANCH_RODADA,
    base: BRANCH_DEMANDA,
    titulo: "velho",
    corpo: `${MARCA}\nvelho`,
    estado: "aberto",
    checks: [{ nome: "lint", estado: "falho" }],
  });

  await conduzir(banco);

  assert.equal(estado(), "implementar");
  assert.equal(ticket()?.estado, "concluido");
  assert.deepEqual(
    ag()
      .tickets.filter((t) => t.ticket_id > 8)
      .map((t) => t.titulo),
    ["Corrigir o check lint do PR da I-206.R2"],
  );
});

test("falhar: o pi com falha falha o ticket sem publicar o PR", async () => {
  const { banco, piFalso, ticket, estado } = await cenario({ statusEncerrar: "aberto" });
  piFalso.roteirizar([{ parada: "error", erro: "limite de uso" }]);

  await conduzir(banco);

  assert.equal(ticket()?.estado, "falhou");
  assert.equal(motivoDaFalha(banco), "o agente parou com stopReason error: limite de uso");
  assert.deepEqual(hospedagem.chamadas(), []);
  assert.equal(estado(), "encerrar_rodada");
});

test("falhar: a hospedagem recusa o PR e o ticket falha com a saída do comando, que vai ao log", async () => {
  const { c, banco, ticket, evidencia, estado } = await cenario({ statusEncerrar: "aberto" });
  hospedagem.falhar("pr create", "GraphQL: sem permissão");

  await conduzir(banco);

  assert.equal(ticket()?.estado, "falhou");
  assert.match(motivoDaFalha(banco) ?? "", /GraphQL: sem permissão/);
  assert.equal(evidencia("pr_aberto"), undefined);
  assert.equal(estado(), "encerrar_rodada");
  assert.match(readFileSync(`${c.raiz}/log`, "utf8"), /encerramento da rodada falhou: .*GraphQL: sem permissão/);
});

test("falhar: sem a documentação do agente o ticket falha e nada é publicado", async () => {
  const { banco, ticket, evidencia } = await cenario({ statusEncerrar: "aberto", documentacao: false });

  await conduzir(banco);

  assert.equal(ticket()?.estado, "falhou");
  assert.match(motivoDaFalha(banco) ?? "", /a documentação ainda não foi entregue/);
  assert.equal(evidencia("relatorio_produtividade"), undefined);
  assert.deepEqual(hospedagem.chamadas(), []);
});
