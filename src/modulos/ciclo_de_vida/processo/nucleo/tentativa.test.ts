import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AUDITOR,
  type CausaDeInfraestrutura,
  Endereco,
  type EtapaTicket,
  type ResultadoDaTentativa,
} from "../../etapas/publico.ts";
import {
  comReaberturaDoAuditor,
  comTentativaAberta,
  comTentativaEncerrada,
  desdeAReabertura,
  montarRetornoAoAgente,
  motivoDaFalhaDoTicket,
  PoliticaDeTentativas,
  POLITICA_DE_TENTATIVAS,
  retornoAoAgenteDoTicket,
  Tentativa as TentativaSchema,
  type Tentativa,
  tentativaAnteriorEmMemoria,
  tentativasDoTicket,
} from "./tentativa.ts";

const ticket = Endereco.doTicket("I-1", 3);
const MINUTO = 60_000;
const agora = "2026-01-01T10:00:00.000Z";
const antes = "2026-01-01T09:00:00.000Z";

const comResultado = (resultado: ResultadoDaTentativa, extra: Partial<Tentativa> = {}): Tentativa => ({
  ticket,
  numero: 1,
  inicio: antes,
  fim: agora,
  resultado,
  ...extra,
});
const reprovada = (): Tentativa => comResultado({ tipo: "reprovacao", motivo: "o teste falhou" });
const falhaDeInfraestrutura = (causa: CausaDeInfraestrutura): Tentativa =>
  comResultado({ tipo: "falha_infraestrutura", causa, motivo: `falhou por ${causa}` });
const reabertura = (instrucao = "faça de novo"): Tentativa =>
  comResultado({ tipo: "interrompida", por: AUDITOR }, { instrucao });

const proximoPasso = (etapa: EtapaTicket, ...historico: Tentativa[]) =>
  POLITICA_DE_TENTATIVAS.proximoPasso(etapa, desdeAReabertura(historico));

test("a política tem os limites de hoje: 2 reprovações e 3 falhas de infraestrutura", () => {
  assert.deepEqual(POLITICA_DE_TENTATIVAS.limites, { reprovacoes: 2, falhasDeInfraestrutura: 3 });
});

for (const etapa of ["implementar", "resolver_conflito"] as const) {
  test(`${etapa}: a 1ª e a 2ª reprovação devolvem ao agente e a 3ª bloqueia`, () => {
    assert.deepEqual(proximoPasso(etapa, reprovada()), { tipo: "devolver_ao_agente" });
    assert.deepEqual(proximoPasso(etapa, reprovada(), reprovada()), { tipo: "devolver_ao_agente" });
    assert.deepEqual(proximoPasso(etapa, reprovada(), reprovada(), reprovada()), { tipo: "bloquear" });
  });
}

test("a reprovação de outra etapa não volta ao agente: bloqueia", () => {
  assert.deepEqual(proximoPasso("revisar_rodada", reprovada()), { tipo: "bloquear" });
});

test("falha de tempo limite: espera 2, 8 e 32 min a 1ª, 2ª e 3ª e bloqueia na 4ª", () => {
  const falhas = (n: number) => Array.from({ length: n }, () => falhaDeInfraestrutura("tempo_limite"));
  const esperas = [1, 2, 3].map((n) => proximoPasso("implementar", ...falhas(n)));
  assert.deepEqual(
    esperas,
    [2, 8, 32].map((minutos) => ({
      tipo: "retomar_automaticamente",
      trocarProvedor: false,
      esperaMs: minutos * MINUTO,
    })),
  );
  assert.deepEqual(proximoPasso("implementar", ...falhas(4)), { tipo: "bloquear" });
});

test("2 reprovações, uma reabertura e 1 reprovação: a reabertura zera a conta e a política devolve ao agente", () => {
  const historico = [reprovada(), reprovada(), reabertura(), reprovada()];
  assert.deepEqual(proximoPasso("implementar", ...historico), { tipo: "devolver_ao_agente" });
  assert.deepEqual(desdeAReabertura(historico), [historico[3]]);
  assert.deepEqual(desdeAReabertura([reprovada()]).length, 1);
});

test("a cota esgotada retoma na hora, trocando o provedor, e conta no limite", () => {
  assert.deepEqual(proximoPasso("implementar", falhaDeInfraestrutura("cota")), {
    tipo: "retomar_automaticamente",
    trocarProvedor: true,
    esperaMs: 0,
  });
  const quatro = Array.from({ length: 4 }, () => falhaDeInfraestrutura("cota"));
  assert.deepEqual(proximoPasso("implementar", ...quatro), { tipo: "bloquear" });
});

