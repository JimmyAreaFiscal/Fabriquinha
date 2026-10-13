import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { ZodError } from "zod";
import type { DatabaseSync } from "node:sqlite";
import { ErroDeInexistente, ErroDeRegra } from "../dominio/erros.ts";
import { caminhoArquivo } from "./arquivos.ts";
import { abrir, raizDo } from "./banco.ts";
import { dirDaExecucao } from "./execucoes.ts";
import { editarProjeto, projeto, projetos, registrarProjeto, removerProjeto } from "./projetos.ts";

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

test("o link do produto é gravado, relido e apagado ao editar com o campo vazio", () => {
  const banco = novoBanco();
  const link = "https://demo.exemplo.com";
  registrarProjeto(banco, { ...exemplo, linkProduto: link });
  assert.equal(projeto(banco, "fabriquinha")?.linkProduto, link);
  assert.throws(() => editarProjeto(banco, { ...exemplo, linkProduto: "isso nao e um link" }), ZodError);
  assert.equal(projeto(banco, "fabriquinha")?.linkProduto, link);
  assert.equal(editarProjeto(banco, { ...exemplo, linkProduto: "" }).linkProduto, undefined);
  assert.equal(projeto(banco, "fabriquinha")?.linkProduto, undefined);
  banco.close();
});

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

const TABELAS = [
  "usuario_simulado_anexo",
  "usuario_simulado",
  "uso",
  "retrabalho",
  "arquivo_commit",
  "commit_ticket",
  "evidencia_arquivo",
  "evidencia",
  "decisao",
  "execucao",
  "comando",
  "issue_dep",
  "ticket",
  "varredura_base",
  "issue",
  "projeto",
];
const contagens = (banco: DatabaseSync) =>
  TABELAS.map((t) => Number(banco.prepare(`SELECT count(*) AS n FROM ${t}`).get()?.n));
const custo = (banco: DatabaseSync) => Number(banco.prepare("SELECT total(custo) AS c FROM uso").get()?.c);

const SHA_COMPARTILHADO = "c".repeat(64);
let contador = 0;

/**
 * Um projeto com 4 issues (registro, desenho, desenvolvimento, concluida), cada uma com linhas em todas as tabelas e
 * disco. O anexo da primeira issue tem o hash compartilhado entre projetos; o das outras, o `shaProprio`.
 */
