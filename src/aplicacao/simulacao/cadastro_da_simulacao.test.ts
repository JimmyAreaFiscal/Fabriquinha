import assert from "node:assert/strict";
import { test } from "node:test";
import { ZodError } from "zod";
import { fabricaDeBancosTemporarios } from "../../../apoio-testes/banco_temporario.ts";
import { registrarProjeto } from "../projeto/cadastro.ts";
import { tarefas, usuariosSimulados } from "../../armazenamento/simulacao.ts";
import { validarECriarTarefa, validarECriarUsuarioSimulado } from "./cadastro_da_simulacao.ts";

const abrirBancoTemporario = fabricaDeBancosTemporarios();

function novoBanco() {
  const { banco } = abrirBancoTemporario();
  registrarProjeto(banco, {
    nome: "fabriquinha",
    raiz_git: "/repos/fabriquinha",
    branch_base: "main",
    hospedagem: "github",
    chave_sonarqube: "fabriquinha",
  });
  return banco;
}
const MENSAGEM = (erro: unknown) => (erro instanceof ZodError ? erro.issues[0]?.message : undefined);

test("validarECriarUsuarioSimulado apara o nome e recusa campo vazio sem gravar", () => {
  const banco = novoBanco();
  const maria = validarECriarUsuarioSimulado(banco, "fabriquinha", { nome: " Dona Maria ", descricao: "Contadora" });
  assert.equal(maria.nome, "Dona Maria");
  assert.throws(
    () => validarECriarUsuarioSimulado(banco, "fabriquinha", { nome: "Seu João", descricao: "" }),
    (erro) => MENSAGEM(erro) === "Descrição obrigatória",
  );
  assert.equal(usuariosSimulados(banco, "fabriquinha").length, 1);
  banco.close();
});

test("validarECriarTarefa recusa N e alocação inválidos sem gravar", () => {
  const banco = novoBanco();
  const maria = validarECriarUsuarioSimulado(banco, "fabriquinha", { nome: "Dona Maria", descricao: "Contadora" });
  assert.throws(
    () => validarECriarTarefa(banco, "fabriquinha", { texto: "t", n: 0, usuarios: [maria.id] }),
    (erro) => MENSAGEM(erro) === "N deve ser um inteiro maior que zero",
  );
  assert.throws(
    () => validarECriarTarefa(banco, "fabriquinha", { texto: "t", n: 1, usuarios: [] }),
    (erro) => MENSAGEM(erro) === "Aloque ao menos um usuário simulado",
  );
  assert.deepEqual(tarefas(banco, "fabriquinha"), []);
  const tarefa = validarECriarTarefa(banco, "fabriquinha", { texto: " Ver ", n: 1, usuarios: [maria.id] });
  assert.equal(tarefa.texto, "Ver");
  banco.close();
});
