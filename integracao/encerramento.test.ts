// Seção 12 de comparacao-sdlc-implementacao.md, CA-SDLC-14 a 17 (o encerramento): revisão integral reprovada, encerramento
// final sem gate, queda entre o efeito externo e a gravação e limpeza que falha. O cenário é montado pelos serviços e
// pelo agendador, com banco e git reais numa raiz temporária, o pi e o `gh` falsos; só o agente da revisão integral é o
// teste, que age pelo domínio enquanto o pi falso espera.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { AUDITOR, FABRIQUINHA } from "../src/dominio/agregado.ts";
import { reabrirTicket } from "../src/dominio/transicoes_demanda.ts";
import { registrarTentativaEncerramento } from "../src/dominio/transicoes_encerramento.ts";
import { marcaDoPRFinal } from "../src/evidencias/encerramento_demanda.ts";
import { aprovarPRRodada } from "../src/execucao/aprovacao_pr_rodada.ts";
import type { DepsDespacho } from "../src/execucao/despacho_demanda.ts";
import { decidirRevisaoIntegral } from "../src/execucao/revisao_demanda.ts";
import { comDemanda } from "../src/persistencia/demandas.ts";
import { integrarPR } from "../src/repositorio/pr.ts";
import { caminhoDaWorktreeDemanda, caminhoDaWorktreeRodada } from "../src/repositorio/worktree-demanda.ts";
import {
  agente,
  agora,
  atual,
  comoAgente,
  despacho,
  despacharComAgente,
  encerrar,
  pi,
  revisar,
  rodadaDe,
  rodadaEmEncerramento,
} from "./apoio-execucao.ts";
import { base, type Cenario, ciclo, criarCenario, demanda, git } from "./apoio.ts";
import type { PRFalso } from "../src/repositorio/hospedagem-falsa.test.ts";
import { ghFalso } from "./falsos.ts";

const gh = ghFalso(base);

/** O despacho dos outros casos com a espera do PR encurtada: o `gh` falso responde na hora. */
const deps = (): DepsDespacho => ({ ...despacho(), verificacao: { intervaloMs: 1, carenciaMs: 0, limiteMs: 5000 } });

const tickets = (c: Cenario, id: string, etapa: string) => demanda(c, id).tickets.filter((t) => t.etapa === etapa);
const ultimo = (c: Cenario, id: string, etapa: string) => tickets(c, id, etapa).at(-1);
const pontaDe = (c: Cenario, id: string) => demanda(c, id).demanda.branch;
/** Os merges que a hospedagem fez na base do projeto (o do PR final); os das rodadas ficam na branch da demanda. */
const mergesNaBase = (c: Cenario) =>
  git(c.bare, "log", "--first-parent", "--merges", "--format=%H", "main").split("\n").filter(Boolean);
const mergesPedidos = () => gh.chamadas().filter((x) => x.args.slice(0, 2).join(" ") === "pr merge").length;

/** Revisão integral: o agendador inicia e conduz a etapa; o agente (o teste) submete as evidências e decide durante a execução. */
async function revisaoIntegral(c: Cenario, id: string, decisao: "aprovada" | { exigencias: string }): Promise<number> {
  let revisor = 0;
  await despacharComAgente(c, deps(), () => {
    const ticket = ultimo(c, id, "revisar_demanda");
    assert.equal(ticket?.status, "em_execucao", "a revisão integral espera a decisão do agente");
    const { ticket_id } = ticket;
    revisor = ticket_id;
    const agenteDoTicket = { tipo: "agente", execucao: 1, ticket: ticket_id } as const;
    if (decisao === "aprovada") {
      comoAgente(c, id, ticket_id, [
        ["comprovacao_criterios", { criterios: [{ id: "CA-1", atendido: true, arquivos: [] }] }],
        ["testes_estresse", { aplicavel: false, cenarios: [], justificativa: "sem carga" }],
        ["analise_seguranca", { aplicavel: false, ameacas: [], achados: [], justificativa: "sem superfície" }],
      ]);
      decidirRevisaoIntegral(c.banco, { demanda_id: id, ticket_id, aprovado: true }, agenteDoTicket);
    } else {
      const plano = {
        demanda_id: id,
        criterios: ["CA-1"],
        rodadas: [{ demanda_id: id, rodada_id: 1, titulo: "Corrigir o agregado", e2e: false, criterios: ["CA-1"] }],
        tickets: [{ demanda_id: id, ticket_id: 1, rodada_id: 1, titulo: "Corrigir a integração", descricao: "d" }],
      };
      decidirRevisaoIntegral(
        c.banco,
        { demanda_id: id, ticket_id, aprovado: false, exigencias: decisao.exigencias, plano },
        agenteDoTicket,
      );
    }
  });
  return revisor;
}

/** Aprova o PR que o encerramento da rodada publicou, como o Auditor, e integra a rodada na demanda. */
async function aprovarRodada(c: Cenario, id: string, rodada: number): Promise<void> {
  await aprovarPRRodada(c.banco, { demanda_id: id, rodada_id: rodada }, 4, AUDITOR);
  assert.equal(rodadaDe(c, id, rodada)?.fase, "concluida");
}

