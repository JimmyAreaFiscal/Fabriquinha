// Seção 12 de comparacao-sdlc-implementacao.md, CA-SDLC-07 a 10 (a execução): rodadas paralelas e dependentes, corrida
// entre agendador e "executar agora", implementação sem submissão e falha, timeout e reinício. O cenário é montado pelos
// serviços e pelo agendador, com banco e git reais numa raiz temporária e o pi falso; nada passa pela web. As verificações
// (testes, fitness e Sonar) são o único ponto injetado: o Sonar não existe aqui.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { AUDITOR } from "../src/dominio/agregado.ts";
import { reabrirTicket } from "../src/dominio/transicoes_demanda.ts";
import { criarSessao, iniciarExecucao } from "../src/dominio/sessoes.ts";
import { despacharDemandas, executarAgoraDemanda } from "../src/execucao/despacho_demanda.ts";
import { recuperarExecucoesDemanda } from "../src/execucao/execucao_demanda.ts";
import { comDemanda } from "../src/persistencia/demandas.ts";
import { alterarLimiteParalelismo, configuracao } from "../src/persistencia/servico.ts";
import { carregarSessoesDoTicket, comSessoesDoTicket } from "../src/persistencia/sessoes.ts";
import { caminhoDaWorktreeRodada } from "../src/repositorio/worktree-demanda.ts";
import {
  abrirPortao,
  agente,
  demandaEmExecucao,
  despacho,
  execucoesDe,
  fecharPortao,
  pi,
  pisAteAgora,
  rodadaDe,
  statusDe,
  ticketDe,
} from "./apoio-execucao.ts";
import { type Cenario, criarCenario, demanda, esperar, git } from "./apoio.ts";

const ativosPorRodada = (c: Cenario, id: string) => {
  const porRodada = new Map<number | undefined, number>();
  for (const t of demanda(c, id).tickets.filter((x) => x.status === "em_execucao"))
    porRodada.set(t.rodada_id, (porRodada.get(t.rodada_id) ?? 0) + 1);
  return porRodada;
};

test("CA-SDLC-07: rodadas independentes executam em paralelo, a dependente aguarda e nunca há dois tickets ativos na mesma rodada", async (t) => {
  const c = criarCenario(t);
  const id = await demandaEmExecucao(c, [{ tickets: 2 }, { tickets: 1 }, { depende: [1], tickets: 1 }]);
  const [r1t1, r1t2, r2t1, r3t1] = [ticketDe(c, id, 1), ticketDe(c, id, 1, 2), ticketDe(c, id, 2), ticketDe(c, id, 3)];
  fecharPortao();
  pi.roteirizar([{ modo: "ok", agente }]);
  const deps = despacho();

  // D04: o limite global vale para todas as rodadas; com 1 vaga só a primeira (R1) executa e o "executar agora" é recusado.
  alterarLimiteParalelismo(c.banco, 1);
  const primeiro = despacharDemandas(c.banco, configuracao(c.banco), deps);
  assert.equal(primeiro.length, 1);
  assert.equal(despacharDemandas(c.banco, configuracao(c.banco), deps).length, 0);
  assert.equal(statusDe(c, r1t1), "em_execucao");
  assert.equal(statusDe(c, r2t1), "aberto");
  assert.throws(() => executarAgoraDemanda(c.banco, r2t1, c.config, deps), /limite global de paralelismo/);
  abrirPortao();
  await Promise.all(primeiro);
  assert.equal(statusDe(c, r1t1), "concluido");

  // Com vagas: R1.T2 e R2 executam juntas; R3 (depende de R1, ainda não concluída) aguarda, e R1 não tem dois ativos.
  fecharPortao();
  alterarLimiteParalelismo(c.banco, 4);
  const juntas = despacharDemandas(c.banco, configuracao(c.banco), deps);
  assert.equal(juntas.length, 2);
  assert.equal(statusDe(c, r1t2), "em_execucao");
  assert.equal(statusDe(c, r2t1), "em_execucao");
  assert.equal(statusDe(c, r3t1), "aberto");
  assert.ok([...ativosPorRodada(c, id).values()].every((n) => n === 1));
  assert.throws(() => executarAgoraDemanda(c.banco, r3t1, c.config, deps), /depende|rodada/);
  assert.equal(despacharDemandas(c.banco, configuracao(c.banco), deps).length, 0);
  abrirPortao();
  await Promise.all(juntas);

  // Implementações concluídas levam R1 e R2 à revisão; R3 segue aberta até a conclusão de R1 (a revisão ainda não rodou).
  assert.deepEqual(
    [rodadaDe(c, id, 1)?.fase, rodadaDe(c, id, 2)?.fase, rodadaDe(c, id, 3)?.fase],
    ["revisao", "revisao", "desenvolvimento"],
  );
  assert.equal(statusDe(c, r3t1), "aberto");
  assert.equal(pisAteAgora(), 3);
});

