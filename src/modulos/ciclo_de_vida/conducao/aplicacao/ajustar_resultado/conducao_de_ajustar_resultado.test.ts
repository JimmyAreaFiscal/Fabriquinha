// A condução do ajustar_resultado com banco real, git real (origin bare) e pi falso: o PR reprovado abre a sessão, a
// execução termina ou falha devolvendo as branches ao marco, e o Auditor conclui (CA-12 a CA-23 e CA-25 da I-229).
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { DatabaseSync } from "node:sqlite";
import { AUDITOR, Endereco } from "../../../etapas/publico.ts";
import { ErroDeEscopo } from "../../../../../shared/nucleo/erros.ts";
import { GATES } from "../gates.ts";
import { carregarDemanda } from "../../../processo/publico.ts";
import { comDemanda } from "../../../processo/armazenamento/agregado_da_demanda.ts";
import { anotar } from "../../../../../shared/infra/registro.ts";
import {
  ate,
  BRANCH_DEMANDA,
  BRANCH_RODADA,
  cenarioDeAjustes,
  concluirComCorrecao,
  DEMANDA,
  ENDERECO,
  MOTIVO,
  REF,
  reprovarPRRodada,
  URL_PR,
} from "../../../../../../apoio-testes/cenario_de_ajustes.ts";
import { limitarTempoDoPi } from "../../../../../../apoio-testes/limite_do_pi.ts";
import { conferirPromptComFoto } from "../prompt/fotos_retorno/conferir_foto.ts";
import { relogioFixo } from "../../../../../shared/nucleo/relogio.ts";
import { concluirSessaoAjustes, guardarMarcoDaSessao, sessaoDaRodada } from "./sessao_ajustes.ts";
import { enviarDemanda } from "../conducao_de_etapa/mensagem_do_auditor.ts";
import { condutor } from "../politica_dos_agentes/condutor.ts";
import { ConducaoDeAjustarResultado } from "./conducao_de_ajustar_resultado.ts";

/** O mesmo caminho de efeitos do gate, com o pi de ociosidade curta para a execução terminar logo e o `fim` poder ser esperado. */
async function reprovarPRRodadaComLimiteCurto(banco: DatabaseSync, motivo: string) {
  limitarTempoDoPi(banco, 0.02);
  await guardarMarcoDaSessao(banco, REF, carregarDemanda(banco, DEMANDA));
  const reprovada = comDemanda(banco, DEMANDA, (a) =>
    GATES.gate_pr.regra.decidir(a, ENDERECO, { resultado: "reprovado", motivo }, AUDITOR, {
      agora: "2026-01-01T00:00:00.000Z",
    }),
  );
  const ticket = sessaoDaRodada(reprovada, REF);
  const execucao = await new ConducaoDeAjustarResultado({
    banco,
    relogio: relogioFixo("2026-01-01T00:00:00.000Z"),
    condutor,
    registro: anotar,
  }).iniciar(Endereco.doTicket(DEMANDA, ticket.ticket_id));
  assert.ok(execucao);
  return execucao;
}

test("CA-12, CA-14, CA-15, CA-23 e CA-25: reprovar registra a recusa, abre a sessão e leva o motivo, a URL e os endereços públicos", async () => {
  const { ag, prompts, banco } = await cenarioDeAjustes();

  const { sessao } = await reprovarPRRodada(banco, MOTIVO);

  assert.ok(sessao);
  const depois = ag();
  assert.deepEqual(
    depois.decisoes.map((d) => [d.resultado, d.motivo, d.nota]),
    [["reprovado", MOTIVO, undefined]],
  );
  assert.equal(depois.rodadas[0]?.estado, "ajustar_resultado");
  assert.deepEqual(
    depois.tickets.filter((t) => t.etapa === "ajustar_resultado").map((t) => t.ticket_id),
    [9],
  );
  await ate(() => prompts().length === 1);
  const mensagem = prompts()[0]?.prompt ?? "";
  for (const esperado of [MOTIVO, URL_PR, "I-206.R2", "I-206.T9"]) assert.match(mensagem, new RegExp(esperado));
  assert.doesNotMatch(mensagem, /\bT-\d/);
  await concluirComCorrecao(banco, ag);
});

test("foto do retorno ao agente nos ajustes: reprovação do PR da rodada", async () => {
  const { c, ag, prompts, banco } = await cenarioDeAjustes();
  await reprovarPRRodada(banco, MOTIVO);
  await ate(() => prompts().length === 1);
  conferirPromptComFoto(prompts()[0]?.prompt ?? "", c.raiz, "ajustes_reprovacao");
  await concluirComCorrecao(banco, ag);
});