function popular(banco: DatabaseSync, nome: string, shaProprio: string): [number, number, number, number] {
  const raiz = raizDo(banco);
  registrarProjeto(banco, { ...exemplo, nome, repo: `/repos/${nome}` });
  banco.prepare("INSERT INTO varredura_base (projeto, ultimo_sha, em) VALUES (?, ?, ?)").run(nome, "a".repeat(40), "t");
  const issues = (["registro", "desenho", "desenvolvimento", "concluida"] as const).map((fase, i) => {
    const id = ++contador;
    const n = String(id);
    const concluida = fase === "concluida" ? "'t'" : "NULL";
    banco.exec(`
      INSERT INTO issue (id, projeto, titulo, tipo, fase, criada_em, concluida_em)
        VALUES (${n}, '${nome}', 't', 'funcionalidade', '${fase}', 't', ${concluida});
      INSERT INTO ticket (id, issue, etapa, titulo, status, origem, criado_em, concluido_em)
        VALUES (${n}, ${n}, 'desenvolvimento', 't', 'concluido', 'auditor', 't', 't');
      INSERT INTO execucao (id, ticket, modo, sessao_pi, resultado, iniciada_em, terminada_em)
        VALUES (${n}, ${n}, 'autonomo', 's${n}', 'sucesso', 't', 't');
      INSERT INTO uso VALUES (${n}, 'p', 'm', 1, 1, 1, 0, 0, ${n}.5);
      INSERT INTO evidencia (id, ticket, tipo, produtor, em) VALUES (${n}, ${n}, 'comportamento', 'agente', 't');
      INSERT INTO evidencia_arquivo VALUES (${n}, 'a.txt', '${i === 0 ? SHA_COMPARTILHADO : shaProprio}', 'text/plain', 1);
      INSERT INTO decisao (id, issue, ticket, gate, aprovado, por, em)
        VALUES (${n}, ${n}, ${n}, 'registro', 1, 'auditor', 't');
      INSERT INTO comando (issue, nome, ator, fase, em) VALUES (${n}, 'c', 'auditor', 'registro', 't');
      INSERT INTO commit_ticket VALUES ('${n.padStart(40, "b")}', ${n}, 'm', 't');
      INSERT INTO arquivo_commit (sha, caminho, status) VALUES ('${n.padStart(40, "b")}', 'f', 'A');
      INSERT INTO retrabalho VALUES ('${n.padStart(40, "d")}', NULL, 'x', ${n}, 1);
    `);
    mkdirSync(dirDaExecucao(raiz, id), { recursive: true });
    writeFileSync(join(dirDaExecucao(raiz, id), "log"), "x");
    mkdirSync(join(raiz, "sessoes"), { recursive: true });
    writeFileSync(join(raiz, "sessoes", `2026-01-01T00-00-00Z_s${n}.jsonl`), "x");
    return id;
  }) as [number, number, number, number];
  banco.exec(`
    INSERT INTO usuario_simulado (projeto, nome, descricao) VALUES ('${nome}', 'Dona Maria', 'd');
    INSERT INTO usuario_simulado_anexo SELECT id, 'manual.pdf', '${shaProprio}', 1 FROM usuario_simulado WHERE projeto = '${nome}';
  `);
  for (const sha of [SHA_COMPARTILHADO, shaProprio]) {
    mkdirSync(join(caminhoArquivo(banco, sha), ".."), { recursive: true });
    writeFileSync(caminhoArquivo(banco, sha), "x");
  }
  return issues;
}

test("removerProjeto apaga o projeto e tudo dele, no banco e no disco, e deixa o outro intacto", async () => {
  const banco = novoBanco();
  const raiz = raizDo(banco);
  const [issueOutro] = popular(banco, "outro", "e".repeat(64));
  const antes = contagens(banco);
  const custoAntes = custo(banco);
  const demo = popular(banco, "demo", "f".repeat(64));
  banco.prepare("INSERT INTO issue_dep (issue, dep) VALUES (?, ?)").run(issueOutro, demo[0]);

  const { projeto: removido, avisos } = await removerProjeto(banco, "demo");

  assert.equal(removido.nome, "demo");
  assert.equal(removido.repo, "/repos/demo");
  assert.deepEqual(avisos, []);
  assert.deepEqual(contagens(banco), antes);
  assert.equal(custo(banco), custoAntes);
  assert.equal(projeto(banco, "demo"), undefined);
  assert.equal(projeto(banco, "outro")?.nome, "outro");
  for (const n of demo) {
    assert.equal(existsSync(dirDaExecucao(raiz, n)), false);
    assert.equal(existsSync(join(raiz, "sessoes", `2026-01-01T00-00-00Z_s${String(n)}.jsonl`)), false);
  }
  assert.equal(existsSync(caminhoArquivo(banco, "f".repeat(64))), false);
  assert.equal(existsSync(caminhoArquivo(banco, SHA_COMPARTILHADO)), true);
  assert.equal(existsSync(caminhoArquivo(banco, "e".repeat(64))), true);
  for (let n = 1; n <= 4; n++) {
    assert.equal(existsSync(dirDaExecucao(raiz, n)), true);
    assert.equal(existsSync(join(raiz, "sessoes", `2026-01-01T00-00-00Z_s${String(n)}.jsonl`)), true);
  }
  banco.close();
});

