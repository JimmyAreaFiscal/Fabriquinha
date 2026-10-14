import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";
import { ZodError } from "zod";
import { ErroDeInexistente, ErroDeRegra } from "../dominio/erros.ts";
import { caminhoArquivo } from "./arquivos.ts";
import { abrir } from "./banco.ts";
import { editarProjeto, projeto, registrarProjeto } from "./projetos.ts";
import {
  anexar,
  criarTarefa,
  criarUsuarioSimulado,
  enfileirar,
  falharPendentes,
  gravarPgid,
  marcar,
  paraRodar,
  removerAnexo,
  tarefas,
  usuariosSimulados,
} from "./simulacao.ts";

const base = mkdtempSync(join(tmpdir(), "fabriquinha-simulacao-"));
after(() => {
  rmSync(base, { recursive: true, force: true });
});

function novoBanco(): DatabaseSync {
  const banco = abrir(mkdtempSync(join(base, "raiz-")));
  for (const nome of ["fabriquinha", "outro"]) {
    registrarProjeto(banco, {
      nome,
      repo: `/repos/${nome}`,
      branchBase: "main",
      hospedagem: "github",
      testes: ["npm test"],
      sonar: { projectKey: nome },
      fitness: [{ nome: "f", comando: "true", descricao: "d" }],
    });
  }
  return banco;
}

const MARIA = { nome: "Dona Maria", descricao: "Contadora de 60 anos, pouca familiaridade com sistemas web" };
const sha = (conteudo: string) => createHash("sha256").update(conteudo).digest("hex");

test("criarUsuarioSimulado grava e usuariosSimulados lista só os do projeto, na ordem de criação", () => {
  const banco = novoBanco();
  assert.deepEqual(usuariosSimulados(banco, "fabriquinha"), []);
  const maria = criarUsuarioSimulado(banco, "fabriquinha", { nome: " Dona Maria ", descricao: MARIA.descricao });
  const joao = criarUsuarioSimulado(banco, "fabriquinha", { nome: "Seu João", descricao: "Gerente" });
  criarUsuarioSimulado(banco, "outro", MARIA);

  assert.deepEqual(maria, { id: maria.id, projeto: "fabriquinha", ...MARIA, anexos: [] });
  assert.notEqual(maria.id, joao.id);
  assert.deepEqual(usuariosSimulados(banco, "fabriquinha"), [maria, joao]);
  assert.equal(usuariosSimulados(banco, "outro").length, 1);
  banco.close();
});

test("criarUsuarioSimulado recusa campo vazio, nome repetido no projeto e projeto inexistente, sem gravar", () => {
  const banco = novoBanco();
  criarUsuarioSimulado(banco, "fabriquinha", MARIA);
  assert.throws(
    () => criarUsuarioSimulado(banco, "fabriquinha", { nome: "Seu João", descricao: "" }),
    (erro) => erro instanceof ZodError && erro.issues[0]?.message === "Descrição obrigatória",
  );
  assert.throws(
    () => criarUsuarioSimulado(banco, "fabriquinha", MARIA),
    (erro) =>
      erro instanceof ErroDeRegra &&
      erro.message ===
        "já existe o Usuário Simulado Dona Maria no projeto fabriquinha (escolha outro nome para o novo usuário)",
  );
  assert.throws(
    () => criarUsuarioSimulado(banco, "fantasma", MARIA),
    (erro) =>
      erro instanceof ErroDeInexistente && erro.message === "o projeto fantasma não existe (confira o nome do projeto)",
  );
  assert.throws(() => usuariosSimulados(banco, "fantasma"), ErroDeInexistente);
  assert.equal(usuariosSimulados(banco, "fabriquinha").length, 1);
  banco.close();
});

test("anexar guarda o conteúdo por hash e lista o anexo com o tamanho; o mesmo nome troca o anexo", () => {
  const banco = novoBanco();
  const { id } = criarUsuarioSimulado(banco, "fabriquinha", MARIA);
  const manual = anexar(banco, id, "manual.pdf", Buffer.from("versão 1"));
  assert.deepEqual(manual, { nome: "manual.pdf", sha256: sha("versão 1"), bytes: Buffer.byteLength("versão 1") });
  assert.equal(readFileSync(caminhoArquivo(banco, manual.sha256), "utf8"), "versão 1");
  anexar(banco, id, "a.txt", Buffer.from("a"));
  assert.deepEqual(
    usuariosSimulados(banco, "fabriquinha")[0]?.anexos.map((a) => a.nome),
    ["a.txt", "manual.pdf"],
  );

  const trocado = anexar(banco, id, "manual.pdf", Buffer.from("v2"));
  assert.deepEqual(
    usuariosSimulados(banco, "fabriquinha")[0]?.anexos.find((a) => a.nome === "manual.pdf"),
    trocado,
  );
  assert.equal(usuariosSimulados(banco, "fabriquinha")[0]?.anexos.length, 2);
  assert.equal(trocado.bytes, 2);
  banco.close();
});

