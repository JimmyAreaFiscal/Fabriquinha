// Seção 12 de comparacao-sdlc-implementacao.md, CA-SDLC-11 e 12 (a rodada): revisão reprovada, PR com conflito ou check
// falho e reprovação humana do PR. O cenário é montado pelos serviços e pelo agendador, com banco e git reais numa raiz
// temporária, o pi e o `gh` falsos; nada passa pela web. O agente (revisor e documentador) é a parte do teste que age
// pelo domínio enquanto o pi falso espera no portão; as verificações do ticket são o único ponto injetado.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { AUDITOR } from "../src/dominio/agregado.ts";
import { type EntradaEvidenciaDemanda, submeterEvidenciaDemanda } from "../src/dominio/evidencia_demanda.ts";
import { registrarCorrecoesSessao } from "../src/dominio/transicoes_rodada.ts";
import { marcaDoPRRodada } from "../src/evidencias/pr_rodada.ts";
import { aprovarPRRodada } from "../src/execucao/aprovacao_pr_rodada.ts";
import { despacharDemandas } from "../src/execucao/despacho_demanda.ts";
import { decidirRevisaoRodada } from "../src/execucao/revisao_rodada.ts";
import { concluirSessaoAjustes, reprovarPRRodada } from "../src/execucao/sessao_ajustes.ts";
import { comDemanda } from "../src/persistencia/demandas.ts";
import { caminhoDaWorktreeRodada } from "../src/repositorio/worktree-demanda.ts";
import {
  abrirPortao,
  agente,
  agenteMudo,
  demandaEmExecucao,
  despacho,
  fecharPortao,
  pi,
  pisAteAgora,
  rodadaDe,
  statusDe,
} from "./apoio-execucao.ts";
import { base, type Cenario, ciclo, criarCenario, demanda, esperar, git } from "./apoio.ts";
import { ghFalso } from "./falsos.ts";

const gh = ghFalso(base);
const agora = () => new Date().toISOString();

/** O ticket atual (o de maior id) da etapa na rodada 1. */
const atual = (c: Cenario, id: string, etapa: string) => {
  const t = demanda(c, id)
    .tickets.filter((x) => x.rodada_id === 1 && x.etapa === etapa)
    .sort((a, b) => b.ticket_id - a.ticket_id)[0];
  assert.ok(t, `ticket ${etapa} da rodada 1`);
  return t;
};
const correcao = (id: string, titulo: string) => ({
  demanda_id: id,
  ticket_id: 1,
  rodada_id: 1,
  titulo,
  descricao: "descrição da correção",
  caminhos: [],
});

/** As evidências que cabem ao agente do ticket, submetidas como a ferramenta autora da demanda as enviaria. */
function comoAgente(c: Cenario, id: string, ticket_id: number, evidencias: [string, object][]): void {
  comDemanda(c.banco, id, (ag) =>
    evidencias.reduce(
      (a, [tipo, dados]) =>
        submeterEvidenciaDemanda(
          a,
          { tipo, dados, ticket_id } as EntradaEvidenciaDemanda,
          { ferramenta: a.demanda.origem_ferramenta, sessao: a.demanda.origem_sessao },
          agora(),
        ),
      ag,
    ),
  );
}

/** Demanda em execução com a única implementação da rodada 1 feita pelo agendador: a rodada está em `revisao`. */
async function rodadaEmRevisao(c: Cenario): Promise<string> {
  const id = await demandaEmExecucao(c, [{ tickets: 1 }]);
  abrirPortao();
  pi.roteirizar([{ modo: "ok", agente }]);
  await ciclo(c, despacho());
  assert.equal(rodadaDe(c, id, 1)?.fase, "revisao");
  return id;
}

/** O agendador roda o `revisar_rodada` (a Fabriquinha prepara as evidências dela); depois o agente decide. */
async function revisar(
  c: Cenario,
  id: string,
  decisao: { aprovado: true } | { aprovado: false; exigencias: string; correcoes: object[] },
): Promise<number> {
  pi.roteirizar([{ modo: "ok" }]);
  await ciclo(c, despacho());
  const { ticket_id, status } = atual(c, id, "revisar_rodada");
  assert.equal(status, "em_execucao", "a revisão espera a decisão do agente");
  if (decisao.aprovado) {
    comoAgente(c, id, ticket_id, [
      ["explicacao_fitness", { explicacoes: [] }],
      ["comprovacao_criterios", { criterios: [{ id: "CA-1", atendido: true, arquivos: [] }] }],
    ]);
  }
  decidirRevisaoRodada(
    c.banco,
    { ...decisao, demanda_id: id, rodada_id: 1, ticket_id },
    { tipo: "agente", execucao: 1, ticket: ticket_id },
  );
  return ticket_id;
}

