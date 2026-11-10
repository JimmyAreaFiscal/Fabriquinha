// A condução do planejar com banco real, git real em repositório temporário e pi falso mínimo (CA-1 a CA-7 da I-205): a
// sessão interativa nasce e é retomada, a reprovação do gate leva o motivo ao agente e o pi que falha não falha o ticket.
import assert from "node:assert/strict";
import { test } from "node:test";
import { AUDITOR } from "../../nucleo/ator.ts";
import { reabrirTicket } from "../../nucleo/transicoes_demanda.ts";
import { comReaberturaDoAuditor, falhaPorServicoReiniciado } from "../../nucleo/tentativa.ts";
import { carregarDemanda, comDemanda } from "../../armazenamento/demandas.ts";
import {
  aprovarGateDoPlanejamento,
  cenarioDePlanejamento,
  plano,
  planejar,
  proporPlanoDoAgente,
  reprovarGateDoPlanejamento,
} from "../../../apoio-testes/cenario_de_planejamento.ts";
import { Endereco } from "../../nucleo/item_de_trabalho.ts";
import { anotar } from "../../infra/registro.ts";
import { falharTicketDemanda } from "../fechamento_ticket.ts";
import { relogioFixo } from "../../nucleo/relogio.ts";
import { condutor } from "../trabalho/condutor.ts";
import { ConducaoDePlanejar } from "./conducao_de_planejar.ts";
import { conferirPromptComFoto } from "../fotos_retorno/conferir_foto.ts";

test("CA-1: planejamento com predecessoras satisfeitas reserva o planejar e cria a sessão", async () => {
  for (const predecessora of ["concluida", "arquivada"]) {
    const { banco, sessoes, status } = cenarioDePlanejamento({ predecessora });
    await planejar(banco, 0.02);
    assert.equal(status(), "em_execucao");
    assert.equal(sessoes().sessoes.length, 1);
    assert.equal(sessoes().sessoes[0]?.modo, "interativo");
  }
});

test("CA-2: predecessora em execução recusa, sem reservar nem criar sessão", async () => {
  const { banco, sessoes, status } = cenarioDePlanejamento({ predecessora: "em_execucao" });
  await assert.rejects(planejar(banco, 0.02), /predecessoras da demanda ainda não foram satisfeitas/);
  assert.equal(status(), "aberto");
  assert.equal(sessoes().sessoes.length, 0);
});

