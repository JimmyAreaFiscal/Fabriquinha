// Seção 12 de comparacao-sdlc-implementacao.md, CA-SDLC-01 a 03 (a demanda): registro e envio externos, decisão do
// Auditor e dependências. O cenário é montado pelos serviços e pelo agendador, com banco e git reais numa raiz
// temporária e o pi falso; nada passa pela web.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AUDITOR,
  despachoDasEtapas,
  interromperExecucaoDemanda,
  cicloDoDespacho,
} from "../../src/modulos/ciclo_de_vida/publico.ts";
import { ErroDeEscopo } from "../../src/shared/nucleo/erros.ts";
import * as gestao from "../../src/modulos/ciclo_de_vida/processo/aplicacao/gestao_do_processo.ts";
import { carregarSessoesDoContexto } from "../../src/modulos/sessoes/publico.ts";
import {
  adicionarProjeto,
  AUTOR,
  base,
  type Cenario,
  criarCenario,
  CTX,
  ORIGENS_DOS_ANEXOS,
  demanda,
  demandaAprovada,
  demandaEnviada,
  esperar,
  OUTRA_SESSAO,
  registrarExterna,
  submeterObrigatorias,
} from "../apoio.ts";
import { instalarPiFalso } from "../../apoio-testes/falsos/pi_falso.ts";
import { enviarAoDesenvolvimento } from "../../src/server/fluxos/envio_ao_desenvolvimento.ts";
import { decidirGateDaDemanda } from "../../src/server/fluxos/cancelamento_em_cascata.ts";
import { predecessorasPendentesPelasDependencias } from "../../src/server/fluxos/ciclo_do_servico/despacho_do_trabalho.ts";
import { montarDemandasDoBanco } from "../../src/server/composicao/banco_da_fabriquinha.ts";
import { registrarDependencia } from "../../apoio-testes/demandas_de_teste.ts";

const pi = instalarPiFalso(base);

/** O planejamento é uma sessão interativa: dispara o ciclo, espera o pi receber o prompt e interrompe a execução. */
async function planejamentoIniciaEInterrompe(c: Cenario, id: string): Promise<void> {
  const fins = cicloDoDespacho(
    c.banco,
    c.config,
    despachoDasEtapas(),
    predecessorasPendentesPelasDependencias(montarDemandasDoBanco(c.banco)),
  );
  assert.equal(fins.length, 1, "o ciclo deveria iniciar só o planejamento");
  await esperar(() => pi.prompts().length === 1, `o pi receber o prompt do planejamento de ${id}`);
  const ref = { demanda_id: id, ticket_id: 2 };
  interromperExecucaoDemanda(c.banco, ref);
  await Promise.all(fins);
  assert.equal(carregarSessoesDoContexto(c.banco, ref).execucoes.length, 1);
}

test("CA-SDLC-01: envio externo incompleto não congela nem abre o gate; o completo congela a definição e registra a origem", (t) => {
  const c = criarCenario(t);
  const id = registrarExterna(c);
  const submeter = (tipo: string, dados: unknown) =>
    gestao.submeterEvidenciaDaEntradaExterna(
      c.banco,
      id,
      { tipo, dados } as gestao.EntradaEvidencia,
      AUTOR,
      ORIGENS_DOS_ANEXOS,
    );
  submeter("criterios_aceite", { criterios: [{ id: "CA-1", dado: "d", quando: "q", entao: "e" }] });

  // Incompleto: lista as pendências, a definição segue editável e não há gate para o Auditor decidir.
  assert.throws(
    () => enviarAoDesenvolvimento(c.banco, montarDemandasDoBanco(c.banco), id, AUTOR, CTX),
    (e: Error) => e.message.includes("desenho_solucao"),
  );
  assert.equal(demanda(c, id).demanda.enviada, false);
  assert.equal(demanda(c, id).demanda.estado, "entender_e_desenhar");
  assert.equal(demanda(c, id).tickets[0]?.estado, "em_execucao");
  assert.throws(
    () => decidirGateDaDemanda(c.banco, montarDemandasDoBanco(c.banco), id, { resultado: "aprovado" }, AUDITOR),
    /não espera decisão/,
  );
  assert.equal(montarDemandasDoBanco(c.banco).editar(id, { titulo: "Corrigido" }, AUTOR).titulo, "Corrigido");
  assert.throws(
    () => enviarAoDesenvolvimento(c.banco, montarDemandasDoBanco(c.banco), id, OUTRA_SESSAO, CTX),
    ErroDeEscopo,
  );

  // Completo: congela a definição e registra a origem (ferramenta e sessão).
  submeterObrigatorias(c, id);
  const enviada = enviarAoDesenvolvimento(c.banco, montarDemandasDoBanco(c.banco), id, AUTOR, CTX).demanda;
  assert.equal(enviada.estado, "gate_demanda");
  assert.equal(enviada.enviada, true);
  assert.deepEqual(enviada.criada_por, { tipo: "externo", ferramenta: "claude", sessao: "S1" });
  assert.throws(() => montarDemandasDoBanco(c.banco).editar(id, { descricao: "Outra" }, AUTOR), /congelado/);
  assert.throws(
    () => submeter("criterios_aceite", { criterios: [{ id: "CA-9", dado: "d", quando: "q", entao: "e" }] }),
    /congelada/,
  );
  assert.equal(pi.prompts().length, 0);
});

