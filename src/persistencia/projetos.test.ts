import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { ZodError } from "zod";
import { ErroDeRegra } from "../dominio/erros.ts";
import { abrir } from "./banco.ts";
import { editarProjeto, projeto, projetos, registrarProjeto } from "./projetos.ts";

const base = mkdtempSync(join(tmpdir(), "fabriquinha-projetos-"));
after(() => {
  rmSync(base, { recursive: true, force: true });
});
const novoBanco = () => abrir(mkdtempSync(join(base, "raiz-")));

const exemplo = {
  nome: "fabriquinha",
  repo: "/repos/fabriquinha",
  branchBase: "main",
  hospedagem: "github" as const,
  preparacao: ["npm ci"],
  testes: ["npm test", "npm run e2e"],
  sonar: { projectKey: "Fabriquinha" },
  fitness: [{ nome: "dominio-sem-io", comando: "npm run fitness", descricao: "o domínio não faz I/O" }],
  modelos: { desenho: { provedor: "openai", modelo: "gpt-5" } },
};

test("registrarProjeto cadastra e projeto/projetos leem de volta igual, em ordem de nome", () => {
  const banco = novoBanco();
  assert.equal(projeto(banco, "fabriquinha"), undefined);
  assert.deepEqual(projetos(banco), []);

  const minimo = { ...exemplo, nome: "abc", repo: "/repos/abc", preparacao: undefined, modelos: undefined };
  assert.deepEqual(registrarProjeto(banco, exemplo), exemplo);
  registrarProjeto(banco, minimo);

  assert.deepEqual(projeto(banco, "fabriquinha"), exemplo);
  assert.deepEqual(
    projetos(banco).map((p) => [p.nome, p.preparacao, p.modelos]),
    [
      ["abc", [], {}],
      ["fabriquinha", ["npm ci"], { desenho: { provedor: "openai", modelo: "gpt-5" } }],
    ],
  );
  banco.close();
});

const recusa = (trabalho: () => unknown, mensagem: string) => {
  assert.throws(trabalho, (erro) => erro instanceof ErroDeRegra && erro.message === mensagem);
};

test("registrarProjeto recusa nome que já existe, sem mexer no projeto", () => {
  const banco = novoBanco();
  registrarProjeto(banco, exemplo);
  recusa(
    () => registrarProjeto(banco, { ...exemplo, repo: "/repos/outro", branchBase: "develop" }),
    "já existe o projeto fabriquinha (edite-o na Configuração)",
  );
  assert.deepEqual(projetos(banco), [exemplo]);
  banco.close();
});

test("editarProjeto substitui a configuração inteira, inclusive sem mudança", () => {
  const banco = novoBanco();
  registrarProjeto(banco, exemplo);
  assert.deepEqual(editarProjeto(banco, exemplo), exemplo);
  const editado = {
    ...exemplo,
    repo: "/repos/outro-lugar",
    branchBase: "develop",
    hospedagem: "azure-devops" as const,
    preparacao: [],
    testes: ["make test"],
    sonar: { projectKey: "Outra" },
    fitness: [{ nome: "f", comando: "make f", descricao: "d" }],
    modelos: {},
  };
  editarProjeto(banco, editado);
  assert.deepEqual(projetos(banco), [editado]);
  banco.close();
});

test("editarProjeto recusa projeto que não existe, sem criá-lo", () => {
  const banco = novoBanco();
  recusa(() => editarProjeto(banco, exemplo), "o projeto fabriquinha não existe (cadastre-o na Configuração)");
  assert.deepEqual(projetos(banco), []);
  banco.close();
});

test("registrar e editar recusam o schema do F1 sem gravar nada", () => {
  const banco = novoBanco();
  assert.throws(() => registrarProjeto(banco, { ...exemplo, testes: [] }), ZodError);
  registrarProjeto(banco, exemplo);
  assert.throws(() => editarProjeto(banco, { ...exemplo, testes: [] }), ZodError);
  assert.deepEqual(projetos(banco), [exemplo]);
  banco.close();
});

test("registrar e editar recusam um repositório que já é de outro projeto", () => {
  const banco = novoBanco();
  registrarProjeto(banco, exemplo);
  registrarProjeto(banco, { ...exemplo, nome: "outro", repo: "/repos/outro" });
  const mensagem =
    "o repositório /repos/fabriquinha já é do projeto fabriquinha (edite o projeto fabriquinha em vez de cadastrar outro para o mesmo repositório)";
  recusa(() => registrarProjeto(banco, { ...exemplo, nome: "copia" }), mensagem);
  recusa(() => editarProjeto(banco, { ...exemplo, nome: "outro" }), mensagem);
  assert.deepEqual(
    projetos(banco).map((p) => [p.nome, p.repo]),
    [
      ["fabriquinha", "/repos/fabriquinha"],
      ["outro", "/repos/outro"],
    ],
  );
  banco.close();
});

test("as constraints da tabela projeto valem no banco, não só no schema", () => {
  const banco = novoBanco();
  const inserir = (troca: Record<string, string>) => {
    const linha = {
      nome: "'p'",
      repo: "'/r'",
      branch_base: "'main'",
      hospedagem: "'github'",
      testes: `'["t"]'`,
      sonar_project_key: "'k'",
      fitness: `'[{}]'`,
      ...troca,
    };
    banco.exec(`INSERT INTO projeto (${Object.keys(linha).join(",")}) VALUES (${Object.values(linha).join(",")})`);
  };
  const violacoes: [Record<string, string>, RegExp][] = [
    [{ nome: "''" }, /CHECK/],
    [{ nome: `'${"a".repeat(65)}'` }, /CHECK/],
    [{ hospedagem: "'gitlab'" }, /CHECK/],
    [{ preparacao: "'nao json'" }, /CHECK/],
    [{ testes: "'[]'" }, /CHECK/],
    [{ testes: "'x'" }, /CHECK/],
    [{ fitness: "'[]'" }, /CHECK/],
    [{ fitness: "'x'" }, /CHECK/],
    [{ modelos: "'{'" }, /CHECK/],
    [{ branch_base: "NULL" }, /NOT NULL/],
    [{ sonar_project_key: "NULL" }, /NOT NULL/],
  ];
  for (const [troca, erro] of violacoes) {
    assert.throws(() => {
      inserir(troca);
    }, erro);
  }
  inserir({});
  assert.throws(() => {
    inserir({ nome: "'q'" });
  }, /UNIQUE constraint failed: projeto.repo/);
  assert.throws(() => {
    inserir({ repo: "'/s'" });
  }, /UNIQUE constraint failed: projeto.nome/);
  banco.close();
});