const MENSAGEM_PR = {
  titulo: "Encerrar a rodada",
  oQueMudou: "Conduz o encerramento.",
  decisoesNaoObvias: [],
  naoFeito: [],
  comoRevisar: ["Leia o diff."],
  naoVerificado: [],
};

/** O agendador roda o `encerrar_rodada`: o agente documenta (enquanto o pi espera) e a Fabriquinha publica e confere o PR. */
async function encerrar(c: Cenario, id: string): Promise<void> {
  fecharPortao();
  pi.roteirizar([{ modo: "ok", agente: agenteMudo }]);
  const fins = despacharDemandas(c.banco, c.config, despacho());
  assert.equal(fins.length, 1);
  await esperar(() => pisAteAgora() === 1, "o pi receber o prompt da documentação");
  comoAgente(c, id, atual(c, id, "encerrar_rodada").ticket_id, [
    ["mensagem_pr", MENSAGEM_PR],
    ["aula_codigo", { resumo: "aula" }],
  ]);
  abrirPortao();
  await Promise.all(fins);
}

/** Rodada 1 em `encerramento`, com a implementação revisada e aprovada. */
async function rodadaEmEncerramento(c: Cenario): Promise<string> {
  const id = await rodadaEmRevisao(c);
  await revisar(c, id, { aprovado: true });
  assert.equal(rodadaDe(c, id, 1)?.fase, "encerramento");
  return id;
}

/** Abre na hospedagem o PR que o encerramento adotará pela marca (o `problema` entra no estado dele). */
function prComProblema(c: Cenario, id: string, problema: "check" | "conflito"): void {
  const { branch } = rodadaDe(c, id, 1) ?? { branch: "" };
  gh.zerar();
  gh.abrir({
    head: branch,
    base: demanda(c, id).demanda.branch,
    titulo: "velho",
    corpo: `${marcaDoPRRodada(id, atual(c, id, "encerrar_rodada").ticket_id)}\nvelho`,
    estado: "aberto",
  });
  if (problema === "check") gh.checkFalho(1);
  else gh.conflito(1);
}

/** O corretivo aberto (o `implementar` de maior id) e a verificação de que o PR ainda não chegou ao gate. */
function corretivoAntesDoGate(c: Cenario, id: string, titulo: RegExp) {
  const rodada = rodadaDe(c, id, 1);
  assert.equal(rodada?.fase, "desenvolvimento");
  assert.equal(atual(c, id, "encerrar_rodada").status, "concluido");
  const encerramentos = demanda(c, id).tickets.filter((x) => x.etapa === "encerrar_rodada");
  assert.deepEqual(
    demanda(c, id).decisoes.filter((d) => encerramentos.some((x) => x.ticket_id === d.ticket_id)),
    [],
    "sem decisão humana no gate do PR",
  );
  const corretivo = atual(c, id, "implementar");
  assert.equal(corretivo.status, "aberto");
  assert.match(corretivo.titulo ?? "", titulo);
  return corretivo;
}