test("o reinício do serviço retoma na hora e não conta no limite, por mais que se repita", () => {
  const reinicios = Array.from({ length: 5 }, () => falhaDeInfraestrutura("servico_reiniciado"));
  const esperado = { tipo: "retomar_automaticamente", trocarProvedor: false, esperaMs: 0 };
  assert.deepEqual(proximoPasso("revisar_demanda", ...reinicios), esperado);
  const entreFalhas = [falhaDeInfraestrutura("tempo_limite"), ...reinicios];
  assert.deepEqual(proximoPasso("implementar", ...entreFalhas), esperado);
  const reinicioDepoisDeDuasFalhas = [falhaDeInfraestrutura("tempo_limite"), falhaDeInfraestrutura("tempo_limite")];
  assert.deepEqual(
    proximoPasso("implementar", ...reinicioDepoisDeDuasFalhas, falhaDeInfraestrutura("comando_ausente")),
    {
      tipo: "retomar_automaticamente",
      trocarProvedor: false,
      esperaMs: 32 * MINUTO,
    },
  );
});

test("o que não é reprovação nem falha de infraestrutura bloqueia: sem histórico, sucesso e interrupção", () => {
  assert.deepEqual(proximoPasso("implementar"), { tipo: "bloquear" });
  assert.deepEqual(proximoPasso("implementar", comResultado({ tipo: "sucesso" })), { tipo: "bloquear" });
  assert.deepEqual(proximoPasso("implementar", comResultado({ tipo: "interrompida", por: AUDITOR })), {
    tipo: "bloquear",
  });
  assert.deepEqual(proximoPasso("implementar", { ticket, numero: 1, inicio: antes }), { tipo: "bloquear" });
});

test("uma política com outros limites usa os dela", () => {
  const rigorosa = new PoliticaDeTentativas({ reprovacoes: 0, falhasDeInfraestrutura: 1 });
  assert.deepEqual(rigorosa.proximoPasso("implementar", [reprovada()]), { tipo: "bloquear" });
  assert.deepEqual(rigorosa.proximoPasso("implementar", [falhaDeInfraestrutura("tempo_limite")]), {
    tipo: "retomar_automaticamente",
    trocarProvedor: false,
    esperaMs: 2 * MINUTO,
  });
  const duasFalhas = [falhaDeInfraestrutura("tempo_limite"), falhaDeInfraestrutura("tempo_limite")];
  assert.deepEqual(rigorosa.proximoPasso("implementar", duasFalhas), { tipo: "bloquear" });
});

test("o modelo reserva é o do outro provedor, no mesmo nível, e não existe sem modelo nem para provedor desconhecido", () => {
  const reserva = (provedor: string, nome: string) => POLITICA_DE_TENTATIVAS.modeloReserva({ provedor, nome });
  assert.deepEqual(reserva("claude-bridge", "claude-opus-5-5"), { provedor: "openai-codex", nome: "gpt-6.1-sol" });
  assert.deepEqual(reserva("anthropic", "claude-sonnet-5-5"), { provedor: "openai-codex", nome: "gpt-6-luna" });
  assert.deepEqual(reserva("openai-codex", "gpt-6.1-sol"), { provedor: "claude-bridge", nome: "claude-opus-5-5" });
  assert.equal(reserva("outro", "qualquer"), undefined);
  assert.equal(POLITICA_DE_TENTATIVAS.modeloReserva(undefined), undefined);
});

test("a Tentativa aberta guarda o processo e uma execução retomada na mesma Tentativa não abre outra", () => {
  const dono = { demanda_id: "I-1", ticket_id: 3, estado_alterado_em: antes };
  const aberta = comTentativaAberta([], dono, "E-1", agora);
  assert.deepEqual(aberta, [{ ticket, numero: 1, processo_id: "E-1", inicio: agora }]);
  assert.deepEqual(comTentativaAberta(aberta, dono, "E-2", agora), aberta);
  const encerrada = comTentativaEncerrada(aberta, dono, { tipo: "sucesso" }, agora);
  assert.deepEqual(encerrada, [
    { ticket, numero: 1, processo_id: "E-1", inicio: agora, fim: agora, resultado: { tipo: "sucesso" } },
  ]);
  assert.equal(comTentativaAberta(encerrada, dono, "E-3", agora).at(-1)?.numero, 2);
  const deOutroTicket: Tentativa = { ...reprovada(), ticket: Endereco.doTicket("I-1", 9) };
  assert.deepEqual(comTentativaEncerrada([deOutroTicket, ...aberta], dono, { tipo: "sucesso" }, agora), [
    deOutroTicket,
    ...encerrada,
  ]);
});

test("o schema da Tentativa só aceita o endereço de verdade", () => {
  assert.deepEqual(TentativaSchema.parse(reprovada()), reprovada());
  assert.throws(() => TentativaSchema.parse({ ...reprovada(), ticket: "I-1.T3" }));
});

test("encerrar sem Tentativa aberta cria a encerrada, que começou quando o ticket entrou em execução", () => {
  const dono = { demanda_id: "I-1", ticket_id: 3, estado_alterado_em: antes };
  const outroTicket: Tentativa = { ...reprovada(), ticket: Endereco.doTicket("I-1", 9) };
  const resultado: ResultadoDaTentativa = { tipo: "reprovacao", motivo: "falhou" };
  assert.deepEqual(comTentativaEncerrada([outroTicket], dono, resultado, agora), [
    outroTicket,
    { ticket, numero: 1, inicio: antes, fim: agora, resultado },
  ]);
});

