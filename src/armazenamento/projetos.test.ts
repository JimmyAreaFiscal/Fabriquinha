import assert from "node:assert/strict";
import { test } from "node:test";
import { fabricaDeBancosTemporarios } from "../../apoio-testes/banco_temporario.ts";
import { ErroDeInexistente, ErroDeRegra } from "../nucleo/erros.ts";
import { Projeto } from "../nucleo/projeto.ts";
import { carregarProjeto, donoDoRepositorio, inserirProjeto, projetoExistente } from "./projetos.ts";

const abrirBancoTemporario = fabricaDeBancosTemporarios();

const exemplo = Projeto.parse({
  nome: "loja",
  repo: "/repos/loja",
  branchBase: "main",
  hospedagem: "github",
  sonar: { projectKey: "loja" },
});

test("projetoExistente devolve o projeto cadastrado", () => {
  const { banco } = abrirBancoTemporario();
  inserirProjeto(banco, exemplo);
  assert.equal(projetoExistente(banco, "loja").repo, "/repos/loja");
  banco.close();
});

test("projetoExistente recusa o projeto inexistente, com a orientação padrão ou a de quem chama", () => {
  const { banco } = abrirBancoTemporario();
  const recusa = (orientacao: string | undefined, mensagem: string) => {
    assert.throws(
      () => projetoExistente(banco, "fantasma", orientacao),
      (erro) => erro instanceof ErroDeInexistente && erro.message === mensagem,
    );
  };
  recusa(undefined, "o projeto fantasma não existe (confira o nome do projeto)");
  recusa("confira a execução", "o projeto fantasma não existe (confira a execução)");
  banco.close();
});

test("carregarProjeto recusa o projeto inexistente com a orientação de configurar", () => {
  const { banco } = abrirBancoTemporario();
  assert.throws(
    () => carregarProjeto(banco, "fantasma"),
    (erro) =>
      erro instanceof ErroDeRegra &&
      erro.message === "o projeto fantasma não tem configuração do SDLC (configure o projeto)",
  );
  banco.close();
});

test("donoDoRepositorio acha só o outro projeto que usa o repositório; inserirProjeto não duplica o nome", () => {
  const { banco } = abrirBancoTemporario();
  assert.equal(inserirProjeto(banco, exemplo), true);
  assert.equal(inserirProjeto(banco, exemplo), false);
  assert.equal(donoDoRepositorio(banco, "/repos/loja", "outro"), "loja");
  assert.equal(donoDoRepositorio(banco, "/repos/loja", "loja"), undefined);
  banco.close();
});