test("removerProjeto não apaga o arquivo que um anexo de outro projeto ainda usa", async () => {
  const banco = novoBanco();
  popular(banco, "demo", "f".repeat(64));
  registrarProjeto(banco, { ...exemplo, nome: "outro", repo: "/repos/outro" });
  banco.exec(`
    INSERT INTO usuario_simulado (projeto, nome, descricao) VALUES ('outro', 'Seu João', 'd');
    INSERT INTO usuario_simulado_anexo SELECT id, 'igual.pdf', '${"f".repeat(64)}', 1 FROM usuario_simulado WHERE projeto = 'outro';
  `);
  await removerProjeto(banco, "demo");
  assert.equal(existsSync(caminhoArquivo(banco, "f".repeat(64))), true);
  banco.close();
});

const recusaAsync = async (trabalho: () => Promise<unknown>, tipo: typeof ErroDeRegra, mensagem: string) => {
  await assert.rejects(trabalho, (erro) => erro instanceof tipo && erro.message === mensagem);
};

test("removerProjeto recusa projeto inexistente, sem mudar nada", async () => {
  const banco = novoBanco();
  popular(banco, "outro", "e".repeat(64));
  const antes = contagens(banco);
  await recusaAsync(
    () => removerProjeto(banco, "fantasma"),
    ErroDeInexistente,
    "o projeto fantasma não existe (confira o nome do projeto)",
  );
  assert.deepEqual(contagens(banco), antes);
  banco.close();
});

test("removerProjeto recusa execução em andamento e ticket em execução, sem apagar nada", async () => {
  const banco = novoBanco();
  const [primeira, segunda] = popular(banco, "demo", "f".repeat(64));
  const antes = contagens(banco);

  banco.prepare("UPDATE execucao SET resultado = 'em_andamento', terminada_em = NULL WHERE id = ?").run(primeira);
  await recusaAsync(
    () => removerProjeto(banco, "demo"),
    ErroDeRegra,
    `o projeto demo tem execução em andamento no T-${String(primeira)} (espere ela terminar ou pare a sessão, e remova de novo)`,
  );
  assert.deepEqual(contagens(banco), antes);
  assert.equal(existsSync(dirDaExecucao(raizDo(banco), primeira)), true);

  banco.prepare("UPDATE execucao SET resultado = 'sucesso', terminada_em = 't' WHERE id = ?").run(primeira);
  banco.prepare("UPDATE ticket SET status = 'em_execucao', concluido_em = NULL WHERE id = ?").run(segunda);
  await recusaAsync(
    () => removerProjeto(banco, "demo"),
    ErroDeRegra,
    `o projeto demo tem execução em andamento no T-${String(segunda)} (espere ela terminar ou pare a sessão, e remova de novo)`,
  );
  assert.deepEqual(contagens(banco), antes);
  banco.close();
});

test("removerProjeto sem issues nem sessões no disco só apaga o projeto", async () => {
  const banco = novoBanco();
  registrarProjeto(banco, exemplo);
  const { avisos } = await removerProjeto(banco, "fabriquinha");
  assert.deepEqual(avisos, []);
  assert.deepEqual(projetos(banco), []);
  banco.close();
});

test("removerProjeto: falha ao apagar no disco vira aviso e não desfaz o banco", async () => {
  const banco = novoBanco();
  const raiz = raizDo(banco);
  popular(banco, "demo", "f".repeat(64));
  chmodSync(join(raiz, "execucoes"), 0o500); // sem escrita: não dá para apagar E-n dentro dela
  try {
    const { avisos } = await removerProjeto(banco, "demo");
    assert.equal(avisos.length, 4);
    for (const aviso of avisos) assert.match(aviso, /^não foi possível apagar .*E-\d+: /);
  } finally {
    chmodSync(join(raiz, "execucoes"), 0o700);
  }
  assert.equal(projeto(banco, "demo"), undefined);
  assert.deepEqual(
    contagens(banco),
    TABELAS.map(() => 0),
  );
  banco.close();
});
