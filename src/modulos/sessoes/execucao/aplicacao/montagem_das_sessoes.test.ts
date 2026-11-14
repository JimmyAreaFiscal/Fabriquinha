// A interface montada sobre o banco: cada pedido chega ao motor do serviço com o banco, a lista traz o processo vivo, e a
// montagem do serviço grava o catálogo de preços em segundo plano, que o `parar` espera.
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { abrirBancoTemporario } from "../../../../../apoio-testes/banco/banco_temporario.ts";
import { comSessoesDoContexto } from "./sessoes_do_contexto.ts";
import { montarSessoesDeAgente, motorDoBanco } from "./montagem_das_sessoes.ts";

const T = "2026-01-01T00:00:00.000Z";

function bancoComUmaSessao() {
  const { banco } = abrirBancoTemporario();
  banco.exec(`INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube)
      VALUES ('p', '/repo/p', 'main', 'github', 'k');
    INSERT INTO demanda (id, projeto, titulo, tipo, descricao, estado, estado_alterado_em, criada_por_ferramenta, criada_por_sessao, enviada, branch) VALUES ('I-1', 'p', 't', 'funcionalidade', 'd', 'em_execucao', '${T}', 'f', 's', 1, 'fabriquinha/I-1');
    INSERT INTO processo_demanda (demanda_id, estado, estado_alterado_em, branch) SELECT id, estado, estado_alterado_em, branch FROM demanda;
    INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, estado, estado_alterado_em)
      VALUES ('I-1', 1, 'implementar', 'aberto', '${T}');`);
  comSessoesDoContexto(banco, { demanda_id: "I-1", ticket_id: 1 }, (estado) => ({
    ...estado,
    sessoes: [{ demanda_id: "I-1", ticket_id: 1, id: "s1", modo: "autonomo", conversa_referencia: "s1" }],
    execucoes: [{ id: "e1", trabalho_id: "s1", inicio: T, fim: null, falha: false }],
  }));
  return banco;
}

test("os pedidos chegam ao motor do banco, o mesmo de toda montagem sobre ele, e só ao dele", (t: TestContext) => {
  const banco = bancoComUmaSessao();
  const sessoes = montarSessoesDeAgente({ banco });
  const motor = motorDoBanco(banco);
  assert.equal(motorDoBanco(banco), motor);
  const outro = bancoComUmaSessao();
  assert.notEqual(motorDoBanco(outro), motor);
  const abortar = t.mock.method(motor, "abortar", () => undefined);
  const mandar = t.mock.method(motor, "mandar", () => undefined);
  const responder = t.mock.method(motor, "responder", () => undefined);
  sessoes.abortar("e1");
  sessoes.mandar("e1", { type: "steer", message: "oi" });
  sessoes.responder("e1", "d1", { cancelled: true });
  assert.deepEqual(abortar.mock.calls[0]?.arguments, ["e1"]);
  assert.deepEqual(mandar.mock.calls[0]?.arguments, ["e1", { type: "steer", message: "oi" }]);
  assert.deepEqual(responder.mock.calls[0]?.arguments, ["e1", "d1", { cancelled: true }]);
  banco.close();
  outro.close();
});

test("a lista traz o processo vivo de cada sessão que tem um; a sem processo vem sem situação", (t: TestContext) => {
  const banco = bancoComUmaSessao();
  const sessoes = montarSessoesDeAgente({ banco });
  assert.equal("situacao" in (sessoes.listar()[0] ?? {}), false);
  const situacao = { execucao: "e1", ocupado: true, desde: T, dialogos: [] };
  t.mock.method(motorDoBanco(banco), "situacao", () => situacao);
  assert.deepEqual(sessoes.listar({ abertas: true })[0]?.situacao, situacao);
  assert.deepEqual(sessoes.esquecer(["I-1"]), { execucoes: ["e1"], sessoes: ["s1"] });
  assert.deepEqual(sessoes.listar(), []);
  banco.close();
});

test("a montagem do serviço grava o catálogo do harness, e a falha dele vai ao log; o parar espera e retira a API", async () => {
  const harnessOriginal = motorDoBanco(bancoComUmaSessao()).harness;
  const preco = {
    modelo: { provedor: "p", nome: "m" },
    usd_por_milhao: { entrada: 1, saida: 2, cache_leitura: 0, cache_escrita: 0 },
    origem: "teste",
  };
  const erros: unknown[] = [];
  const falhaDoCatalogo = new Error("o harness não respondeu");
  const leiturasDoCatalogo = [
    { precosDosModelos: () => Promise.resolve([preco]), precosGravados: 1 },
    { precosDosModelos: () => Promise.reject(falhaDoCatalogo), precosGravados: 0 },
  ];
  for (const { precosDosModelos, precosGravados } of leiturasDoCatalogo) {
    const banco = bancoComUmaSessao();
    const sessoes = montarSessoesDeAgente({
      banco,
      harness: {
        ...harnessOriginal,
        precosDosModelos,
        listarModelos: () => Promise.resolve([preco.modelo]),
      },
      urlDaApi: "http://127.0.0.1:1",
      catalogo: { relogio: { agora: () => T }, registrarErro: (erro) => erros.push(erro) },
    });
    assert.equal(motorDoBanco(banco).urlDaApi, "http://127.0.0.1:1");
    assert.deepEqual(await sessoes.modelos(), [preco.modelo]);
    await sessoes.parar();
    assert.equal(motorDoBanco(banco).urlDaApi, undefined);
    assert.equal(banco.prepare("SELECT modelo_nome FROM preco_do_modelo").all().length, precosGravados);
    banco.close();
  }
  assert.deepEqual(erros, [falhaDoCatalogo]);
});
