// Seção 12 de comparacao-sdlc-implementacao.md, CA-SDLC-14 a 17 (o encerramento): revisão integral reprovada, encerramento
// final com o merge humano, queda entre o efeito externo e a gravação e limpeza que falha. O cenário é montado pelos serviços e
// pelo agendador, com banco e git reais numa raiz temporária, o pi e o `gh` falsos; só o agente da revisão integral é o
// teste, que age pelo domínio enquanto o pi falso espera.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { AUDITOR, FABRIQUINHA } from "../src/nucleo/ator.ts";
import { formatarTicketRef } from "../src/nucleo/demanda.ts";
import { reabrirTicket } from "../src/nucleo/transicoes_demanda.ts";
import { registrarFalhaEncerramento, registrarTentativaEncerramento } from "../src/nucleo/transicoes_encerramento.ts";
import { marcaDoPRFinal } from "../src/aplicacao/evidencias/encerramento_demanda.ts";
import { retomarFalhasDeInfraestrutura } from "../src/aplicacao/retomada_infraestrutura.ts";
import { comDemanda } from "../src/armazenamento/demandas.ts";
import { integrarPR } from "../src/infra/repositorio/pr.ts";
import { caminhoDaWorktreeDemanda, caminhoDaWorktreeRodada } from "../src/infra/repositorio/worktree-demanda.ts";
import {
  agente,
  agora,
  aprovarRodada,
  atual,
  despachoComEsperaCurta as deps,
  encerrar,
  execucoesDe,
  pi,
  revisaoIntegral,
  revisar,
  rodadaDe,
  rodadaEmEncerramento,
} from "./apoio-execucao.ts";
import { base, type Cenario, ciclo, criarCenario, demanda, git } from "./apoio.ts";
import type { PRFalso } from "../apoio-testes/hospedagem_falsa.ts";
import { ghFalso } from "./falsos.ts";

const gh = ghFalso(base);

const tickets = (c: Cenario, id: string, etapa: string) => demanda(c, id).tickets.filter((t) => t.etapa === etapa);
const ultimo = (c: Cenario, id: string, etapa: string) => tickets(c, id, etapa).at(-1);
const pontaDe = (c: Cenario, id: string) => demanda(c, id).demanda.branch;
/** Os merges que a hospedagem fez na base do projeto (o do PR final); os das rodadas ficam na branch da demanda. */
const mergesNaBase = (c: Cenario) =>
  git(c.bare, "log", "--first-parent", "--merges", "--format=%H", "main").split("\n").filter(Boolean);
const mergesPedidos = () => gh.chamadas().filter((x) => x.args.slice(0, 2).join(" ") === "pr merge").length;

/** Demanda em `encerramento` pelo percurso real: rodada 1 integrada e revisão integral aprovada pelo agente. */
async function demandaEmEncerramento(c: Cenario): Promise<string> {
  gh.zerar();
  const id = await rodadaEmEncerramento(c);
  await encerrar(c, id);
  await aprovarRodada(c, id, 1);
  await revisaoIntegral(c, id, "aprovada");
  assert.equal(demanda(c, id).demanda.estado, "encerrar_demanda");
  assert.equal(ultimo(c, id, "encerrar_demanda")?.estado, "aberto");
  return id;
}

/** O humano aprova e integra o PR final na plataforma: a Fabriquinha não faz esse merge. */
const integrarComoHumano = (c: Cenario, pr: number) =>
  integrarPR({ raiz_git: c.repo, hospedagem: "github" }, String(pr));

/** O PR final já aberto na hospedagem, com a marca que o encerramento adota. */
function abrirPRFinal(c: Cenario, id: string, extra: Partial<Omit<PRFalso, "id">>): number {
  gh.abrirPr({
    head: pontaDe(c, id),
    base: "main",
    titulo: "velho",
    corpo: marcaDoPRFinal(id),
    estado: "aberto",
    ...extra,
  });
  return gh.prs().length;
}