test("anexar recusa nome de formato não suportado e usuário inexistente, sem guardar nada", () => {
  const banco = novoBanco();
  const { id } = criarUsuarioSimulado(banco, "fabriquinha", MARIA);
  assert.throws(
    () => anexar(banco, id, "planilha.xlsx", Buffer.from("x")),
    (erro) =>
      erro instanceof ZodError && erro.issues[0]?.message === "formato não suportado: envie PDF, texto ou imagem",
  );
  assert.throws(
    () => anexar(banco, id + 1, "a.txt", Buffer.from("x")),
    (erro) =>
      erro instanceof ErroDeInexistente &&
      erro.message === `o Usuário Simulado ${String(id + 1)} não existe (confira o usuário na Configuração do projeto)`,
  );
  assert.equal(existsSync(join(banco.prepare("PRAGMA database_list").get()?.file as string, "..", "arquivos")), false);
  assert.deepEqual(usuariosSimulados(banco, "fabriquinha")[0]?.anexos, []);
  banco.close();
});

test("removerAnexo tira só o anexo pedido e mantém o arquivo; anexo ou usuário inexistente dá 404", () => {
  const banco = novoBanco();
  const { id } = criarUsuarioSimulado(banco, "fabriquinha", MARIA);
  const manual = anexar(banco, id, "manual.pdf", Buffer.from("m"));
  anexar(banco, id, "outro.txt", Buffer.from("o"));

  removerAnexo(banco, id, "manual.pdf");
  assert.deepEqual(
    usuariosSimulados(banco, "fabriquinha")[0]?.anexos.map((a) => a.nome),
    ["outro.txt"],
  );
  assert.equal(existsSync(caminhoArquivo(banco, manual.sha256)), true);
  assert.throws(
    () => {
      removerAnexo(banco, id, "manual.pdf");
    },
    (erro) =>
      erro instanceof ErroDeInexistente &&
      erro.message === `o Usuário Simulado ${String(id)} não tem o anexo manual.pdf (confira o nome do anexo)`,
  );
  assert.throws(() => {
    removerAnexo(banco, id + 1, "outro.txt");
  }, ErroDeInexistente);
  banco.close();
});

test("criarTarefa grava e tarefas lista só as do projeto, com os usuários alocados", () => {
  const banco = novoBanco();
  assert.deepEqual(tarefas(banco, "fabriquinha"), []);
  const maria = criarUsuarioSimulado(banco, "fabriquinha", MARIA);
  const joao = criarUsuarioSimulado(banco, "fabriquinha", { nome: "Seu João", descricao: "Gerente" });
  const dona = criarUsuarioSimulado(banco, "outro", MARIA);

  const primeira = criarTarefa(banco, "fabriquinha", {
    texto: " Registrar uma necessidade ",
    n: 3,
    usuarios: [joao.id, maria.id, maria.id],
  });
  const segunda = criarTarefa(banco, "fabriquinha", { texto: "Ver o histórico", n: 1, usuarios: [maria.id] });
  criarTarefa(banco, "outro", { texto: "Outra", n: 2, usuarios: [dona.id] });

  assert.deepEqual(primeira, {
    id: primeira.id,
    projeto: "fabriquinha",
    texto: "Registrar uma necessidade",
    n: 3,
    criadaEm: primeira.criadaEm,
    usuarios: [
      { id: maria.id, nome: "Dona Maria" },
      { id: joao.id, nome: "Seu João" },
    ],
    execucoes: [],
  });
  assert.ok(!Number.isNaN(Date.parse(primeira.criadaEm)));
  assert.deepEqual(tarefas(banco, "fabriquinha"), [primeira, segunda]);
  assert.equal(tarefas(banco, "outro").length, 1);
  banco.close();
});