test("CA-SDLC-08: agendador e executar agora disputam o mesmo ticket e só uma reserva/execução acontece", async (t) => {
  const c = criarCenario(t);
  const a = await demandaEmExecucao(c, [{ tickets: 1 }]);
  const d = await demandaEmExecucao(c, [{ tickets: 1 }]);
  const [ta, td] = [ticketDe(c, a, 1), ticketDe(c, d, 1)];
  fecharPortao();
  pi.roteirizar([{ modo: "ok", agente }]);
  const deps = despacho();
  alterarLimiteParalelismo(c.banco, 4);

  // "Executar agora" da demanda d primeiro, o agendador logo depois: o ciclo reserva só o que sobra (a), não d de novo.
  const manual = executarAgoraDemanda(c.banco, td, c.config, deps);
  const ciclo = despacharDemandas(c.banco, c.config, deps);
  assert.equal(ciclo.length, 1);
  assert.deepEqual([statusDe(c, ta), statusDe(c, td)], ["em_execucao", "em_execucao"]);

  // Agora o inverso em a (reservada pelo agendador): "executar agora" encontra o ticket em execução; idem em d.
  assert.throws(() => executarAgoraDemanda(c.banco, ta, c.config, deps), /está em_execucao/);
  assert.throws(() => executarAgoraDemanda(c.banco, td, c.config, deps), /está em_execucao/);
  assert.equal(despacharDemandas(c.banco, c.config, deps).length, 0);
  await esperar(() => pisAteAgora() === 2, "o pi receber um prompt por ticket");
  abrirPortao();
  await Promise.all([manual, ...ciclo]);
  assert.deepEqual([statusDe(c, ta), statusDe(c, td)], ["concluido", "concluido"]);
  assert.equal(execucoesDe(c, ta).length, 1);
  assert.equal(execucoesDe(c, td).length, 1);
  assert.equal(pisAteAgora(), 2);
});

test("CA-SDLC-09: o agente termina sem submeter; a aplicação verifica, coleta e commita, e saída ok não conclui trabalho inválido", async (t) => {
  const c = criarCenario(t);
  const id = await demandaEmExecucao(c, [{ tickets: 1 }]);
  const ref = ticketDe(c, id, 1);
  const worktree = caminhoDaWorktreeRodada(c.raiz, c.projeto, { demanda_id: id, rodada_id: 1 });
  abrirPortao();
  pi.roteirizar([{ modo: "ok", agente }]);
  let aprovada = false;
  const deps = despacho(() => aprovada);

  // O pi termina bem, mas as verificações reprovam: devolvido com a instrução, sem commit nem conclusão.
  await executarAgoraDemanda(c.banco, ref, c.config, deps);
  const devolvido = demanda(c, id).tickets.find((x) => x.ticket_id === ref.ticket_id);
  assert.ok(devolvido);
  assert.equal(devolvido.status, "aberto", devolvido.motivo_falha);
  assert.equal(devolvido.devolucoes, 1);
  assert.match(devolvido.instrucao ?? "", /execucao_testes: reprovado no teste/);
  assert.equal(execucoesDe(c, ref)[0]?.erro, undefined);
  assert.equal(rodadaDe(c, id, 1)?.fase, "desenvolvimento");
  assert.equal(
    git(worktree, "log", "--fixed-strings", "--grep", `[${id}.T${String(ref.ticket_id)}]`, "--format=%H"),
    "",
  );

  // Reexecutado (mesma sessão) e aprovado: a aplicação grava as evidências, commita e conclui; o agente não submeteu nada.
  aprovada = true;
  await executarAgoraDemanda(c.banco, ref, c.config, deps);
  const ag = demanda(c, id);
  assert.equal(statusDe(c, ref), "concluido");
  assert.equal(rodadaDe(c, id, 1)?.fase, "revisao");
  assert.equal(execucoesDe(c, ref).length, 2);
  assert.equal(carregarSessoesDoTicket(c.banco, ref).sessoes.length, 1);
  const evidencias = ag.evidencias.filter((e) => e.ticket_id === ref.ticket_id);
  assert.deepEqual(
    evidencias.map((e) => e.tipo).sort(),
    ["execucao_testes", "matriz_fitness", "relatorio_sonar"].sort(),
  );
  assert.ok(evidencias.every((e) => e.dados.aprovada === true));
  assert.match(
    git(worktree, "log", "-1", "--format=%s"),
    new RegExp(`^feat: Ticket 1.1 \\[${id}\\.T${String(ref.ticket_id)}\\]$`),
  );
  assert.equal(git(worktree, "show", "--name-only", "--format=", "HEAD"), "feature.txt");
  assert.equal(git(worktree, "status", "--porcelain"), "");
});