test("CA-SDLC-14: revisão integral reprovada abre rodada corretiva que percorre o ciclo completo e repete a revisão sobre o agregado", async (t) => {
  const c = criarCenario(t);
  gh.zerar();
  const id = await rodadaEmEncerramento(c);
  await encerrar(c, id);
  await aprovarRodada(c, id, 1);

  // Reprovada: as exigências ficam na decisão, a rodada concluída continua concluída e nasce a rodada corretiva.
  const primeira = await revisaoIntegral(c, id, { exigencias: "falta tratar a integração entre as partes" });
  let ag = demanda(c, id);
  assert.equal(ag.demanda.estado, "em_execucao");
  assert.deepEqual(
    ag.rodadas.map((r) => r.estado),
    ["concluida", "implementar"],
  );
  assert.deepEqual(
    ag.decisoes.filter((d) => d.ticket_id === primeira).map((d) => [d.resultado, d.motivo, d.por]),
    [
      [
        "recusado",
        "falta tratar a integração entre as partes",
        { tipo: "agente", trabalho_id: execucoesDe(c, { demanda_id: id, ticket_id: primeira }).at(-1)?.id },
      ],
    ],
  );

  // A rodada corretiva percorre o ciclo completo: implementação, revisão, PR e aprovação do Auditor.
  pi.roteirizar([{ agente }]);
  await ciclo(c, deps());
  assert.equal(rodadaDe(c, id, 2)?.estado, "revisar_rodada");
  await revisar(c, id, { aprovado: true }, 2);
  assert.equal(rodadaDe(c, id, 2)?.estado, "encerrar_rodada");
  await encerrar(c, id, 2);
  assert.equal(rodadaDe(c, id, 2)?.estado, "gate_pr");
  await aprovarRodada(c, id, 2);
  for (const etapa of ["implementar", "revisar_rodada", "encerrar_rodada"]) {
    assert.equal(atual(c, id, etapa, 2).estado, "concluido", etapa);
  }
  assert.deepEqual(
    gh.prs().map((p) => [p.base, p.estado]),
    [
      [pontaDe(c, id), "mergeado"],
      [pontaDe(c, id), "mergeado"],
    ],
  );

  // A revisão integral se repete, num revisor novo, na worktree da demanda com o resultado das duas rodadas.
  const segunda = await revisaoIntegral(c, id, "aprovada");
  assert.ok(segunda > primeira);
  assert.equal(pi.prompts().at(-1)?.cwd, caminhoDaWorktreeDemanda(c.raiz, c.projeto, id));
  const implementacoes = git(
    caminhoDaWorktreeDemanda(c.raiz, c.projeto, id),
    "log",
    "--format=%s",
    "--grep",
    `\\[${id}\\.T`,
  );
  assert.equal(implementacoes.split("\n").length, 2, "uma implementação por rodada no agregado");
  ag = demanda(c, id);
  assert.equal(ag.demanda.estado, "encerrar_demanda");
  assert.deepEqual(
    ag.decisoes
      .filter((d) => tickets(c, id, "revisar_demanda").some((t) => t.ticket_id === d.ticket_id))
      .map((d) => d.resultado),
    ["recusado", "aprovado"],
  );
});

