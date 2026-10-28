// Seção 12 de comparacao-sdlc-implementacao.md, CA-SDLC-01 a 03 (a demanda): registro e envio externos, decisão do
// Auditor e dependências. O cenário é montado pelos serviços e pelo agendador, com banco e git reais numa raiz
// temporária e o pi falso; nada passa pela web.
import assert from "node:assert/strict";
import { test } from "node:test";
import { AUDITOR } from "../src/dominio/agregado.ts";
import { ErroDeEscopo } from "../src/dominio/erros.ts";
import { interromperExecucaoDemanda } from "../src/execucao/execucao_demanda.ts";
import { despacharDemandas } from "../src/execucao/despacho_demanda.ts";
import * as gestao from "../src/execucao/gestao_demandas.ts";
import { carregarSessoesDoTicket } from "../src/persistencia/sessoes.ts";
import {
  adicionarProjeto,
  AUTOR,
  base,
  type Cenario,
  criarCenario,
  CTX,
  demanda,
  demandaAprovada,
  demandaEnviada,
  esperar,
  OUTRA_SESSAO,
  registrarExterna,
  submeterObrigatorias,
} from "./apoio.ts";
import { piFalso } from "./falsos.ts";

const pi = piFalso(base);

/** O planejamento é uma sessão interativa: dispara o ciclo, espera o pi receber o prompt e interrompe a execução. */
async function planejamentoIniciaEInterrompe(c: Cenario, id: string): Promise<void> {
  const fins = despacharDemandas(c.banco, c.config);
  assert.equal(fins.length, 1, "o ciclo deveria iniciar só o planejamento");
  await esperar(() => pi.chamadas().length === 1, `o pi receber o prompt do planejamento de ${id}`);
  const ref = { demanda_id: id, ticket_id: 2 };
  interromperExecucaoDemanda(c.banco, ref);
  await Promise.all(fins);
  assert.equal(carregarSessoesDoTicket(c.banco, ref).execucoes.length, 1);
}

test("CA-SDLC-01: envio externo incompleto não congela nem abre o gate; o completo congela a definição e registra a origem", (t) => {
  const c = criarCenario(t);
  const id = registrarExterna(c);
  const submeter = (tipo: string, dados: unknown) =>
    gestao.submeterEvidencia(c.banco, id, { tipo, dados } as gestao.EntradaEvidencia, AUTOR, CTX);
  submeter("criterios_aceite", { criterios: [{ id: "CA-1", dado: "d", quando: "q", entao: "e" }] });

  // Incompleto: lista as pendências, a definição segue editável e não há gate para o Auditor decidir.
  assert.throws(
    () => gestao.enviar(c.banco, id, AUTOR, CTX),
    (e: Error) => e.message.includes("desenho_solucao, custos_realizados"),
  );
  assert.equal(demanda(c, id).demanda.enviada, false);
  assert.equal(demanda(c, id).demanda.fase, "registro");
  assert.equal(demanda(c, id).tickets[0]?.status, "em_execucao");
  assert.throws(() => gestao.decidir(c.banco, id, { aprovado: true }, AUDITOR, CTX), /não espera decisão/);
  assert.equal(gestao.editar(c.banco, id, { titulo: "Corrigido" }, AUTOR).demanda.titulo, "Corrigido");
  assert.throws(() => gestao.enviar(c.banco, id, OUTRA_SESSAO, CTX), ErroDeEscopo);

  // Completo: congela a definição e registra a origem (ferramenta e sessão) e a sessão externa dos custos.
  submeterObrigatorias(c, id);
  const enviada = gestao.enviar(c.banco, id, AUTOR, CTX).demanda;
  assert.equal(enviada.fase, "aprovacao_demanda");
  assert.equal(enviada.enviada, true);
  assert.deepEqual([enviada.origem_ferramenta, enviada.origem_sessao], ["claude", "S1"]);
  assert.throws(() => gestao.editar(c.banco, id, { descricao: "Outra" }, AUTOR), /congelado/);
  assert.throws(
    () => submeter("criterios_aceite", { criterios: [{ id: "CA-9", dado: "d", quando: "q", entao: "e" }] }),
    /congelada/,
  );
  assert.equal(c.banco.prepare("SELECT count(*) AS n FROM sessao_externa_demanda WHERE demanda_id = ?").get(id)?.n, 1);
  assert.equal(pi.chamadas().length, 0);
});