test("CA-SDLC-11: revisão reprovada devolve as correções ao desenvolvimento, que percorrem nova revisão e o encerramento", async (t) => {
  gh.zerar();
  const c = criarCenario(t);
  const id = await rodadaEmRevisao(c);
  const primeira = atual(c, id, "implementar");

  // Reprovada: as exigências ficam na decisão, a correção nasce aberta na mesma rodada e a rodada volta ao desenvolvimento.
  const reprovada = await revisar(c, id, {
    aprovado: false,
    exigencias: "falta tratar o caso X",
    correcoes: [correcao(id, "Tratar o caso X")],
  });
  const ag = demanda(c, id);
  assert.equal(rodadaDe(c, id, 1)?.fase, "desenvolvimento");
  assert.equal(statusDe(c, { demanda_id: id, ticket_id: reprovada }), "concluido");
  assert.deepEqual(
    ag.decisoes.filter((d) => d.ticket_id === reprovada).map((d) => [d.resultado, d.motivo, d.por]),
    [["recusado", "falta tratar o caso X", "agente"]],
  );
  const corretivo = atual(c, id, "implementar");
  assert.ok(corretivo.ticket_id > reprovada);
  assert.equal(corretivo.status, "aberto");
  assert.equal(corretivo.titulo, "Tratar o caso X");

  // A correção executa pelo agendador, como qualquer implementação, e a rodada volta à revisão com um revisor novo.
  pi.roteirizar([{ modo: "ok", agente }]);
  await ciclo(c, despacho());
  assert.equal(statusDe(c, corretivo), "concluido");
  assert.equal(rodadaDe(c, id, 1)?.fase, "revisao");
  const nova = atual(c, id, "revisar_rodada");
  assert.ok(nova.ticket_id > corretivo.ticket_id);
  assert.equal(nova.status, "aberto");

  // Nova revisão aprovada leva ao encerramento, que publica o PR da rodada com as duas implementações.
  const aprovada = await revisar(c, id, { aprovado: true });
  assert.equal(aprovada, nova.ticket_id);
  assert.equal(rodadaDe(c, id, 1)?.fase, "encerramento");
  await encerrar(c, id);
  assert.equal(rodadaDe(c, id, 1)?.fase, "aprovacao_pull_request");
  const [pr] = gh.prs();
  assert.equal(gh.prs().length, 1);
  assert.equal(pr?.head, rodadaDe(c, id, 1)?.branch);
  assert.equal(pr?.base, ag.demanda.branch);
  for (const ticket of [primeira, corretivo]) assert.ok(pr.corpo.includes(`${id}.T${String(ticket.ticket_id)}`));
  const worktree = caminhoDaWorktreeRodada(c.raiz, c.projeto, { demanda_id: id, rodada_id: 1 });
  assert.equal(git(worktree, "log", "--format=%s", "--grep", `\\[${id}\\.T`).split("\n").length, 2);
});

// Commita na worktree em que o pi roda: o que a conversa da sessão de ajustes não pode deixar.
const intruso = join(base, "agente-intruso.mjs");
writeFileSync(
  intruso,
  `import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
export default async () => {
  writeFileSync("intruso.txt", "x\\n");
  execFileSync("git", ["add", "-A"]);
  execFileSync("git", ["-c", "user.name=x", "-c", "user.email=x@x", "commit", "-qm", "intruso"]);
};
`,
);