test("criarTarefa recusa N e alocação inválidos, usuário de outro projeto e projeto inexistente, sem gravar", () => {
  const banco = novoBanco();
  const maria = criarUsuarioSimulado(banco, "fabriquinha", MARIA);
  const alheio = criarUsuarioSimulado(banco, "outro", MARIA);
  assert.throws(
    () => criarTarefa(banco, "fabriquinha", { texto: "t", n: 0, usuarios: [maria.id] }),
    (erro) => erro instanceof ZodError && erro.issues[0]?.message === "N deve ser um inteiro maior que zero",
  );
  assert.throws(
    () => criarTarefa(banco, "fabriquinha", { texto: "t", n: 1, usuarios: [] }),
    (erro) => erro instanceof ZodError && erro.issues[0]?.message === "Aloque ao menos um usuário simulado",
  );
  assert.throws(
    () => criarTarefa(banco, "fabriquinha", { texto: "t", n: 1, usuarios: [maria.id, alheio.id] }),
    (erro) =>
      erro instanceof ErroDeRegra &&
      erro.message ===
        `o Usuário Simulado ${String(alheio.id)} não é do projeto fabriquinha (aloque só usuários simulados do projeto)`,
  );
  assert.throws(
    () => criarTarefa(banco, "fantasma", { texto: "t", n: 1, usuarios: [maria.id] }),
    (erro) =>
      erro instanceof ErroDeInexistente && erro.message === "o projeto fantasma não existe (confira o nome do projeto)",
  );
  assert.throws(() => tarefas(banco, "fantasma"), ErroDeInexistente);
  assert.deepEqual(tarefas(banco, "fabriquinha"), []);
  assert.equal(banco.prepare("SELECT count(*) AS n FROM tarefa_usuario").get()?.n, 0);
  banco.close();
});

/** O projeto `fabriquinha` com link do produto, os usuários `nomes` e uma Tarefa de `n` execuções para todos. */
function comTarefa(n: number, nomes = ["Dona Maria"], link = "https://demo.exemplo.com") {
  const banco = novoBanco();
  const atual = projeto(banco, "fabriquinha");
  assert.ok(atual);
  if (link) editarProjeto(banco, { ...atual, linkProduto: link });
  const usuarios = nomes.map((nome) =>
    criarUsuarioSimulado(banco, "fabriquinha", { nome, descricao: MARIA.descricao }),
  );
  const tarefa = criarTarefa(banco, "fabriquinha", {
    texto: "Registrar uma necessidade",
    n,
    usuarios: usuarios.map((u) => u.id),
  });
  return { banco, tarefa: tarefa.id, usuarios };
}

test("enfileirar cria N execuções na_fila por usuário alocado, numa ordem estável, e devolve os IDs e o link (CA-11 e CA-12)", () => {
  const { banco, tarefa, usuarios } = comTarefa(2, ["Dona Maria", "Seu João"]);
  const { execucoes, link } = enfileirar(banco, tarefa);

  assert.equal(link, "https://demo.exemplo.com");
  assert.equal(execucoes.length, 4);
  const lista = tarefas(banco, "fabriquinha")[0]?.execucoes;
  assert.deepEqual(
    lista,
    execucoes.map((id, i) => ({
      id,
      usuario: usuarios[Math.floor(i / 2)]?.id,
      usuarioNome: usuarios[Math.floor(i / 2)]?.nome,
      status: "na_fila",
    })),
  );
  banco.close();
});

test("enfileirar recusa Tarefa sem link do produto (CA-10), com pendente e Tarefa inexistente, sem gravar", () => {
  const sem = comTarefa(1, ["Dona Maria"], "");
  assert.throws(
    () => enfileirar(sem.banco, sem.tarefa),
    (erro) => erro instanceof ErroDeRegra && erro.message === "Informe o link do produto na Configuração do projeto",
  );
  assert.deepEqual(tarefas(sem.banco, "fabriquinha")[0]?.execucoes, []);
  sem.banco.close();

  const { banco, tarefa } = comTarefa(1);
  assert.throws(
    () => enfileirar(banco, 999),
    (erro) =>
      erro instanceof ErroDeInexistente &&
      erro.message === "a Tarefa 999 não existe (confira a Tarefa na página Simulação)",
  );
  const { execucoes } = enfileirar(banco, tarefa);
  const pendente = (erro: unknown) =>
    erro instanceof ErroDeRegra &&
    erro.message === "a Tarefa já está em execução (espere ela terminar para executar de novo)";
  assert.throws(() => enfileirar(banco, tarefa), pendente);
  marcar(banco, execucoes[0] ?? 0, { status: "em_andamento" });
  assert.throws(() => enfileirar(banco, tarefa), pendente);
  assert.equal(tarefas(banco, "fabriquinha")[0]?.execucoes.length, 1);

  // Terminada, a Tarefa pode ser executada de novo, e as execuções se somam.
  marcar(banco, execucoes[0] ?? 0, { status: "falhou", erro: "x" });
  enfileirar(banco, tarefa);
  assert.deepEqual(
    tarefas(banco, "fabriquinha")[0]?.execucoes.map((e) => e.status),
    ["falhou", "na_fila"],
  );
  banco.close();
});