/** Abre o ticket falho com a instrução do Auditor; a reabertura não executa nada. */
const reabrir = (c: Cenario, ref: { demanda_id: string; ticket_id: number }, instrucao?: string) =>
  comDemanda(c.banco, ref.demanda_id, (ag) =>
    reabrirTicket(ag, { ticket_id: ref.ticket_id, instrucao }, AUDITOR, { agora: new Date().toISOString() }),
  );

test("CA-SDLC-10: falha, timeout e reinício bloqueiam o escopo, preservam o histórico e a reabertura exige instrução sem executar na hora", async (t) => {
  const c = criarCenario(t);
  const id = await demandaEmExecucao(c, [{ tickets: 2 }]);
  const [t1, t2] = [ticketDe(c, id, 1), ticketDe(c, id, 1, 2)];
  const deps = despacho();
  const fase = () => rodadaDe(c, id, 1)?.fase;

  // Falha: o pi sai com erro; o ticket falha, a segunda tarefa da rodada não avança e a fase não muda.
  pi.roteirizar([{ modo: "erro" }]);
  await Promise.all(despacharDemandas(c.banco, c.config, deps));
  assert.equal(statusDe(c, t1), "falhou");
  assert.match(
    demanda(c, id).tickets.find((x) => x.ticket_id === t1.ticket_id)?.motivo_falha ?? "",
    /código 1|falha do pi falso/,
  );
  assert.equal(execucoesDe(c, t1).length, 1);
  const bloqueado = () => {
    assert.equal(despacharDemandas(c.banco, c.config, deps).length, 0);
    assert.equal(statusDe(c, t2), "aberto");
    assert.equal(fase(), "desenvolvimento");
  };
  bloqueado();
  assert.throws(() => executarAgoraDemanda(c.banco, t2, c.config, deps), /está falhou/);

  // Reabrir exige instrução e não executa na hora: o ticket só fica aberto, sem nova execução nem prompt.
  assert.throws(() => reabrir(c, t1), /instrução|instrucao/);
  assert.throws(() => reabrir(c, t1, "  "), /instrução|instrucao/);
  assert.equal(statusDe(c, t1), "falhou");
  const antes = pisAteAgora();
  reabrir(c, t1, "tente de novo, com atenção ao cache");
  assert.equal(statusDe(c, t1), "aberto");
  assert.equal(execucoesDe(c, t1).length, 1);
  assert.equal(pisAteAgora(), antes);

  // Timeout: o pi trava e o limite (fracionário, só no teste) estoura; histórico das duas execuções e a mesma sessão.
  pi.roteirizar([{ modo: "trava" }]);
  const curto = { ...c.config, timeoutMin: 0.01 };
  await Promise.all(despacharDemandas(c.banco, curto, deps));
  assert.match(pi.chamadas().at(-1)?.prompt ?? "", /Reabertura[\s\S]*tente de novo, com atenção ao cache/);
  assert.equal(statusDe(c, t1), "falhou");
  assert.match(demanda(c, id).tickets.find((x) => x.ticket_id === t1.ticket_id)?.motivo_falha ?? "", /tempo limite/);
  const historico = execucoesDe(c, t1);
  assert.equal(historico.length, 2);
  assert.match(historico[0]?.erro ?? "", /1|falha do pi falso/);
  assert.match(historico[1]?.erro ?? "", /tempo limite/);
  assert.equal(carregarSessoesDoTicket(c.banco, t1).sessoes.length, 1);
  bloqueado();

  // Reinício do serviço: execução aberta de uma instância anterior falha, sem avançar; as anteriores seguem no histórico.
  reabrir(c, t1, "mais uma vez");
  const sessao = carregarSessoesDoTicket(c.banco, t1).sessoes[0];
  assert.ok(sessao);
  const execucao = { id: randomUUID(), sessao_id: sessao.id, inicio: new Date().toISOString(), falha: false };
  comDemanda(c.banco, id, (ag) => ({
    ...ag,
    tickets: ag.tickets.map((x) => (x.ticket_id === t1.ticket_id ? { ...x, status: "em_execucao" as const } : x)),
  }));
  comSessoesDoTicket(c.banco, t1, (estado) => ({
    ...estado,
    execucoes: iniciarExecucao(criarSessao([], sessao), estado.execucoes, execucao),
  }));
  recuperarExecucoesDemanda(c.banco);
  assert.equal(statusDe(c, t1), "falhou");
  assert.match(
    demanda(c, id).tickets.find((x) => x.ticket_id === t1.ticket_id)?.motivo_falha ?? "",
    /serviço reiniciado/,
  );
  const final = execucoesDe(c, t1);
  assert.equal(final.length, 3);
  assert.equal(final.at(-1)?.erro, "serviço reiniciado");
  assert.deepEqual(final.slice(0, 2), historico);
  bloqueado();
  assert.equal(existsSync(join(c.raiz, "execucoes")), true);
});