test("CA-SDLC-12: conflito ou check falho do PR geram correção antes de novo gate; reprovação humana abre conversa na hora e não muda o código", async (t) => {
  // Check falho: a correção volta ao desenvolvimento (D05: a devolução técnica vai ao prompt) e só então há novo gate.
  const c = criarCenario(t);
  const id = await rodadaEmEncerramento(c);
  prComProblema(c, id, "check");
  await encerrar(c, id);
  const corretivo = corretivoAntesDoGate(c, id, /Corrigir o check ci do PR da I-\d+\.R1/);
  assert.equal(gh.prs().length, 1);

  let aprovada = false;
  pi.roteirizar([{ modo: "ok", agente }]);
  await ciclo(
    c,
    despacho(() => aprovada),
  );
  const devolvido = demanda(c, id).tickets.find((x) => x.ticket_id === corretivo.ticket_id);
  assert.deepEqual([devolvido?.status, devolvido?.devolucoes], ["aberto", 1]);
  aprovada = true;
  await ciclo(
    c,
    despacho(() => aprovada),
  );
  assert.match(pi.chamadas().at(-1)?.prompt ?? "", /execucao_testes: reprovado no teste/);
  assert.equal(statusDe(c, corretivo), "concluido");
  assert.equal(rodadaDe(c, id, 1)?.fase, "revisao");

  // Revista e reencerrada, com o check já verde, a rodada chega ao gate; a nota do PR (D03) fecha a rodada.
  await revisar(c, id, { aprovado: true });
  gh.mudar(1, { checks: [{ nome: "ci", estado: "aprovado" }] });
  await encerrar(c, id);
  assert.equal(rodadaDe(c, id, 1)?.fase, "aprovacao_pull_request");
  assert.equal(gh.prs().length, 1);
  await aprovarPRRodada(c.banco, { demanda_id: id, rodada_id: 1 }, 4, AUDITOR);
  assert.equal(rodadaDe(c, id, 1)?.fase, "concluida");
  assert.equal(demanda(c, id).decisoes.find((d) => d.ticket_id === atual(c, id, "encerrar_rodada").ticket_id)?.nota, 4);

  // Conflito do PR: mesma regra, com a correção de resolver o conflito.
  const conflitante = criarCenario(t);
  const idConflito = await rodadaEmEncerramento(conflitante);
  prComProblema(conflitante, idConflito, "conflito");
  await encerrar(conflitante, idConflito);
  corretivoAntesDoGate(conflitante, idConflito, /Resolver o conflito do PR da I-\d+\.R1/);

  // Reprovação humana: com o PR limpo no gate, o Auditor reprova e a conversa abre na hora, sem esperar o agendador.
  const humana = criarCenario(t);
  const idHumana = await rodadaEmEncerramento(humana);
  gh.zerar();
  await encerrar(humana, idHumana);
  assert.equal(rodadaDe(humana, idHumana, 1)?.fase, "aprovacao_pull_request");
  const ref = { demanda_id: idHumana, rodada_id: 1 };
  const worktree = caminhoDaWorktreeRodada(humana.raiz, humana.projeto, ref);
  const ponta = (branch: string) => git(humana.repo, "rev-parse", `refs/heads/${branch}`);
  const { branch: branchRodada } = rodadaDe(humana, idHumana, 1) ?? { branch: "" };
  const { branch: branchDemanda } = demanda(humana, idHumana).demanda;
  const [rodadaAntes, demandaAntes] = [ponta(branchRodada), ponta(branchDemanda)];

  fecharPortao();
  pi.roteirizar([{ modo: "ok", agente: intruso }]);
  const chamadasAntes = pisAteAgora();
  const sessao = await reprovarPRRodada(humana.banco, ref, "o PR mistura duas mudanças", AUDITOR, {
    limiteMin: humana.config.timeoutMin,
  });
  await esperar(() => pisAteAgora() === chamadasAntes + 1, "o pi da conversa receber o prompt sem esperar o agendador");
  assert.match(pi.chamadas().at(-1)?.prompt ?? "", /sessão de ajustes[\s\S]*o PR mistura duas mudanças/);
  assert.equal(rodadaDe(humana, idHumana, 1)?.fase, "sessao");
  const gate = atual(humana, idHumana, "encerrar_rodada").ticket_id;
  const reprovacao = demanda(humana, idHumana).decisoes.find((d) => d.ticket_id === gate);
  assert.deepEqual(
    [reprovacao?.resultado, reprovacao?.motivo, reprovacao?.nota],
    ["recusado", "o PR mistura duas mudanças", undefined],
  );
  await esperar(() => git(worktree, "log", "-1", "--format=%s") === "intruso", "o agente da conversa commitar");
  assert.equal(despacharDemandas(humana.banco, humana.config, despacho()).length, 0);

  // A conversa só registra correções: o que ela commitou é desfeito ao concluir, e nada é implementado nem integrado.
  const { ticket_id } = atual(humana, idHumana, "sessao_em_aberto");
  comDemanda(humana.banco, idHumana, (ag) =>
    registrarCorrecoesSessao(
      ag,
      { ...ref, ticket_id, correcoes: [correcao(idHumana, "Separar as mudanças")] },
      AUDITOR,
      { agora: agora() },
    ),
  );
  await concluirSessaoAjustes(humana.banco, ref, AUDITOR);
  await sessao.fim;
  assert.equal(rodadaDe(humana, idHumana, 1)?.fase, "desenvolvimento");
  assert.equal(atual(humana, idHumana, "implementar").status, "aberto");
  assert.equal(ponta(branchRodada), rodadaAntes);
  assert.equal(ponta(branchDemanda), demandaAntes);
  assert.equal(git(worktree, "status", "--porcelain"), "");
  assert.equal(gh.prs().length, 1);
  assert.equal(gh.prs()[0]?.estado, "aberto");
});