test("CA-SDLC-02: aprovar disponibiliza o planejamento; recusar cancela o percurso sem lançar desenho interno", async (t) => {
  const c = criarCenario(t);
  pi.roteirizar();

  // Recusa: cancelada, motivo gravado, nenhum ticket novo e nada a despachar.
  const recusada = demandaEnviada(c);
  const { demanda: r } = gestao.decidir(c.banco, recusada, { aprovado: false, motivo: "fora do escopo" }, AUDITOR, CTX);
  assert.equal(r.demanda.fase, "cancelada");
  assert.deepEqual([r.decisoes[0]?.resultado, r.decisoes[0]?.motivo], ["recusado", "fora do escopo"]);
  assert.deepEqual(
    demanda(c, recusada).tickets.map((x) => [x.etapa, x.status]),
    [["demanda", "cancelado"]],
  );
  assert.equal(despacharDemandas(c.banco, c.config).length, 0);
  assert.equal(pi.chamadas().length, 0);

  // Aprovação: planejamento com o `planejar` aberto, que o agendador inicia.
  const aprovada = demandaEnviada(c);
  const { demanda: a } = gestao.decidir(c.banco, aprovada, { aprovado: true }, AUDITOR, CTX);
  assert.equal(a.demanda.fase, "planejamento");
  assert.equal(a.decisoes[0]?.resultado, "aprovado");
  assert.deepEqual(
    demanda(c, aprovada).tickets.map((x) => [x.etapa, x.status]),
    [
      ["demanda", "concluido"],
      ["planejar", "aberto"],
    ],
  );
  await planejamentoIniciaEInterrompe(c, aprovada);
});

test("CA-SDLC-03: dependência pendente (inclusive de outro projeto) segura o planejamento; ciclo e autorreferência são recusados", async (t) => {
  const c = criarCenario(t);
  pi.roteirizar();
  adicionarProjeto(c, "outro");

  // A, de outro projeto, ainda espera a decisão; B (deste projeto) já foi aprovada, mas depende de A.
  const a = demandaEnviada(c, undefined, "outro");
  const b = demandaAprovada(c, [a]);
  assert.equal(despacharDemandas(c.banco, c.config).length, 0);
  assert.equal(pi.chamadas().length, 0);
  assert.deepEqual(
    demanda(c, b).tickets.map((x) => [x.etapa, x.status]),
    [
      ["demanda", "concluido"],
      ["planejar", "aberto"],
    ],
  );

  // Controle: com A concluída (o percurso até lá é de outros casos), o mesmo ciclo inicia o planejamento de B.
  c.banco.prepare("UPDATE demanda SET fase = 'concluida' WHERE id = ?").run(a);
  await planejamentoIniciaEInterrompe(c, b);

  // Autorreferência e ciclo: recusados, sem aresta nova.
  const x = registrarExterna(c);
  const y = registrarExterna(c, [x]);
  const arestas = () => c.banco.prepare("SELECT count(*) AS n FROM dependencia_demanda").get()?.n;
  const antes = arestas();
  assert.throws(() => {
    gestao.registrarDependencia(c.banco, x, x, AUTOR);
  }, /não pode depender de si mesma/);
  assert.throws(() => {
    gestao.registrarDependencia(c.banco, x, y, AUTOR);
  }, /ciclo de dependência/);
  assert.equal(arestas(), antes);
});