test("CA-1, CA-3: estado errado e ticket inesperado recusam com orientação", async () => {
  await assert.rejects(planejar(cenarioDePlanejamento({ estado: "em_execucao" }).banco, 0.02), /só no estado planejar/);
  await assert.rejects(
    planejar(cenarioDePlanejamento({ estadoDoTicket: "concluido" }).banco, 0.02),
    /está concluido e não pode ser iniciado \(só se inicia ou retoma/,
  );
});

test("CA-3: com o planejar em execução, a mesma sessão é retomada", async () => {
  const { banco, sessoes } = cenarioDePlanejamento();
  await planejar(banco, 0.02);
  const [primeira] = sessoes().sessoes;
  await planejar(banco, 0.02);
  assert.deepEqual(sessoes().sessoes, [primeira]);
  assert.equal(sessoes().execucoes.length, 2);
  assert.equal(carregarDemanda(banco, "I-1").tickets.length, 1);
});

test("CA-6, CA-7: reprovação registra o motivo e a retomada reusa a sessão com o motivo", async () => {
  const { banco, sessoes, prompts, status } = cenarioDePlanejamento({ estadoDoTicket: "em_execucao" });
  await planejar(banco, 0.02);
  const [sessao] = sessoes().sessoes;
  proporPlanoDoAgente(banco, "I-1", plano());
  await reprovarGateDoPlanejamento(banco, "faltam critérios na rodada 2");
  const ag = carregarDemanda(banco, "I-1");
  assert.equal(ag.demanda.estado, "planejar");
  assert.deepEqual(
    ag.decisoes.map((d) => [d.resultado, d.motivo]),
    [["reprovado", "faltam critérios na rodada 2"]],
  );
  assert.equal(status(), "em_execucao");
  await planejar(banco, 0.02);
  assert.deepEqual(sessoes().sessoes, [sessao]);
  assert.match(prompts().at(-1) ?? "", /Motivo: faltam critérios na rodada 2/);
});

test("CA-1: com o pi vivo e ocioso, a reprovação manda o motivo à mesma sessão", async () => {
  const { banco, prompts } = cenarioDePlanejamento({ estadoDoTicket: "em_execucao" });
  const fim = planejar(banco, 0.2);
  while (prompts().length === 0) await new Promise((r) => setTimeout(r, 20));
  await new Promise((r) => setTimeout(r, 100)); // o pi assenta: ocioso, à espera do gate
  proporPlanoDoAgente(banco, "I-1", plano());
  await reprovarGateDoPlanejamento(banco, "faltam critérios na rodada 2");
  while (prompts().length < 2) await new Promise((r) => setTimeout(r, 20));
  assert.match(prompts()[1] ?? "", /Motivo: faltam critérios na rodada 2/);
  await fim;
});

test("CA-3: reprovar com o planejar Falhou o reabre com o motivo e o despacho retoma a mesma sessão", async () => {
  const { banco, sessoes, prompts } = cenarioDePlanejamento({ estadoDoTicket: "em_execucao" });
  await planejar(banco, 0.02);
  const [sessao] = sessoes().sessoes;
  proporPlanoDoAgente(banco, "I-1", plano());
  falharTicketDemanda(banco, { demanda_id: "I-1", ticket_id: 1 }, falhaPorServicoReiniciado);
  await reprovarGateDoPlanejamento(banco, "faltam critérios na rodada 2");
  const ticket = carregarDemanda(banco, "I-1").tickets[0] as { estado: string; instrucao?: string };
  assert.equal(ticket.estado, "aberto");
  assert.equal(ticket.instrucao, "faltam critérios na rodada 2");
  const antes = sessoes().execucoes.length;
  await planejar(banco, 0.02);
  assert.deepEqual(sessoes().sessoes, [sessao]);
  assert.equal(sessoes().execucoes.length, antes + 1);
  assert.match(prompts().at(-1) ?? "", /Motivo: faltam critérios na rodada 2/);
});

test("plano aprovado e reaberto com instrução replaneja em sessão nova com a instrução; a retomada fica nela", async () => {
  const { banco, sessoes, prompts } = cenarioDePlanejamento({ estadoDoTicket: "em_execucao" });
  const fim = planejar(banco, 0.2);
  while (prompts().length === 0) await new Promise((r) => setTimeout(r, 20));
  proporPlanoDoAgente(banco, "I-1", plano());
  await aprovarGateDoPlanejamento(banco);
  await fim;
  const [descartada] = sessoes().sessoes;
  // O Auditor descarta o plano aprovado (incidente da I-259): volta ao planejamento com a instrução no ticket.
  banco.exec("UPDATE demanda SET estado = 'planejar' WHERE id = 'I-1'");
  comDemanda(banco, "I-1", (ag) => {
    const ticketPlanejar = ag.tickets[0];
    assert.ok(ticketPlanejar);
    return {
      ...ag,
      tickets: ag.tickets.map((ticket) => ({
        ...ticket,
        estado: "aberto" as const,
        instrucao: "Refaça o plano com até 30 arquivos por rodada",
      })),
      tentativas: comReaberturaDoAuditor(
        ag.tentativas,
        ticketPlanejar,
        "Refaça o plano com até 30 arquivos por rodada",
        new Date().toISOString(),
      ),
    };
  });
  await planejar(banco, 0.02);
  const replanejamento = sessoes().sessoes.at(-1);
  assert.equal(sessoes().sessoes.length, 2);
  assert.notEqual(replanejamento?.id, descartada?.id);
  assert.match(prompts().at(-1) ?? "", /## Reabertura[\s\S]*Motivo: Refaça o plano com até 30 arquivos por rodada/);
  // Serviço reiniciado no meio do replanejamento: retoma a sessão nova, não abre outra nem volta à descartada.
  await planejar(banco, 0.02);
  assert.equal(sessoes().sessoes.length, 2);
  assert.equal(sessoes().execucoes.at(-1)?.trabalho_id, replanejamento?.id);
});

test("CA-4: aprovar encerra o pi vivo e grava o fim da execução do planejamento", async () => {
  const { banco, prompts } = cenarioDePlanejamento({ estadoDoTicket: "em_execucao" });
  const fim = planejar(banco, 0.2);
  while (prompts().length === 0) await new Promise((r) => setTimeout(r, 20));
  await new Promise((r) => setTimeout(r, 100));
  proporPlanoDoAgente(banco, "I-1", plano());
  await aprovarGateDoPlanejamento(banco);
  await fim;
  const { n } = banco.prepare("SELECT COUNT(*) AS n FROM processo_do_trabalho WHERE fim IS NULL").get() as {
    n: number;
  };
  assert.equal(n, 0);
});

test("foto do retorno ao agente no planejamento: devolução pela reprovação", async () => {
  const { c, banco, prompts } = cenarioDePlanejamento({ estadoDoTicket: "em_execucao" });
  await planejar(banco, 0.02);
  proporPlanoDoAgente(banco, "I-1", plano());
  await reprovarGateDoPlanejamento(banco, "faltam critérios na rodada 2");
  await planejar(banco, 0.02);
  conferirPromptComFoto(prompts().at(-1) ?? "", c.raiz, "planejamento_devolucao");
});

test("foto do retorno ao agente no planejamento: reabertura pela instrução do Auditor", async () => {
  const { c, banco, prompts } = cenarioDePlanejamento({ estadoDoTicket: "em_execucao" });
  await planejar(banco, 0.02);
  falharTicketDemanda(banco, { demanda_id: "I-1", ticket_id: 1 }, falhaPorServicoReiniciado);
  comDemanda(banco, "I-1", (ag) =>
    reabrirTicket(
      ag,
      {
        ticket_id: 1,
        instrucao: "Refaça o plano com até 30 arquivos",
      },
      AUDITOR,
      { agora: new Date().toISOString() },
    ),
  );
  await planejar(banco, 0.02);
  conferirPromptComFoto(prompts().at(-1) ?? "", c.raiz, "planejamento_reabertura");
});

test("o pi que falha não falha o ticket: a execução falha e o ticket segue em execução", async () => {
  const { banco, piFalso, status, sessoes } = cenarioDePlanejamento();
  piFalso.roteirizar([{ sai: { codigo: 1, stderr: "limite de uso" } }]);
  await planejar(banco, 0.02);
  assert.equal(status(), "em_execucao");
  assert.deepEqual(
    sessoes().execucoes.map((e) => e.falha),
    [true],
  );
});

test("ConducaoDePlanejar instanciada com as dependências recusa o ticket concluído sem criar sessão", async () => {
  const { banco, sessoes } = cenarioDePlanejamento({ estadoDoTicket: "concluido" });
  const conducao = new ConducaoDePlanejar({
    banco,
    relogio: relogioFixo("2026-01-01T00:00:00.000Z"),
    condutor,
    registro: anotar,
  });
  await assert.rejects(conducao.conduzir(Endereco.doTicket("I-1", 1)), /está concluido e não pode ser iniciado/);
  assert.equal(sessoes().sessoes.length, 0);
});
