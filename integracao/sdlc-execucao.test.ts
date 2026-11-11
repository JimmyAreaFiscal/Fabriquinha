// Seção 12 de comparacao-sdlc-implementacao.md, CA-SDLC-07 a 10 (a execução): rodadas paralelas e dependentes, corrida
// entre agendador e "executar agora", implementação sem submissão e falha, timeout e reinício. O cenário é montado pelos
// serviços e pelo agendador, com banco e git reais numa raiz temporária e o pi falso; nada passa pela web. As verificações
// (testes, fitness e Sonar) são o único ponto injetado: o Sonar não existe aqui.
import type { MotivoDeRecusa } from "../src/sdlc/nucleo/despacho/despacho.ts";
import { Endereco } from "../src/compartilhado/nucleo/vocabulario_do_sdlc/endereco.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { comTentativaAberta, motivoDaFalhaDoTicket, tentativasDoTicket } from "../src/sdlc/nucleo/tentativa.ts";
import { AUDITOR } from "../src/compartilhado/nucleo/vocabulario_do_sdlc/ator.ts";
import { reabrirTicket } from "../src/sdlc/nucleo/transicoes/transicoes_demanda.ts";
import { criarTrabalho, iniciarProcesso } from "../src/trabalho_agentico/nucleo/trabalho_agentico.ts";
import { cicloDoDespacho, executarAgora } from "../src/sdlc/aplicacao/despacho/despacho.ts";
import { retomarFalhasDeInfraestrutura } from "../src/sdlc/aplicacao/despacho/retomada_infraestrutura.ts";
import { condutor } from "../src/trabalho_agentico/aplicacao/trabalho/condutor.ts";
import { comDemanda } from "../src/sdlc/armazenamento/demandas.ts";
import { configuracao } from "../src/compartilhado/armazenamento/servico.ts";
import {
  carregarTrabalhosDoTicket,
  comTrabalhosDoTicket,
} from "../src/trabalho_agentico/armazenamento/trabalho_agentico.ts";
import { caminhoDaWorktreeRodada } from "../src/repositorio/infra/worktree/worktree-demanda.ts";
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
import { type Cenario, criarCenario, demanda, esperar, git, gravarLimiteParalelismo } from "./apoio.ts";
import { recuperacaoDaSubida } from "../src/composicao/servico.ts";
import { relogioDoSistema } from "../src/compartilhado/nucleo/relogio.ts";

const motivoDoTicket = (c: Cenario, id: string, ticket_id: number) => {
  const agregado = demanda(c, id);
  const ticket = agregado.tickets.find((candidato) => candidato.ticket_id === ticket_id);
  assert.ok(ticket);
  return motivoDaFalhaDoTicket(agregado.tentativas, ticket);
};
const motivoDaExecucao = (c: Cenario, id: string, processo_id: string | undefined) => {
  const resultado = demanda(c, id).tentativas.find((tentativa) => tentativa.processo_id === processo_id)?.resultado;
  return resultado && "motivo" in resultado ? resultado.motivo : undefined;
};

const ativosPorRodada = (c: Cenario, id: string) => {
  const porRodada = new Map<number | undefined, number>();
  for (const t of demanda(c, id).tickets.filter((x) => x.estado === "em_execucao"))
    porRodada.set(t.rodada_id, (porRodada.get(t.rodada_id) ?? 0) + 1);
  return porRodada;
};