test("CA-SDLC-15: revisão integral aprovada encerra com o merge humano; conflito abre agente e check falho bloqueia sem integrar nem limpar", async (t) => {
  // Conflito: o ciclo abre o resolver_conflito, o agente resolve na worktree da demanda e o encerramento conclui.
  const c = criarCenario(t);
  const id = await demandaEmEncerramento(c);
  const pr = abrirPRFinal(c, id, { conflito: true });
  await ciclo(c, deps());
  assert.equal(ultimo(c, id, "resolver_conflito")?.estado, "aberto");
  assert.equal(demanda(c, id).demanda.estado, "encerrar_demanda");
  assert.equal(mergesNaBase(c).length, 0);

  pi.roteirizar([{ agente }]);
  await ciclo(c, deps());
  assert.equal(ultimo(c, id, "resolver_conflito")?.estado, "concluido");
  assert.equal(pi.prompts().at(-1)?.cwd, caminhoDaWorktreeDemanda(c.raiz, c.projeto, id));
  assert.equal(demanda(c, id).demanda.estado, "encerrar_demanda");

  gh.mudar(pr, { conflito: false });
  const pedidosAntes = mergesPedidos();
  await ciclo(c, deps());
  await ciclo(c, deps());
  assert.equal(demanda(c, id).encerramento?.aguardando_merge_humano, true);
  assert.equal(ultimo(c, id, "encerrar_demanda")?.estado, "aberto");
  assert.equal(mergesNaBase(c).length, 0, "a Fabriquinha não integra o PR final");
  assert.equal(mergesPedidos(), pedidosAntes);

  await integrarComoHumano(c, pr);
  await ciclo(c, deps());
  const concluida = demanda(c, id);
  assert.equal(concluida.demanda.estado, "concluida");
  assert.equal(ultimo(c, id, "encerrar_demanda")?.estado, "concluido");
  const encerramentos = tickets(c, id, "encerrar_demanda").map((t) => t.ticket_id);
  assert.deepEqual(
    concluida.decisoes.filter((d) => encerramentos.includes(d.ticket_id)),
    [],
    "nenhuma decisão humana no encerramento final",
  );
  assert.equal(gh.prs().length, 2, "o PR da rodada e o final");
  assert.equal(mergesNaBase(c).length, 1);

  // Check falho: o ticket falha em check_final; nada é integrado nem limpo.
  const falho = criarCenario(t);
  const idFalho = await demandaEmEncerramento(falho);
  const pedidos = mergesPedidos();
  abrirPRFinal(falho, idFalho, { checks: [{ nome: "ci", estado: "falho" }] });
  await ciclo(falho, deps());
  const bloqueada = demanda(falho, idFalho);
  assert.equal(bloqueada.demanda.estado, "encerrar_demanda");
  assert.equal(ultimo(falho, idFalho, "encerrar_demanda")?.estado, "falhou");
  assert.equal(bloqueada.encerramento?.falha?.etapa, "check_final");
  assert.equal(bloqueada.encerramento.integracao, undefined);
  assert.deepEqual(bloqueada.encerramento.limpeza_pendente, []);
  assert.equal(gh.prs().at(-1)?.estado, "aberto");
  assert.equal(mergesNaBase(falho).length, 0);
  assert.equal(mergesPedidos(), pedidos, "nenhum pedido de merge do PR final");
  assert.ok(existsSync(caminhoDaWorktreeDemanda(falho.raiz, falho.projeto, idFalho)), "a worktree da demanda fica");
  assert.ok(existsSync(caminhoDaWorktreeRodada(falho.raiz, falho.projeto, { demanda_id: idFalho, rodada_id: 1 })));
  assert.notEqual(git(falho.repo, "branch", "--list", pontaDe(falho, idFalho)), "");
});

test("CA-SDLC-16: queda depois do merge e antes da gravação não duplica PR, integração nem decisão", async (t) => {
  const c = criarCenario(t);
  const id = await demandaEmEncerramento(c);

  // O processo caído já publicou o PR, gravou a tentativa e a hospedagem já fez o merge; o banco não tem a integração.
  const branch = pontaDe(c, id);
  git(c.repo, "push", "origin", `refs/heads/${branch}:refs/heads/${branch}`);
  const pr = abrirPRFinal(c, id, {});
  comDemanda(c.banco, id, (ag) =>
    registrarTentativaEncerramento(
      ag,
      {
        demanda_id: id,
        base: "main",
        pr: { numero: pr, url: `https://github.com/org/loja/pull/${String(pr)}` },
        sha: git(c.repo, "rev-parse", branch),
      },
      FABRIQUINHA,
    ),
  );
  const mergeSha = await integrarComoHumano(c, pr);
  const antes = demanda(c, id);
  assert.equal(antes.encerramento?.integracao, undefined);
  assert.equal(mergesNaBase(c).length, 1);
  const pedidos = mergesPedidos();

  // O agendador roda duas vezes: reconhece o merge, grava a integração uma vez e conclui; a segunda não tem o que fazer.
  await ciclo(c, deps());
  await ciclo(c, deps());
  const ag = demanda(c, id);
  assert.equal(ag.demanda.estado, "concluida");
  assert.equal(ag.encerramento?.integracao?.sha, mergeSha);
  assert.deepEqual(ag.decisoes, antes.decisoes, "nenhuma decisão nova");
  assert.equal(gh.prs().length, pr, "nenhum PR novo");
  assert.equal(mergesNaBase(c).length, 1);
  assert.equal(mergesPedidos(), pedidos, "a hospedagem não recebeu outro pedido de merge");
  assert.equal(tickets(c, id, "encerrar_demanda").length, 1);
});

