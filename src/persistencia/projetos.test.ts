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
import { dirDaExecucaoSimulada } from "./execucoes.ts";
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
  sonar: { projectKey: "Fabriquinha" },
};
const lido = exemplo;

test("registrarProjeto cadastra e projeto/projetos leem de volta igual, em ordem de nome", () => {
  const banco = novoBanco();
  assert.equal(projeto(banco, "fabriquinha"), undefined);
  assert.deepEqual(projetos(banco), []);

  const minimo = { ...exemplo, nome: "abc", repo: "/repos/abc", preparacao: undefined };
  assert.deepEqual(registrarProjeto(banco, exemplo), exemplo);
  registrarProjeto(banco, minimo);

  assert.deepEqual(projeto(banco, "fabriquinha"), lido);
  assert.deepEqual(
    projetos(banco).map((p) => [p.nome, p.preparacao]),
    [
      ["abc", []],
      ["fabriquinha", ["npm ci"]],
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

test("a edição não toca a chave do SonarQube, que é da configuração SDLC", () => {
  const banco = novoBanco();
  registrarProjeto(banco, exemplo);
  const chave = () =>
    banco.prepare("SELECT sonar_project_key FROM projeto WHERE nome = 'fabriquinha'").get()?.sonar_project_key;
  assert.equal(chave(), "Fabriquinha");
  banco.prepare("UPDATE projeto SET sonar_project_key = 'da-sdlc' WHERE nome = 'fabriquinha'").run();
  editarProjeto(banco, { ...exemplo, sonar: { projectKey: "outra" }, branchBase: "develop" });
  assert.equal(chave(), "da-sdlc");
  assert.equal(projeto(banco, "fabriquinha")?.branchBase, "develop");
  banco.close();
});

test("registrarProjeto recusa nome que já existe, sem mexer no projeto", () => {
  const banco = novoBanco();
  registrarProjeto(banco, exemplo);
  recusa(
    () => registrarProjeto(banco, { ...exemplo, repo: "/repos/outro", branchBase: "develop" }),
    "já existe o projeto fabriquinha (edite-o na Configuração)",
  );
  assert.deepEqual(projetos(banco), [lido]);
  banco.close();
});

test("editarProjeto substitui o cadastro, inclusive sem mudança", () => {
  const banco = novoBanco();
  registrarProjeto(banco, exemplo);
  assert.deepEqual(editarProjeto(banco, exemplo), exemplo);
  const editado = {
    ...exemplo,
    repo: "/repos/outro-lugar",
    branchBase: "develop",
    hospedagem: "azure-devops" as const,
    preparacao: [],
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
  assert.throws(() => registrarProjeto(banco, { ...exemplo, repo: "relativo" }), ZodError);
  registrarProjeto(banco, exemplo);
  assert.throws(() => editarProjeto(banco, { ...exemplo, repo: "relativo" }), ZodError);
  assert.deepEqual(projetos(banco), [lido]);
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
      sonar_project_key: "'k'",
      ...troca,
    };
    banco.exec(`INSERT INTO projeto (${Object.keys(linha).join(",")}) VALUES (${Object.values(linha).join(",")})`);
  };
  const violacoes: [Record<string, string>, RegExp][] = [
    [{ nome: "''" }, /CHECK/],
    [{ nome: `'${"a".repeat(65)}'` }, /CHECK/],
    [{ hospedagem: "'gitlab'" }, /CHECK/],
    [{ preparacao: "'nao json'" }, /CHECK/],
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
  "execucao_simulada",
  "tarefa_usuario",
  "tarefa",
  "usuario_simulado_anexo",
  "usuario_simulado",
  "uso_modelo_execucao",
  "retrabalho_demanda",
  "arquivo_commit_demanda",
  "commit_ticket_demanda",
  "arquivo_evidencia",
  "evidencia_demanda",
  "iteracao_demanda",
  "proposta_demanda",
  "decisao_ticket",
  "execucao_sessao",
  "sessao",
  "dependencia_demanda",
  "ticket_demanda",
  "varredura_base",
  "demanda",
  "projeto",
];
const contagens = (banco: DatabaseSync) =>
  TABELAS.map((t) => Number(banco.prepare(`SELECT count(*) AS n FROM ${t}`).get()?.n));
const custo = (banco: DatabaseSync) =>
  Number(banco.prepare("SELECT total(custo) AS c FROM uso_modelo_execucao").get()?.c);

const SHA_COMPARTILHADO = "c".repeat(64);
let contador = 0;

/** Os IDs das execuções simuladas das Tarefas do projeto. */
const simuladas = (banco: DatabaseSync, nome: string): number[] =>
  banco
    .prepare("SELECT e.id FROM execucao_simulada e JOIN tarefa t ON t.id = e.tarefa WHERE t.projeto = ?")
    .all(nome)
    .map((l) => Number(l.id));

/** A execução da sessão da demanda `n`: a da primeira veio do fluxo legado (`E-<n>`), as outras são novas. */
const execucaoDe = (n: number, primeira: boolean) => (primeira ? `E-${String(n)}` : `x${String(n)}`);
/** A pasta da execução: a copiada do fluxo legado já se chama `E-<n>`; as novas, `E-<id>`. */
const pastaDe = (raiz: string, execucao: string) =>
  join(raiz, "execucoes", execucao.startsWith("E-") ? execucao : `E-${execucao}`);
const sessaoNoDisco = (raiz: string, n: number) => join(raiz, "sessoes", `2026-01-01T00-00-00Z_s${String(n)}.jsonl`);

/**
 * Um projeto com 4 demandas, cada uma com um ticket concluído e linhas nas tabelas dela, a execução e a sessão no
 * disco. O anexo da primeira tem o hash compartilhado entre projetos; o das outras, o `shaProprio`.
 */
function popular(banco: DatabaseSync, nome: string, shaProprio: string): [number, number, number, number] {
  const raiz = raizDo(banco);
  registrarProjeto(banco, { ...exemplo, nome, repo: `/repos/${nome}` });
  banco.prepare("INSERT INTO varredura_base (projeto, ultimo_sha, em) VALUES (?, ?, ?)").run(nome, "a".repeat(40), "t");
  const demandas = [0, 1, 2, 3].map((i) => {
    const id = ++contador;
    const n = String(id);
    const d = `I-${n}`;
    const execucao = execucaoDe(id, i === 0);
    banco.exec(`
      INSERT INTO demanda VALUES ('${d}', '${nome}', 't', 'funcionalidade', 'd', 'execucao', 't', 'x', 's', 1, 'b');
      INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, status, status_alterado_em)
        VALUES ('${d}', 1, 'implementar', 'concluido', 't');
      INSERT INTO sessao VALUES ('${d}s', '${d}', 1, 'autonomo', 's${n}');
      INSERT INTO execucao_sessao (id, sessao_id, inicio, fim, falha) VALUES ('${execucao}', '${d}s', 't', 't', 0);
      INSERT INTO uso_modelo_execucao VALUES ('${execucao}', 'p', 'm', 1, 1, 0, 0, ${n}.5);
      INSERT INTO evidencia_demanda VALUES ('${d}e', '${d}', NULL, 1, 'comportamento', '{}', 't');
      INSERT INTO arquivo_evidencia VALUES ('${d}e', 1, 'a.txt', '${i === 0 ? SHA_COMPARTILHADO : shaProprio}', 'text/plain', 1);
      INSERT INTO iteracao_demanda (demanda_id, ticket_id, tipo, em) VALUES ('${d}', 1, 'mensagem', 't');
      INSERT INTO proposta_demanda (demanda_id, ticket_id, titulo, mensagem, arquivos, status, em)
        VALUES ('${d}', 1, 't', 'm', 31, 'pendente', 't');
      INSERT INTO proposta_demanda (demanda_id, ticket_id, titulo, mensagem, arquivos, status, demanda_criada_id, em, decidida_em)
        VALUES ('${d}', 1, 't', 'm', 31, 'aceita', '${d}', 't', 't');
      INSERT INTO decisao_ticket VALUES ('${d}', 1, 1, 'aprovado', NULL, NULL, 'auditor', 't');
      INSERT INTO commit_ticket_demanda VALUES ('${n.padStart(40, "b")}', '${d}', 1, 'm', 't');
      INSERT INTO arquivo_commit_demanda (sha, caminho, status) VALUES ('${n.padStart(40, "b")}', 'f', 'A');
      INSERT INTO retrabalho_demanda VALUES ('${n.padStart(40, "d")}', '${d}', NULL, 'x', 1, 1, NULL);
    `);
    mkdirSync(pastaDe(raiz, execucao), { recursive: true });
    writeFileSync(join(pastaDe(raiz, execucao), "log"), "x");
    mkdirSync(join(raiz, "sessoes"), { recursive: true });
    writeFileSync(sessaoNoDisco(raiz, id), "x");
    return id;
  }) as [number, number, number, number];
  banco.exec(`
    INSERT INTO usuario_simulado (projeto, nome, descricao) VALUES ('${nome}', 'Dona Maria', 'd');
    INSERT INTO usuario_simulado_anexo SELECT id, 'manual.pdf', '${shaProprio}', 1 FROM usuario_simulado WHERE projeto = '${nome}';
    INSERT INTO tarefa (projeto, texto, n, criada_em) VALUES ('${nome}', 't', 1, 't');
    INSERT INTO tarefa_usuario SELECT t.id, u.id FROM tarefa t, usuario_simulado u WHERE t.projeto = '${nome}' AND u.projeto = '${nome}';
    INSERT INTO execucao_simulada (tarefa, usuario, status, erro)
      SELECT t.id, u.id, 'falhou', 'x' FROM tarefa t, usuario_simulado u WHERE t.projeto = '${nome}' AND u.projeto = '${nome}';
  `);
  for (const id of simuladas(banco, nome)) {
    mkdirSync(dirDaExecucaoSimulada(raiz, id), { recursive: true });
    writeFileSync(join(dirDaExecucaoSimulada(raiz, id), "log"), "x");
  }
  for (const sha of [SHA_COMPARTILHADO, shaProprio]) {
    mkdirSync(join(caminhoArquivo(banco, sha), ".."), { recursive: true });
    writeFileSync(caminhoArquivo(banco, sha), "x");
  }
  return demandas;
}

test("removerProjeto apaga o projeto e tudo dele, no banco e no disco, e deixa o outro intacto", async () => {
  const banco = novoBanco();
  const raiz = raizDo(banco);
  const outro = popular(banco, "outro", "e".repeat(64));
  const antes = contagens(banco);
  const custoAntes = custo(banco);
  const demo = popular(banco, "demo", "f".repeat(64));
  const simuladasDemo = simuladas(banco, "demo");
  const simuladasOutro = simuladas(banco, "outro");
  assert.equal(simuladasDemo.length + simuladasOutro.length, 2);
  // A demanda do outro projeto que depende de uma do removido perde a dependência.
  banco.prepare("INSERT INTO dependencia_demanda VALUES (?, ?)").run(`I-${String(outro[0])}`, `I-${String(demo[0])}`);

  const { projeto: removido, avisos } = await removerProjeto(banco, "demo");

  assert.equal(removido.nome, "demo");
  assert.equal(removido.repo, "/repos/demo");
  assert.deepEqual(avisos, []);
  assert.deepEqual(contagens(banco), antes);
  assert.equal(custo(banco), custoAntes);
  assert.equal(projeto(banco, "demo"), undefined);
  assert.equal(projeto(banco, "outro")?.nome, "outro");
  for (const [i, n] of demo.entries()) {
    assert.equal(existsSync(pastaDe(raiz, execucaoDe(n, i === 0))), false);
    assert.equal(existsSync(sessaoNoDisco(raiz, n)), false);
  }
  for (const id of simuladasDemo) assert.equal(existsSync(dirDaExecucaoSimulada(raiz, id)), false);
  for (const id of simuladasOutro) assert.equal(existsSync(dirDaExecucaoSimulada(raiz, id)), true);
  assert.equal(existsSync(caminhoArquivo(banco, "f".repeat(64))), false);
  assert.equal(existsSync(caminhoArquivo(banco, SHA_COMPARTILHADO)), true);
  assert.equal(existsSync(caminhoArquivo(banco, "e".repeat(64))), true);
  for (const [i, n] of outro.entries()) {
    assert.equal(existsSync(pastaDe(raiz, execucaoDe(n, i === 0))), true);
    assert.equal(existsSync(sessaoNoDisco(raiz, n)), true);
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

  banco.prepare("UPDATE execucao_sessao SET fim = NULL WHERE id = ?").run(execucaoDe(primeira, true));
  await recusaAsync(
    () => removerProjeto(banco, "demo"),
    ErroDeRegra,
    `o projeto demo tem execução em andamento no I-${String(primeira)}.T1 (espere ela terminar ou pare a sessão, e remova de novo)`,
  );
  assert.deepEqual(contagens(banco), antes);
  assert.equal(existsSync(pastaDe(raizDo(banco), execucaoDe(primeira, true))), true);

  banco.prepare("UPDATE execucao_sessao SET fim = 't' WHERE id = ?").run(execucaoDe(primeira, true));
  banco.prepare("UPDATE ticket_demanda SET status = 'em_execucao' WHERE demanda_id = ?").run(`I-${String(segunda)}`);
  await recusaAsync(
    () => removerProjeto(banco, "demo"),
    ErroDeRegra,
    `o projeto demo tem execução em andamento no I-${String(segunda)}.T1 (espere ela terminar ou pare a sessão, e remova de novo)`,
  );
  assert.deepEqual(contagens(banco), antes);
  banco.close();
});

test("removerProjeto recusa execução simulada na fila ou em andamento, sem apagar nada", async () => {
  const banco = novoBanco();
  popular(banco, "demo", "f".repeat(64));
  const antes = contagens(banco);
  const [id] = simuladas(banco, "demo");
  for (const status of ["na_fila", "em_andamento"]) {
    banco.prepare("UPDATE execucao_simulada SET status = ?, erro = NULL").run(status);
    await assert.rejects(
      () => removerProjeto(banco, "demo"),
      (falha) =>
        falha instanceof ErroDeRegra &&
        /^o projeto demo tem execução simulada pendente na Tarefa \d+ \(espere ela terminar, e remova de novo\)$/.test(
          falha.message,
        ),
    );
    assert.deepEqual(contagens(banco), antes);
    assert.equal(existsSync(dirDaExecucaoSimulada(raizDo(banco), id ?? 0)), true);
  }
  banco.close();
});

test("removerProjeto sem demandas nem sessões no disco só apaga o projeto", async () => {
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
    for (const aviso of avisos) assert.match(aviso, /^não foi possível apagar .*E-[\w-]+: /);
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

const TABELAS_DEMANDA = [
  "avaliacao",
  "avaliacao_demanda",
  "achado_avaliacao",
  "uso_avaliacao",
  "retrabalho_demanda",
  "arquivo_commit_demanda",
  "commit_ticket_demanda",
  "uso_modelo_historico",
  "uso_modelo_execucao",
  "execucao_sessao",
  "sessao",
  "sessao_externa_demanda",
  "decisao_ticket_historico",
  "decisao_ticket",
  "arquivo_evidencia",
  "evidencia_historico",
  "evidencia_demanda",
  "limpeza_pendente_encerramento",
  "encerramento_demanda",
  "dependencia_ticket",
  "caminho_ticket",
  "ticket_demanda",
  "criterio_citado_rodada",
  "dependencia_rodada",
  "rodada",
  "dependencia_demanda",
  "demanda_historico",
  "demanda",
];
const contagensDemanda = (banco: DatabaseSync) =>
  TABELAS_DEMANDA.map((t) => Number(banco.prepare(`SELECT count(*) AS n FROM ${t}`).get()?.n));

/** Uma demanda com duas rodadas e dois tickets de implementação, com linha em toda tabela da demanda. */
function popularDemanda(banco: DatabaseSync, nome: string, d: string): void {
  registrarProjeto(banco, { ...exemplo, nome, repo: `/repos/${nome}` });
  const digitos = d.slice(2);
  const [sha1, sha2, sha3] = [digitos.padStart(40, "a"), digitos.padStart(40, "c"), digitos.padStart(64, "9")];
  banco.exec(`
    INSERT INTO demanda VALUES ('${d}', '${nome}', 't', 'funcionalidade', 'd', 'execucao', 't', 'x', 's', 0, 'b');
    INSERT INTO demanda VALUES ('${d}2', '${nome}', 't', 'funcionalidade', 'd', 'execucao', 't', 'x', 's', 0, 'b');
    INSERT INTO dependencia_demanda VALUES ('${d}2', '${d}');
    INSERT INTO demanda_historico (demanda_id, criada_em) VALUES ('${d}', 't');
    INSERT INTO rodada VALUES ('${d}', 1, 't', 'desenvolvimento', 0, 'b');
    INSERT INTO rodada VALUES ('${d}', 2, 't', 'desenvolvimento', 0, 'b');
    INSERT INTO dependencia_rodada VALUES ('${d}', 2, 1);
    INSERT INTO criterio_citado_rodada VALUES ('${d}', 1, 'CA-1');
    INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, status, status_alterado_em, rodada_id)
      VALUES ('${d}', 1, 'implementar', 'concluido', 't', 1), ('${d}', 2, 'implementar', 'concluido', 't', 1);
    INSERT INTO dependencia_ticket VALUES ('${d}', 2, 1, 1);
    INSERT INTO caminho_ticket VALUES ('${d}', 1, 'src');
    INSERT INTO decisao_ticket VALUES ('${d}', 1, 1, 'aprovado', NULL, NULL, 'auditor', 't');
    INSERT INTO decisao_ticket_historico VALUES ('${d}', 1, 1, 'registro');
    INSERT INTO evidencia_demanda VALUES ('${d}e', '${d}', NULL, 1, 'comportamento', '{}', 't');
    INSERT INTO evidencia_historico VALUES ('${d}e', 1, 'agente');
    INSERT INTO arquivo_evidencia VALUES ('${d}e', 1, 'a', '${sha3}', 'text/plain', 1);
    INSERT INTO encerramento_demanda (demanda_id, branch, base) VALUES ('${d}', 'b', 'main');
    INSERT INTO limpeza_pendente_encerramento VALUES ('${d}', 'x');
    INSERT INTO sessao VALUES ('${d}s', '${d}', 1, 'autonomo', 'c');
    INSERT INTO sessao_externa_demanda VALUES ('pi', '${d}x', '${d}');
    INSERT INTO execucao_sessao (id, sessao_id, inicio, fim, falha) VALUES ('${d}x1', '${d}s', 't', 't', 0);
    INSERT INTO uso_modelo_execucao VALUES ('${d}x1', 'p', 'm', 1, 1, 0, 0, NULL);
    INSERT INTO uso_modelo_historico VALUES ('${d}x1', 'p', 'm', 1);
    INSERT INTO commit_ticket_demanda VALUES ('${sha1}', '${d}', 1, 'm', 't'), ('${sha2}', '${d}', 2, 'm', 't');
    INSERT INTO arquivo_commit_demanda VALUES ('${sha1}', 'f', NULL, 'A', 1, 0);
    INSERT INTO retrabalho_demanda VALUES ('${sha2}', '${d}', 2, NULL, 1, 1, '${d}');
    INSERT INTO avaliacao VALUES ('${d}av', '${nome}', '2026-01-01', '2026-01-02', 'p', 't');
    INSERT INTO avaliacao_demanda VALUES ('${d}av', '${d}');
    INSERT INTO achado_avaliacao VALUES ('${d}av', 1, 't', 'd', 'e', '${d}');
    INSERT INTO uso_avaliacao VALUES ('${d}av', 'p', 'm', 1, 1, 1, 0, 0, NULL);
  `);
}

test("removerProjeto apaga as tabelas da demanda do projeto sem erro de chave estrangeira e deixa as do outro", async () => {
  const banco = novoBanco();
  popularDemanda(banco, "outro", "I-9001");
  const antes = contagensDemanda(banco);
  popularDemanda(banco, "demo", "I-9101");
  // demanda do outro projeto que depende da do projeto removido, e retrabalho dela sobre o ticket do removido
  banco.exec(`
    INSERT INTO dependencia_demanda VALUES ('I-9001', 'I-9101');
    INSERT INTO avaliacao_demanda VALUES ('I-9001av', 'I-9101');
  `);
  await removerProjeto(banco, "demo");
  banco.exec("DELETE FROM dependencia_demanda WHERE depende_demanda_id = 'I-9101'"); // não existe mais: já tem de ter saído
  assert.deepEqual(contagensDemanda(banco), antes);
  assert.equal(existsSync(caminhoArquivo(banco, "9101".padStart(64, "9"))), false);
  banco.close();
});
