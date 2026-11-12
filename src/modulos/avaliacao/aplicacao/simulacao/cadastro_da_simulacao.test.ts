import assert from "node:assert/strict";
import { test } from "node:test";
import { ZodError } from "zod";
import { fabricaDeBancosTemporarios } from "../../../../../apoio-testes/banco_temporario.ts";
import { relogioFixo } from "../../../compartilhado/nucleo/relogio.ts";
import { registrarProjeto } from "../../../projeto/aplicacao/cadastro.ts";
import { tarefas, usuariosSimulados } from "../../armazenamento/simulacao.ts";
import {
  anexarArquivoAoUsuarioSimulado,
  listarTarefas,
  listarUsuariosSimulados,
  removerAnexoDoUsuarioSimulado,
  validarECriarTarefa,
  validarECriarUsuarioSimulado,
} from "./cadastro_da_simulacao.ts";

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
const relogio = relogioFixo("2026-05-01T12:00:00.000Z");
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
    () => validarECriarTarefa(banco, "fabriquinha", { texto: "t", n: 0, usuarios: [maria.id] }, relogio),
    (erro) => MENSAGEM(erro) === "N deve ser um inteiro maior que zero",
  );
  assert.throws(
    () => validarECriarTarefa(banco, "fabriquinha", { texto: "t", n: 1, usuarios: [] }, relogio),
    (erro) => MENSAGEM(erro) === "Aloque ao menos um usuário simulado",
  );
  assert.deepEqual(tarefas(banco, "fabriquinha"), []);
  const tarefa = validarECriarTarefa(banco, "fabriquinha", { texto: " Ver ", n: 1, usuarios: [maria.id] }, relogio);
  assert.equal(tarefa.texto, "Ver");
  assert.equal(tarefa.criadaEm, relogio.agora());
  banco.close();
});

test("listar, anexar e remover anexo passam pelo caso de uso e leem o que foi gravado", () => {
  const banco = novoBanco();
  const maria = validarECriarUsuarioSimulado(banco, "fabriquinha", { nome: "Dona Maria", descricao: "Contadora" });
  const anexo = anexarArquivoAoUsuarioSimulado(banco, maria.id, "manual.txt", Buffer.from("oi"));
  assert.deepEqual(listarUsuariosSimulados(banco, "fabriquinha")[0]?.anexos, [anexo]);
  removerAnexoDoUsuarioSimulado(banco, maria.id, "manual.txt");
  assert.deepEqual(listarUsuariosSimulados(banco, "fabriquinha")[0]?.anexos, []);
  validarECriarTarefa(banco, "fabriquinha", { texto: "Ver", n: 1, usuarios: [maria.id] }, relogio);
  assert.equal(listarTarefas(banco, "fabriquinha").length, 1);
  banco.close();
});