test("CA-SDLC-07: rodadas independentes executam em paralelo, a dependente aguarda e nunca há dois tickets ativos na mesma rodada", async (t) => {
  const c = criarCenario(t);
  const id = await demandaEmExecucao(c, [{ tickets: 2 }, { tickets: 1 }, { depende: [1], tickets: 1 }]);
  const [r1t1, r1t2, r2t1, r3t1] = [ticketDe(c, id, 1), ticketDe(c, id, 1, 2), ticketDe(c, id, 2), ticketDe(c, id, 3)];
  fecharPortao();
  pi.roteirizar([{ agente }]);
  const deps = despacho();

  // D04: o limite global vale para todas as rodadas; com 1 vaga só a primeira (R1) executa e o "executar agora" é negado.
  gravarLimiteParalelismo(c.banco, 1);
  const primeiro = cicloDoDespacho(c.banco, configuracao(c.banco), deps);
  assert.equal(primeiro.length, 1);
  assert.equal(cicloDoDespacho(c.banco, configuracao(c.banco), deps).length, 0);
  assert.equal(statusDe(c, r1t1), "em_execucao");
  assert.equal(statusDe(c, r2t1), "aberto");
  assert.deepEqual(executarAgora(c.banco, r2t1, c.config, deps), {
    tipo: "limite_de_paralelismo",
    em_uso: 1,
    limite: 1,
  });
  abrirPortao();
  await Promise.all(primeiro);
  assert.equal(statusDe(c, r1t1), "concluido");

  // Com vagas: R1.T2 e R2 executam juntas; R3 (depende de R1, ainda não concluída) aguarda, e R1 não tem dois ativos.
  fecharPortao();
  gravarLimiteParalelismo(c.banco, 4);
  const juntas = cicloDoDespacho(c.banco, configuracao(c.banco), deps);
  assert.equal(juntas.length, 2);
  assert.equal(statusDe(c, r1t2), "em_execucao");
  assert.equal(statusDe(c, r2t1), "em_execucao");
  assert.equal(statusDe(c, r3t1), "aberto");
  assert.ok([...ativosPorRodada(c, id).values()].every((n) => n === 1));
  assert.equal((executarAgora(c.banco, r3t1, c.config, deps) as MotivoDeRecusa).tipo, "dependencia_pendente");
  assert.equal(cicloDoDespacho(c.banco, configuracao(c.banco), deps).length, 0);
  abrirPortao();
  await Promise.all(juntas);

  // Implementações concluídas levam R1 e R2 à revisão; R3 segue aberta até a conclusão de R1 (a revisão ainda não rodou).
  assert.deepEqual(
    [rodadaDe(c, id, 1)?.estado, rodadaDe(c, id, 2)?.estado, rodadaDe(c, id, 3)?.estado],
    ["revisar_rodada", "revisar_rodada", "implementar"],
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
  pi.roteirizar([{ agente }]);
  const deps = despacho();
  gravarLimiteParalelismo(c.banco, 4);

  // "Executar agora" da demanda d primeiro, o agendador logo depois: o ciclo reserva só o que sobra (a), não d de novo.
  const manual = executarAgora(c.banco, td, c.config, deps);
  const ciclo = cicloDoDespacho(c.banco, c.config, deps);
  assert.equal(ciclo.length, 1);
  assert.deepEqual([statusDe(c, ta), statusDe(c, td)], ["em_execucao", "em_execucao"]);

  // Agora o inverso em a (reservada pelo agendador): "executar agora" encontra o ticket em execução; idem em d.
  assert.throws(() => executarAgora(c.banco, ta, c.config, deps), /está em_execucao/);
  assert.throws(() => executarAgora(c.banco, td, c.config, deps), /está em_execucao/);
  assert.equal(cicloDoDespacho(c.banco, c.config, deps).length, 0);
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
  pi.roteirizar([{ agente }]);
  let verificacoesPassam = false;
  const deps = despacho(() => verificacoesPassam);

  // O pi termina bem, mas as verificações reprovam: devolvido com a instrução, sem commit nem conclusão.
  await executarAgora(c.banco, ref, c.config, deps);
  const devolvido = demanda(c, id).tickets.find((x) => x.ticket_id === ref.ticket_id);
  assert.ok(devolvido);
  assert.equal(devolvido.estado, "aberto", motivoDoTicket(c, id, ref.ticket_id));
  assert.equal(
    tentativasDoTicket(demanda(c, id).tentativas, ref.ticket_id).filter(
      (tentativa) => tentativa.resultado?.tipo === "reprovacao",
    ).length,
    1,
  );
  assert.match(devolvido.instrucao ?? "", /execucao_testes: reprovado no teste/);
  assert.equal(execucoesDe(c, ref)[0]?.falha, false);
  assert.equal(rodadaDe(c, id, 1)?.estado, "implementar");
  assert.equal(
    git(worktree, "log", "--fixed-strings", "--grep", `[${id}.T${String(ref.ticket_id)}]`, "--format=%H"),
    "",
  );

  // Reexecutado (mesma sessão) e aprovado: a aplicação grava as evidências, commita e conclui; o agente não submeteu nada.
  verificacoesPassam = true;
  await executarAgora(c.banco, ref, c.config, deps);
  const ag = demanda(c, id);
  assert.equal(statusDe(c, ref), "concluido");
  assert.equal(rodadaDe(c, id, 1)?.estado, "revisar_rodada");
  assert.equal(execucoesDe(c, ref).length, 2);
  assert.equal(carregarTrabalhosDoTicket(c.banco, ref).sessoes.length, 1);
  const evidencias = ag.evidencias.filter((e) => e.ticket_id === ref.ticket_id);
  assert.deepEqual(
    evidencias.map((e) => e.tipo).sort(),
    ["execucao_testes", "matriz_fitness", "relatorio_sonar"].sort(),
  );
  assert.ok(evidencias.every((e) => e.autor.tipo === "fabriquinha"));
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

test("CA-SDLC-10: falha e timeout bloqueiam o escopo, o reinício volta sozinho, o histórico fica e a reabertura exige instrução sem executar na hora", async (t) => {
  const c = criarCenario(t);
  const id = await demandaEmExecucao(c, [{ tickets: 2 }]);
  const [t1, t2] = [ticketDe(c, id, 1), ticketDe(c, id, 1, 2)];
  const deps = despacho();
  const estado = () => rodadaDe(c, id, 1)?.estado;

  // Falha: o pi sai com erro; o ticket falha, a segunda tarefa da rodada não avança e o estado não muda.
  pi.roteirizar([{ sai: { codigo: 1, stderr: "falha do pi falso" } }]);
  await Promise.all(cicloDoDespacho(c.banco, c.config, deps));
  assert.equal(statusDe(c, t1), "falhou");
  assert.match(motivoDoTicket(c, id, t1.ticket_id) ?? "", /código 1|falha do pi falso/);
  assert.equal(execucoesDe(c, t1).length, 1);
  const bloqueado = () => {
    assert.equal(cicloDoDespacho(c.banco, c.config, deps).length, 0);
    assert.equal(statusDe(c, t2), "aberto");
    assert.equal(estado(), "implementar");
  };
  bloqueado();
  assert.deepEqual(executarAgora(c.banco, t2, c.config, deps), {
    tipo: "ocupado",
    por: Endereco.doTicket(id, t1.ticket_id),
  });

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
  pi.roteirizar([{ termina: "trava" }]);
  const curto = { ...c.config, timeoutMin: 0.01 };
  await Promise.all(cicloDoDespacho(c.banco, curto, deps));
  assert.match(pi.prompts().at(-1)?.prompt ?? "", /Reabertura[\s\S]*tente de novo, com atenção ao cache/);
  assert.equal(statusDe(c, t1), "falhou");
  assert.match(motivoDoTicket(c, id, t1.ticket_id) ?? "", /tempo limite/);
  const historico = execucoesDe(c, t1);
  assert.equal(historico.length, 2);
  assert.match(motivoDaExecucao(c, id, historico[0]?.id) ?? "", /1|falha do pi falso/);
  assert.match(motivoDaExecucao(c, id, historico[1]?.id) ?? "", /tempo limite/);
  assert.equal(carregarTrabalhosDoTicket(c.banco, t1).sessoes.length, 1);
  bloqueado();

  // Reinício do serviço: execução aberta de uma instância anterior falha, sem avançar; as anteriores seguem no histórico.
  reabrir(c, t1, "mais uma vez");
  const sessao = carregarTrabalhosDoTicket(c.banco, t1).sessoes[0];
  assert.ok(sessao);
  const execucao = { id: randomUUID(), trabalho_id: sessao.id, inicio: new Date().toISOString(), falha: false };
  comDemanda(c.banco, id, (ag) => ({
    ...ag,
    tickets: ag.tickets.map((x) => (x.ticket_id === t1.ticket_id ? { ...x, estado: "em_execucao" as const } : x)),
    tentativas: comTentativaAberta(
      ag.tentativas,
      { ...t1, estado_alterado_em: execucao.inicio },
      execucao.id,
      execucao.inicio,
    ),
  }));
  comTrabalhosDoTicket(c.banco, t1, (estado) => ({
    ...estado,
    execucoes: iniciarProcesso(criarTrabalho([], sessao), estado.execucoes, execucao),
  }));
  condutor.recuperarNaSubida(c.banco, recuperacaoDaSubida(c.banco, relogioDoSistema));
  assert.equal(statusDe(c, t1), "falhou");
  assert.match(motivoDoTicket(c, id, t1.ticket_id) ?? "", /serviço reiniciado/);
  const final = execucoesDe(c, t1);
  assert.equal(final.length, 3);
  assert.equal(motivoDaExecucao(c, id, final.at(-1)?.id), "serviço reiniciado");
  assert.deepEqual(final.slice(0, 2), historico);
  assert.equal(existsSync(join(c.raiz, "execucoes")), true);
  // O reinício não é culpa do ticket: o ciclo seguinte o devolve a aberto sozinho, sem instrução do Auditor nem executar.
  assert.deepEqual(retomarFalhasDeInfraestrutura(c.banco), [`${id}.T${String(t1.ticket_id)}`]);
  assert.equal(statusDe(c, t1), "aberto");
  assert.equal(execucoesDe(c, t1).length, 3);
});