test("marcar leva a execução de na_fila a em_andamento e a concluída ou falhou, com relatório, erro e horários", () => {
  const { banco, tarefa } = comTarefa(3);
  const { execucoes } = enfileirar(banco, tarefa);
  const [a, b, c] = execucoes as [number, number, number];
  const relatorio = { usabilidade: ["O botão é pequeno"], bugs: [] };
  const linha = (id: number) => ({
    ...banco.prepare("SELECT status, iniciada_em, terminada_em, pgid FROM execucao_simulada WHERE id = ?").get(id),
  });

  marcar(banco, a, { status: "em_andamento" });
  gravarPgid(banco, a, 4321);
  assert.deepEqual(linha(a), {
    status: "em_andamento",
    iniciada_em: linha(a).iniciada_em,
    terminada_em: null,
    pgid: 4321,
  });
  assert.ok(!Number.isNaN(Date.parse(String(linha(a).iniciada_em))));

  marcar(banco, a, { status: "concluida", relatorio });
  marcar(banco, b, { status: "em_andamento" });
  marcar(banco, b, { status: "falhou", erro: "Não foi possível abrir o link do produto" });
  assert.deepEqual(linha(a), {
    status: "concluida",
    iniciada_em: linha(a).iniciada_em,
    terminada_em: linha(a).terminada_em,
    pgid: null,
  });
  assert.ok(!Number.isNaN(Date.parse(String(linha(a).terminada_em))));
  assert.deepEqual(
    tarefas(banco, "fabriquinha")[0]?.execucoes.map(({ id, status, relatorio: r, erro }) => ({ id, status, r, erro })),
    [
      { id: a, status: "concluida", r: relatorio, erro: undefined },
      { id: b, status: "falhou", r: undefined, erro: "Não foi possível abrir o link do produto" },
      { id: c, status: "na_fila", r: undefined, erro: undefined },
    ],
  );
  banco.close();
});

test("falharPendentes falha só as pendentes, devolve os pgid dos pi vivos e deixa as terminadas", () => {
  const { banco, tarefa } = comTarefa(4);
  const [a, b, c, d] = enfileirar(banco, tarefa).execucoes as [number, number, number, number];
  marcar(banco, a, { status: "em_andamento" });
  gravarPgid(banco, a, 777);
  marcar(banco, b, { status: "concluida", relatorio: { usabilidade: [], bugs: [] } });
  marcar(banco, c, { status: "falhou", erro: "antes" });
  gravarPgid(banco, d, 888); // na_fila com pgid não existe de verdade, mas o que importa é o status

  assert.deepEqual(falharPendentes(banco, "serviço reiniciado").sort(), [777, 888]);
  assert.deepEqual(
    tarefas(banco, "fabriquinha")[0]?.execucoes.map((e) => [e.status, e.erro]),
    [
      ["falhou", "serviço reiniciado"],
      ["concluida", undefined],
      ["falhou", "antes"],
      ["falhou", "serviço reiniciado"],
    ],
  );
  assert.equal(banco.prepare("SELECT count(*) AS n FROM execucao_simulada WHERE pgid IS NOT NULL").get()?.n, 0);
  assert.deepEqual(falharPendentes(banco, "outra vez"), []);
  banco.close();
});

test("paraRodar traz o texto da Tarefa e o Usuário Simulado com os anexos; execução inexistente é ErroDeInexistente", () => {
  const { banco, tarefa, usuarios } = comTarefa(1, ["Dona Maria", "Seu João"]);
  anexar(banco, usuarios[1]?.id ?? 0, "guia.md", Buffer.from("#"));
  const { execucoes } = enfileirar(banco, tarefa);

  const dele = paraRodar(banco, execucoes[1] ?? 0);
  assert.equal(dele.texto, "Registrar uma necessidade");
  assert.deepEqual(dele.usuario, usuariosSimulados(banco, "fabriquinha")[1]);
  assert.equal(dele.usuario.anexos[0]?.nome, "guia.md");
  assert.throws(() => paraRodar(banco, 999), ErroDeInexistente);
  banco.close();
});