test("CA-SDLC-17: limpeza que falha mantém a demanda não concluída e a reabertura repete só a limpeza", async (t) => {
  const c = criarCenario(t);
  const id = await demandaEmEncerramento(c);
  const rodada = caminhoDaWorktreeRodada(c.raiz, c.projeto, { demanda_id: id, rodada_id: 1 });
  git(c.repo, "worktree", "lock", rodada);

  await ciclo(c, deps());
  await integrarComoHumano(c, gh.prs().length);
  await ciclo(c, deps());
  const parcial = demanda(c, id);
  const sha = parcial.encerramento?.integracao?.sha;
  assert.ok(sha, "a integração está confirmada");
  assert.equal(parcial.demanda.estado, "encerrar_demanda");
  assert.equal(ultimo(c, id, "encerrar_demanda")?.estado, "falhou");
  assert.equal(parcial.encerramento?.falha?.etapa, "limpeza");
  assert.ok(parcial.encerramento.limpeza_pendente.includes(`worktree:${rodada}`));
  assert.equal(mergesNaBase(c).length, 1);
  const pedidos = mergesPedidos();

  // O Auditor destrava e reabre o ticket: o ciclo seguinte só limpa.
  git(c.repo, "worktree", "unlock", rodada);
  const ticket_id = ultimo(c, id, "encerrar_demanda")?.ticket_id;
  comDemanda(c.banco, id, (ag) =>
    reabrirTicket(ag, { ticket_id, instrucao: "a worktree foi destravada" }, AUDITOR, { agora: agora() }),
  );
  await ciclo(c, deps());
  const ag = demanda(c, id);
  assert.equal(ag.demanda.estado, "concluida");
  assert.equal(ag.encerramento?.integracao?.sha, sha);
  assert.deepEqual(ag.encerramento.limpeza_pendente, []);
  assert.equal(existsSync(rodada), false);
  assert.equal(mergesNaBase(c).length, 1, "nenhum merge novo");
  assert.equal(mergesPedidos(), pedidos);
  assert.equal(gh.prs().length, 2, "o PR da rodada e o final");
});

test("falha de infraestrutura no passo integracao é retomada sozinha e a nova Tentativa só repete a integracao", async (t) => {
  const c = criarCenario(t);
  const id = await demandaEmEncerramento(c);
  await ciclo(c, deps());
  const pr = gh.prs().length;
  const esperando = demanda(c, id).encerramento;
  assert.equal(esperando?.aguardando_merge_humano, true);

  // O passo integracao falha por infraestrutura (a leitura do PR estourou o tempo), com tudo antes dele já feito.
  const ticket = ultimo(c, id, "encerrar_demanda");
  assert.ok(ticket);
  comDemanda(c.banco, id, (ag) =>
    registrarFalhaEncerramento(
      ag,
      { demanda_id: id, etapa: "integracao", causa: "tempo_limite", motivo: "tempo limite ao ler o PR final" },
      FABRIQUINHA,
      { agora: agora() },
    ),
  );
  assert.equal(ultimo(c, id, "encerrar_demanda")?.estado, "falhou");

  // Sem ação do Auditor: depois da espera da falha transitória, a retomada automática reabre o encerramento.
  const passadaAEspera = new Date(Date.now() + 3 * 60_000);
  assert.deepEqual(retomarFalhasDeInfraestrutura(c.banco, passadaAEspera), [formatarTicketRef(ticket)]);
  assert.equal(ultimo(c, id, "encerrar_demanda")?.estado, "aberto");
  assert.deepEqual(demanda(c, id).encerramento?.pr, esperando.pr);

  // A nova Tentativa continua na integracao: não publica outro PR nem refaz a tentativa; o merge humano conclui.
  await integrarComoHumano(c, pr);
  await ciclo(c, deps());
  const ag = demanda(c, id);
  assert.equal(ag.demanda.estado, "concluida");
  assert.equal(ag.encerramento?.sha_verificado, esperando.sha_verificado);
  assert.equal(gh.prs().length, pr, "nenhum PR novo");
  assert.equal(tickets(c, id, "encerrar_demanda").length, 1);
});