test("CA-SDLC-02: aprovar disponibiliza o planejamento; reprovar cancela o percurso sem lançar desenho interno", async (t) => {
  const c = criarCenario(t);
  pi.roteirizar();

  // Reprovação: cancelada, motivo gravado, nenhum ticket novo e nada a despachar.
  const reprovada = demandaEnviada(c);
  const { demanda: r } = decidirGateDaDemanda(
    c.banco,
    montarDemandasDoBanco(c.banco),
    reprovada,
    { resultado: "reprovado", motivo: "fora do escopo" },
    AUDITOR,
  );
  assert.equal(r.demanda.estado, "cancelada");
  assert.deepEqual([r.decisoes[0]?.resultado, r.decisoes[0]?.motivo], ["reprovado", "fora do escopo"]);
  assert.deepEqual(
    demanda(c, reprovada).tickets.map((x) => [x.etapa, x.estado]),
    [["entender_e_desenhar", "cancelado"]],
  );
  assert.equal(
    cicloDoDespacho(
      c.banco,
      c.config,
      despachoDasEtapas(),
      predecessorasPendentesPelasDependencias(montarDemandasDoBanco(c.banco)),
    ).length,
    0,
  );
  assert.equal(pi.prompts().length, 0);

  // Aprovação: planejamento com o `planejar` aberto, que o agendador inicia.
  const aprovada = demandaEnviada(c);
  const { demanda: a } = decidirGateDaDemanda(
    c.banco,
    montarDemandasDoBanco(c.banco),
    aprovada,
    { resultado: "aprovado" },
    AUDITOR,
  );
  assert.equal(a.demanda.estado, "planejar");
  assert.equal(a.decisoes[0]?.resultado, "aprovado");
  assert.deepEqual(
    demanda(c, aprovada).tickets.map((x) => [x.etapa, x.estado]),
    [
      ["entender_e_desenhar", "concluido"],
      ["planejar", "aberto"],
    ],
  );
  await planejamentoIniciaEInterrompe(c, aprovada);
});

test("CA-SDLC-03: dependência pendente (inclusive de outro projeto) segura o planejamento; ciclo e autorreferência são rejeitados", async (t) => {
  const c = criarCenario(t);
  pi.roteirizar();
  adicionarProjeto(c, "outro");

  // A, de outro projeto, ainda espera a decisão; B (deste projeto) já foi aprovada, mas depende de A.
  const a = demandaEnviada(c, undefined, "outro");
  const b = await demandaAprovada(c, [a]);
  assert.equal(
    cicloDoDespacho(
      c.banco,
      c.config,
      despachoDasEtapas(),
      predecessorasPendentesPelasDependencias(montarDemandasDoBanco(c.banco)),
    ).length,
    0,
  );
  assert.equal(pi.prompts().length, 0);
  assert.deepEqual(
    demanda(c, b).tickets.map((x) => [x.etapa, x.estado]),
    [
      ["entender_e_desenhar", "concluido"],
      ["planejar", "aberto"],
    ],
  );

  // Controle: com A concluída (o percurso até lá é de outros casos), o mesmo ciclo inicia o planejamento de B.
  c.banco.prepare("UPDATE processo_demanda SET estado = 'concluida' WHERE demanda_id = ?").run(a);
  c.banco.prepare("UPDATE demanda SET situacao = 'concluido' WHERE id = ?").run(a);
  await planejamentoIniciaEInterrompe(c, b);

  // Autorreferência e ciclo: rejeitados, sem aresta nova.
  const x = registrarExterna(c);
  const y = registrarExterna(c, [x]);
  const arestas = () => c.banco.prepare("SELECT count(*) AS n FROM dependencia_demanda").get()?.n;
  const antes = arestas();
  assert.throws(() => {
    registrarDependencia(c.banco, x, x);
  }, /não pode depender de si mesma/);
  assert.throws(() => {
    registrarDependencia(c.banco, x, y);
  }, /ciclo de dependência/);
  assert.equal(arestas(), antes);
});