/** Demanda em `encerramento` pelo percurso real: rodada 1 integrada e revisão integral aprovada pelo agente. */
async function demandaEmEncerramento(c: Cenario): Promise<string> {
  gh.zerar();
  const id = await rodadaEmEncerramento(c);
  await encerrar(c, id);
  await aprovarRodada(c, id, 1);
  await revisaoIntegral(c, id, "aprovada");
  assert.equal(demanda(c, id).demanda.fase, "encerramento");
  assert.equal(ultimo(c, id, "encerrar_demanda")?.status, "aberto");
  return id;
}

/** O PR final já aberto na hospedagem, com a marca que o encerramento adota. */
function abrirPRFinal(c: Cenario, id: string, extra: Partial<Omit<PRFalso, "id">>): number {
  gh.abrir({
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
  assert.equal(ag.demanda.fase, "execucao");
  assert.deepEqual(
    ag.rodadas.map((r) => r.fase),
    ["concluida", "desenvolvimento"],
  );
  assert.deepEqual(
    ag.decisoes.filter((d) => d.ticket_id === primeira).map((d) => [d.resultado, d.motivo, d.por]),
    [["recusado", "falta tratar a integração entre as partes", "agente"]],
  );

  // A rodada corretiva percorre o ciclo completo: implementação, revisão, PR e aprovação do Auditor.
  pi.roteirizar([{ modo: "ok", agente }]);
  await ciclo(c, deps());
  assert.equal(rodadaDe(c, id, 2)?.fase, "revisao");
  await revisar(c, id, { aprovado: true }, 2);
  assert.equal(rodadaDe(c, id, 2)?.fase, "encerramento");
  await encerrar(c, id, 2);
  assert.equal(rodadaDe(c, id, 2)?.fase, "aprovacao_pull_request");
  await aprovarRodada(c, id, 2);
  for (const etapa of ["implementar", "revisar_rodada", "encerrar_rodada"]) {
    assert.equal(atual(c, id, etapa, 2).status, "concluido", etapa);
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
  assert.equal(pi.chamadas().at(-1)?.cwd, caminhoDaWorktreeDemanda(c.raiz, c.projeto, id));
  const implementacoes = git(
    caminhoDaWorktreeDemanda(c.raiz, c.projeto, id),
    "log",
    "--format=%s",
    "--grep",
    `\\[${id}\\.T`,
  );
  assert.equal(implementacoes.split("\n").length, 2, "uma implementação por rodada no agregado");
  ag = demanda(c, id);
  assert.equal(ag.demanda.fase, "encerramento");
  assert.deepEqual(
    ag.decisoes
      .filter((d) => tickets(c, id, "revisar_demanda").some((t) => t.ticket_id === d.ticket_id))
      .map((d) => d.resultado),
    ["recusado", "aprovado"],
  );
});

test("CA-SDLC-15: revisão integral aprovada encerra sem gate humano; conflito abre agente e check falho bloqueia sem integrar nem limpar", async (t) => {
  // Conflito: o ciclo abre o resolver_conflito, o agente resolve na worktree da demanda e o encerramento conclui.
  const c = criarCenario(t);
  const id = await demandaEmEncerramento(c);
  const pr = abrirPRFinal(c, id, { conflito: true });
  await ciclo(c, deps());
  assert.equal(ultimo(c, id, "resolver_conflito")?.status, "aberto");
  assert.equal(demanda(c, id).demanda.fase, "encerramento");
  assert.equal(mergesNaBase(c).length, 0);

  pi.roteirizar([{ modo: "ok", agente }]);
  await ciclo(c, deps());
  assert.equal(ultimo(c, id, "resolver_conflito")?.status, "concluido");
  assert.equal(pi.chamadas().at(-1)?.cwd, caminhoDaWorktreeDemanda(c.raiz, c.projeto, id));
  assert.equal(demanda(c, id).demanda.fase, "encerramento");

  gh.mudar(pr, { conflito: false });
  await ciclo(c, deps());
  const concluida = demanda(c, id);
  assert.equal(concluida.demanda.fase, "concluida");
  assert.equal(ultimo(c, id, "encerrar_demanda")?.status, "concluido");
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
  assert.equal(bloqueada.demanda.fase, "encerramento");
  assert.equal(ultimo(falho, idFalho, "encerrar_demanda")?.status, "falhou");
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
  const mergeSha = await integrarPR({ repo: c.repo, hospedagem: "github" }, String(pr));
  const antes = demanda(c, id);
  assert.equal(antes.encerramento?.integracao, undefined);
  assert.equal(mergesNaBase(c).length, 1);
  const pedidos = mergesPedidos();

  // O agendador roda duas vezes: reconhece o merge, grava a integração uma vez e conclui; a segunda não tem o que fazer.
  await ciclo(c, deps());
  await ciclo(c, deps());
  const ag = demanda(c, id);
  assert.equal(ag.demanda.fase, "concluida");
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
  const parcial = demanda(c, id);
  const sha = parcial.encerramento?.integracao?.sha;
  assert.ok(sha, "a integração está confirmada");
  assert.equal(parcial.demanda.fase, "encerramento");
  assert.equal(ultimo(c, id, "encerrar_demanda")?.status, "falhou");
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
  assert.equal(ag.demanda.fase, "concluida");
  assert.equal(ag.encerramento?.integracao?.sha, sha);
  assert.deepEqual(ag.encerramento.limpeza_pendente, []);
  assert.equal(existsSync(rodada), false);
  assert.equal(mergesNaBase(c).length, 1, "nenhum merge novo");
  assert.equal(mergesPedidos(), pedidos);
  assert.equal(gh.prs().length, 2, "o PR da rodada e o final");
});