test("a reabertura do Auditor é uma Tentativa dele com a instrução, e os limites contam depois dela", () => {
  const dono = { demanda_id: "I-1", ticket_id: 3, estado_alterado_em: antes };
  const reaberta = comReaberturaDoAuditor([reprovada()], dono, "refaça", agora);
  assert.deepEqual(reaberta.at(-1), {
    ticket,
    numero: 2,
    inicio: agora,
    fim: agora,
    resultado: { tipo: "interrompida", por: AUDITOR },
    instrucao: "refaça",
  });
  assert.deepEqual(desdeAReabertura(reaberta), []);
  assert.deepEqual(tentativasDoTicket(reaberta, 3).length, 2);
  assert.deepEqual(tentativasDoTicket(reaberta, 4), []);
});

test("o motivo do ticket que falhou ou foi cancelado é o da última Tentativa", () => {
  const tentativas = [reprovada(), falhaDeInfraestrutura("cota")];
  assert.equal(motivoDaFalhaDoTicket(tentativas, { ticket_id: 3, estado: "falhou" }), "falhou por cota");
  assert.equal(motivoDaFalhaDoTicket(tentativas, { ticket_id: 3, estado: "cancelado" }), "falhou por cota");
  assert.equal(motivoDaFalhaDoTicket(tentativas, { ticket_id: 3, estado: "aberto" }), undefined);
  assert.equal(motivoDaFalhaDoTicket(tentativas, { ticket_id: 4, estado: "falhou" }), undefined);
  const semMotivo = [comResultado({ tipo: "sucesso" })];
  assert.equal(motivoDaFalhaDoTicket(semMotivo, { ticket_id: 3, estado: "falhou" }), undefined);
  const interrompidaSemMotivo = [comResultado({ tipo: "interrompida", por: AUDITOR })];
  assert.equal(motivoDaFalhaDoTicket(interrompidaSemMotivo, { ticket_id: 3, estado: "cancelado" }), undefined);
});

test("a Tentativa reprovada devolve o ticket com o motivo dela, ignorando a instrução do Auditor", () => {
  const anterior = tentativaAnteriorEmMemoria(ticket, { motivoDaReprovacao: "o teste falhou" });
  assert.deepEqual(montarRetornoAoAgente(anterior, "outra coisa"), {
    titulo: "Devolução",
    texto:
      "O ticket I-1.T3 foi devolvido a você: a entrega anterior não passou. " +
      "Corrija o que o motivo aponta e não refaça o resto.\n\nMotivo: o teste falhou",
  });
});

test("a Tentativa interrompida reabre o ticket com a instrução do Auditor, ou com a que ela guarda", () => {
  const anterior = tentativaAnteriorEmMemoria(ticket, { instrucao: "guardada" });
  assert.deepEqual(anterior.resultado, { tipo: "interrompida", por: AUDITOR });
  const reabertura = (motivo: string) => ({
    titulo: "Reabertura",
    texto: `O Auditor reabriu o ticket I-1.T3. Continue de onde a entrega anterior parou e atenda ao motivo.\n\nMotivo: ${motivo}`,
  });
  assert.deepEqual(montarRetornoAoAgente(anterior, "do Auditor"), reabertura("do Auditor"));
  assert.deepEqual(montarRetornoAoAgente(anterior), reabertura("guardada"));
});

test("a Tentativa sem resultado e sem instrução não tem como reabrir", () => {
  const semInstrucao: Tentativa = { ticket, numero: 2, inicio: "2026-01-01T00:00:00.000Z" };
  assert.throws(() => montarRetornoAoAgente(semInstrucao), /a Tentativa 2 de I-1\.T3 não tem instrução para reabrir/);
});

test("o retorno ao agente vem da última reprovação ou reabertura, e a falha de infraestrutura no meio não o troca", () => {
  assert.equal(retornoAoAgenteDoTicket([], 3), undefined);
  assert.equal(retornoAoAgenteDoTicket([falhaDeInfraestrutura("cota")], 3), undefined);
  const devolvido = [reprovada(), falhaDeInfraestrutura("tempo_limite")];
  assert.equal(retornoAoAgenteDoTicket(devolvido, 3)?.titulo, "Devolução");
  assert.match(String(retornoAoAgenteDoTicket(devolvido, 3)?.texto), /Motivo: o teste falhou/);
  const reaberto = [reprovada(), reabertura("do Auditor"), falhaDeInfraestrutura("tempo_limite")];
  assert.equal(retornoAoAgenteDoTicket(reaberto, 3)?.titulo, "Reabertura");
  assert.match(String(retornoAoAgenteDoTicket(reaberto, 3)?.texto), /Motivo: do Auditor/);
  assert.equal(retornoAoAgenteDoTicket(reaberto, 4), undefined);
});