test("CA-17 e CA-18: o que o agente commita ou integra na conversa é desfeito ao fim da execução", async () => {
  const { c, banco, head, sha, sujo } = await cenarioDeAjustes(
    `git {id} commit --allow-empty -qm indevido && echo x > sujo.txt && git -C {demanda} {id} commit --allow-empty -qm integrado`,
  );
  const demanda = sha(BRANCH_DEMANDA);

  const { fim } = await reprovarPRRodadaComLimiteCurto(banco, MOTIVO);
  await fim;

  assert.equal(sha(BRANCH_RODADA), head);
  assert.equal(sha(BRANCH_DEMANDA), demanda);
  assert.equal(sujo(), false);
  assert.ok(c.raiz);
});

test("CA-16: a mensagem do Auditor pelo chat vai ao pi vivo e a resposta fica na mesma conversa", async () => {
  const { banco, prompts, ag } = await cenarioDeAjustes();
  await reprovarPRRodada(banco, MOTIVO);
  await ate(() => prompts().length === 1);
  const sessao = prompts()[0]?.sessao ?? "";
  await ate(() => condutor.situacao(sessao)?.ocupado === false);

  enviarDemanda(banco, sessao, "Cobre o erro de rede também", "prompt", 5);

  await ate(() => prompts().length === 2);
  assert.equal(prompts()[1]?.prompt, "Cobre o erro de rede também");
  assert.equal(prompts()[1]?.sessao, sessao);

  // CA-20 e CA-22: sem correção, ou pelo agente, a conclusão é reprovada e a sessão segue aberta.
  await assert.rejects(concluirSessaoAjustes(banco, REF, AUDITOR), /trabalho corretivo/);
  await assert.rejects(concluirSessaoAjustes(banco, REF, { tipo: "agente", trabalho_id: "1" }), ErroDeEscopo);
  assert.equal(ag().rodadas[0]?.estado, "ajustar_resultado");

  // CA-19 e CA-21: com a correção registrada, o Auditor conclui e a rodada volta ao desenvolvimento.
  await concluirComCorrecao(banco, ag);
  assert.equal(ag().rodadas[0]?.estado, "implementar");
  assert.equal(ag().tickets.find((t) => t.ticket_id === 9)?.estado, "concluido");
});

test("CA-17 e CA-18 na retomada: sem pi vivo, a mensagem pelo chat retoma a mesma sessão e o fim dela desfaz o que o agente fez", async () => {
  const { banco, prompts, ag, sha, head, sujo } = await cenarioDeAjustes(
    `git {id} commit --allow-empty -qm indevido && echo x > sujo.txt && git -C {demanda} {id} commit --allow-empty -qm integrado`,
  );
  const demanda = sha(BRANCH_DEMANDA);
  const { fim } = await reprovarPRRodadaComLimiteCurto(banco, MOTIVO);
  await fim;
  const sessao = prompts()[0]?.sessao ?? "";

  enviarDemanda(banco, sessao, "Voltei", "prompt", 0.02);

  await ate(() => prompts().length === 2);
  assert.equal(prompts()[1]?.sessao, sessao);
  assert.equal(prompts()[1]?.prompt, "Voltei");
  // A restauração volta a rodada, a demanda e a worktree depois que o pi para.
  await ate(() => condutor.situacao(sessao) === undefined && sha(BRANCH_DEMANDA) === demanda && !sujo());
  assert.equal(sha(BRANCH_RODADA), head);
  assert.equal(ag().tickets.find((t) => t.ticket_id === 9)?.estado, "aberto");
  await concluirComCorrecao(banco, ag);
});

test("o pi que falha na conversa devolve as branches ao marco e deixa o ticket da sessão aberto", async () => {
  const { banco, piFalso, rodada, ag, sujo } = await cenarioDeAjustes();
  piFalso.roteirizar([{ sai: { codigo: 1, stderr: "limite de uso" } }]);
  writeFileSync(join(rodada, "sujo.txt"), "x");
  const { fim } = await reprovarPRRodadaComLimiteCurto(banco, MOTIVO);
  assert.ok(await fim);
  assert.equal(sujo(), false);
  assert.equal(ag().tickets.find((t) => t.ticket_id === 9)?.estado, "aberto");
});
