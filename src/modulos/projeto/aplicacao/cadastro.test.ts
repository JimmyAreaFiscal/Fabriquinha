import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { ZodError } from "zod";
import type { DatabaseSync } from "node:sqlite";
import { fabricaDeBancosTemporarios } from "../../../../apoio-testes/banco_temporario.ts";
import { instalarPiFalso, type PassoPi } from "../../../../apoio-testes/pi_falso.ts";
import { ErroDeInexistente, ErroDeRegra, ErroExterno } from "../../compartilhado/nucleo/erros.ts";
import { caminhoArquivo } from "../../compartilhado/armazenamento/arquivos.ts";
import { raizDo } from "../../compartilhado/armazenamento/banco.ts";
import { dirDaExecucaoSimulada } from "../../compartilhado/infra/registro.ts";
import { Projeto } from "../nucleo/projeto.ts";
import { cursorDaBase } from "../../repositorio/armazenamento/commits_humanos.ts";
import { buscarProjeto, listarProjetos } from "../armazenamento/projetos.ts";
import {
  cadastrarProjetoDoFormulario,
  editarProjeto,
  editarProjetoDoFormulario,
  gravarConfiguracaoSdlc,
  registrarProjeto,
  removerProjeto,
} from "./cadastro.ts";
import { HarnessPi } from "../../harness/pi/harness_pi.ts";
import type { Modelo } from "../../compartilhado/nucleo/primitivos.ts";

/** O pi falso do teste responde a conferência, como o harness do serviço. */
const conferirModeloNoPi = (modelo: Modelo): Promise<void> => new HarnessPi().conferirModelo(modelo);

const abrirBancoTemporario = fabricaDeBancosTemporarios();
const novoBanco = () => abrirBancoTemporario().banco;

const exemplo = Projeto.parse({
  nome: "fabriquinha",
  raiz_git: "/repos/fabriquinha",
  branch_base: "main",
  hospedagem: "github",
  verificacoes: { preparacao: ["npm ci"] },
  chave_sonarqube: "Fabriquinha",
});
const lido = exemplo;

test("registrarProjeto cadastra e buscarProjeto/listarProjetos leem de volta igual, em ordem de nome", () => {
  const banco = novoBanco();
  assert.equal(buscarProjeto(banco, "fabriquinha"), undefined);
  assert.deepEqual(listarProjetos(banco), []);

  const minimo = { ...exemplo, nome: "abc", raiz_git: "/repos/abc", verificacoes: undefined };
  assert.deepEqual(registrarProjeto(banco, exemplo), exemplo);
  registrarProjeto(banco, minimo);

  assert.deepEqual(buscarProjeto(banco, "fabriquinha"), lido);
  assert.deepEqual(
    listarProjetos(banco).map((projeto) => [projeto.nome, projeto.verificacoes.preparacao]),
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

test("a edição não toca a chave do SonarQube, que é da configuração SDLC", () => {
  const banco = novoBanco();
  registrarProjeto(banco, exemplo);
  const chave = () =>
    banco.prepare("SELECT chave_sonarqube FROM projeto WHERE nome = 'fabriquinha'").get()?.chave_sonarqube;
  assert.equal(chave(), "Fabriquinha");
  banco.prepare("UPDATE projeto SET chave_sonarqube = 'da-sdlc' WHERE nome = 'fabriquinha'").run();
  const editado = editarProjeto(banco, { ...exemplo, chave_sonarqube: "outra", branch_base: "develop" });
  assert.equal(chave(), "da-sdlc");
  assert.equal(buscarProjeto(banco, "fabriquinha")?.branch_base, "develop");
  assert.equal(editado.chave_sonarqube, "da-sdlc");
  assert.deepEqual(editado, buscarProjeto(banco, "fabriquinha"));
  banco.close();
});

test("registrarProjeto recusa nome que já existe, sem mexer no projeto", () => {
  const banco = novoBanco();
  registrarProjeto(banco, exemplo);
  recusa(
    () => registrarProjeto(banco, { ...exemplo, raiz_git: "/repos/outro", branch_base: "develop" }),
    "já existe o projeto fabriquinha (edite-o na Configuração)",
  );
  assert.deepEqual(listarProjetos(banco), [lido]);
  banco.close();
});

test("editarProjeto substitui o cadastro, inclusive sem mudança", () => {
  const banco = novoBanco();
  registrarProjeto(banco, exemplo);
  assert.deepEqual(editarProjeto(banco, exemplo), exemplo);
  const editado = {
    ...exemplo,
    raiz_git: "/repos/outro-lugar",
    branch_base: "develop",
    hospedagem: "azure-devops" as const,
    etapas: [{ etapa: "implementar" as const }],
    verificacoes: { ...exemplo.verificacoes, preparacao: [] },
  };
  assert.deepEqual(editarProjeto(banco, editado), editado);
  assert.deepEqual(listarProjetos(banco), [editado]);
  banco.close();
});

test("gravarConfiguracaoSdlc grava as verificações e preserva etapas e preparação do cadastro", () => {
  const banco = novoBanco();
  const cadastrado = registrarProjeto(banco, {
    ...exemplo,
    etapas: [{ etapa: "implementar", configuracao_agente: { effort: "high" } }],
  });
  const configurado = Projeto.parse({
    ...exemplo,
    raiz_git: "/repos/configurado",
    branch_base: "develop",
    hospedagem: "azure-devops",
    chave_sonarqube: "configurado",
    etapas: [{ etapa: "planejar" }],
    verificacoes: {
      preparacao: ["ignorado"],
      fitness: [{ nome: "fitness", comando: "npm run fitness", descricao: "Arquitetura" }],
      linguagens: [{ caminho: ".", linguagem: "typescript", comando_teste: "npm test" }],
      e2e: [
        { caminho_linguagem: ".", comando_build: "npm run build", comando_execucao: "npm run e2e", codigo_falha: 1 },
      ],
      globs: [{ caminho_linguagem: ".", glob: "src/**/*.ts" }],
    },
  });
  const esperado = {
    ...configurado,
    etapas: cadastrado.etapas,
    verificacoes: { ...configurado.verificacoes, preparacao: cadastrado.verificacoes.preparacao },
  };
  assert.deepEqual(gravarConfiguracaoSdlc(banco, configurado), esperado);
  assert.deepEqual(buscarProjeto(banco, exemplo.nome), esperado);

  const editado = editarProjeto(banco, {
    ...exemplo,
    etapas: [{ etapa: "revisar_rodada" }],
    verificacoes: { preparacao: ["npm install"] },
  });
  const cadastroEditado = {
    ...exemplo,
    chave_sonarqube: configurado.chave_sonarqube,
    etapas: [{ etapa: "revisar_rodada" }],
    verificacoes: { ...configurado.verificacoes, preparacao: ["npm install"] },
  };
  assert.deepEqual(editado, cadastroEditado);
  assert.deepEqual(buscarProjeto(banco, exemplo.nome), cadastroEditado);
  banco.close();
});

test("gravarConfiguracaoSdlc recusa projeto inexistente com orientação para cadastrar antes", () => {
  const banco = novoBanco();
  assert.throws(
    () => gravarConfiguracaoSdlc(banco, exemplo),
    (erro) =>
      erro instanceof ErroDeInexistente &&
      erro.message === "o projeto fabriquinha não existe (cadastre o projeto antes)",
  );
  assert.deepEqual(listarProjetos(banco), []);
  banco.close();
});

test("a preparação do cadastro é gravada em comando_preparacao_projeto, a tabela que o fluxo da demanda lê", () => {
  const banco = novoBanco();
  const preparacaoGravada = () =>
    banco
      .prepare("SELECT ordem, comando FROM comando_preparacao_projeto WHERE projeto = 'fabriquinha' ORDER BY ordem")
      .all()
      .map((l) => ({ ...l }));
  registrarProjeto(banco, exemplo);
  assert.deepEqual(preparacaoGravada(), [{ ordem: 1, comando: "npm ci" }]);
  editarProjeto(banco, {
    ...exemplo,
    verificacoes: { ...exemplo.verificacoes, preparacao: ["uv venv .venv", "uv sync"] },
  });
  assert.deepEqual(preparacaoGravada(), [
    { ordem: 1, comando: "uv venv .venv" },
    { ordem: 2, comando: "uv sync" },
  ]);
  assert.deepEqual(buscarProjeto(banco, "fabriquinha")?.verificacoes.preparacao, ["uv venv .venv", "uv sync"]);
  // A recusa reverte a transação inteira: a preparação fica a de antes.
  recusa(
    () =>
      registrarProjeto(banco, {
        ...exemplo,
        raiz_git: "/repos/outro",
        verificacoes: { ...exemplo.verificacoes, preparacao: ["rm -rf"] },
      }),
    "já existe o projeto fabriquinha (edite-o na Configuração)",
  );
  assert.deepEqual(buscarProjeto(banco, "fabriquinha")?.verificacoes.preparacao, ["uv venv .venv", "uv sync"]);
  banco.close();
});

test("editarProjeto recusa projeto que não existe, sem criá-lo", () => {
  const banco = novoBanco();
  recusa(() => editarProjeto(banco, exemplo), "o projeto fabriquinha não existe (cadastre-o na Configuração)");
  assert.deepEqual(listarProjetos(banco), []);
  banco.close();
});

test("registrar e editar recusam o schema do F1 sem gravar nada", () => {
  const banco = novoBanco();
  assert.throws(() => registrarProjeto(banco, { ...exemplo, raiz_git: "relativo" }), ZodError);
  registrarProjeto(banco, exemplo);
  assert.throws(() => editarProjeto(banco, { ...exemplo, raiz_git: "relativo" }), ZodError);
  assert.deepEqual(listarProjetos(banco), [lido]);
  banco.close();
});

test("registrar e editar recusam um repositório que já é de outro projeto", () => {
  const banco = novoBanco();
  registrarProjeto(banco, exemplo);
  registrarProjeto(banco, { ...exemplo, nome: "outro", raiz_git: "/repos/outro" });
  const mensagem =
    "o repositório /repos/fabriquinha já é do projeto fabriquinha (edite o projeto fabriquinha em vez de cadastrar outro para o mesmo repositório)";
  recusa(() => registrarProjeto(banco, { ...exemplo, nome: "copia" }), mensagem);
  recusa(() => editarProjeto(banco, { ...exemplo, nome: "outro" }), mensagem);
  assert.deepEqual(
    listarProjetos(banco).map((projeto) => [projeto.nome, projeto.raiz_git]),
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
      raiz_git: "'/r'",
      branch_base: "'main'",
      hospedagem: "'github'",
      chave_sonarqube: "'k'",
      ...troca,
    };
    banco.exec(`INSERT INTO projeto (${Object.keys(linha).join(",")}) VALUES (${Object.values(linha).join(",")})`);
  };
  const violacoes: [Record<string, string>, RegExp][] = [
    [{ nome: "''" }, /CHECK/],
    [{ nome: `'${"a".repeat(65)}'` }, /CHECK/],
    [{ hospedagem: "'gitlab'" }, /CHECK/],
    [{ branch_base: "NULL" }, /NOT NULL/],
    [{ chave_sonarqube: "NULL" }, /NOT NULL/],
  ];
  for (const [troca, erro] of violacoes) {
    assert.throws(() => {
      inserir(troca);
    }, erro);
  }
  inserir({});
  assert.throws(() => {
    inserir({ nome: "'q'" });
  }, /UNIQUE constraint failed: projeto.raiz_git/);
  assert.throws(() => {
    inserir({ raiz_git: "'/s'" });
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
  "commit_humano_posterior",
  "arquivo_commit_demanda",
  "commit_ticket_demanda",
  "arquivo_evidencia",
  "evidencia_demanda",
  "iteracao_demanda",
  "proposta_demanda",
  "decisao_ticket",
  "processo_do_trabalho",
  "trabalho_agentico",
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
  registrarProjeto(banco, { ...exemplo, nome, raiz_git: `/repos/${nome}` });
  banco.prepare("INSERT INTO varredura_base (projeto, ultimo_sha, em) VALUES (?, ?, ?)").run(nome, "a".repeat(40), "t");
  const demandas = [0, 1, 2, 3].map((i) => {
    const id = ++contador;
    const n = String(id);
    const d = `I-${n}`;
    const execucao = execucaoDe(id, i === 0);
    banco.exec(`
      INSERT INTO demanda VALUES ('${d}', '${nome}', 't', 'funcionalidade', 'd', 'em_execucao', 't', 'x', 's', 1, 'b');
      INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, estado, estado_alterado_em)
        VALUES ('${d}', 1, 'implementar', 'concluido', 't');
      INSERT INTO trabalho_agentico VALUES ('${d}s', '${d}', 1, 'autonomo', 's${n}');
      INSERT INTO processo_do_trabalho (id, trabalho_id, inicio, fim, falha) VALUES ('${execucao}', '${d}s', 't', 't', 0);
      INSERT INTO uso_modelo_execucao VALUES ('${execucao}', 'p', 'm', 1, 1, 0, 0, ${n}.5);
      INSERT INTO evidencia_demanda (id, demanda_id, rodada_id, ticket_id, tipo, dados, em) VALUES ('${d}e', '${d}', NULL, 1, 'comportamento', '{}', 't');
      INSERT INTO arquivo_evidencia VALUES ('${d}e', 1, 'a.txt', '${i === 0 ? SHA_COMPARTILHADO : shaProprio}', 'text/plain', 1);
      INSERT INTO iteracao_demanda (demanda_id, ticket_id, tipo, em) VALUES ('${d}', 1, 'mensagem', 't');
      INSERT INTO proposta_demanda (demanda_id, ticket_id, titulo, mensagem, arquivos, status, em)
        VALUES ('${d}', 1, 't', 'm', 31, 'pendente', 't');
      INSERT INTO proposta_demanda (demanda_id, ticket_id, titulo, mensagem, arquivos, status, demanda_criada_id, em, decidida_em)
        VALUES ('${d}', 1, 't', 'm', 31, 'aceita', '${d}', 't', 't');
      INSERT INTO decisao_ticket (demanda_id, ticket_id, decisao_id, gate, resultado, nota, motivo, por_tipo, em) VALUES ('${d}', 1, 1, 'gate_demanda', 'aprovado', NULL, NULL, 'auditor', 't');
      INSERT INTO commit_ticket_demanda VALUES ('${n.padStart(40, "b")}', '${d}', 1, 'm', 't');
      INSERT INTO arquivo_commit_demanda (sha, caminho, status) VALUES ('${n.padStart(40, "b")}', 'f', 'A');
      INSERT INTO commit_humano_posterior VALUES ('${n.padStart(40, "d")}', '${d}', NULL, 'x', 1, 1, NULL);
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
  assert.equal(removido.raiz_git, "/repos/demo");
  assert.deepEqual(semAvisoDoGit(avisos), []);
  assert.deepEqual(contagens(banco), antes);
  assert.equal(custo(banco), custoAntes);
  assert.equal(buscarProjeto(banco, "demo"), undefined);
  assert.equal(buscarProjeto(banco, "outro")?.nome, "outro");
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
  registrarProjeto(banco, { ...exemplo, nome: "outro", raiz_git: "/repos/outro" });
  banco.exec(`
    INSERT INTO usuario_simulado (projeto, nome, descricao) VALUES ('outro', 'Seu João', 'd');
    INSERT INTO usuario_simulado_anexo SELECT id, 'igual.pdf', '${"f".repeat(64)}', 1 FROM usuario_simulado WHERE projeto = 'outro';
  `);
  await removerProjeto(banco, "demo");
  assert.equal(existsSync(caminhoArquivo(banco, "f".repeat(64))), true);
  banco.close();
});

// O repositório do exemplo não existe no disco, então o `git worktree prune` das worktrees sempre avisa.
const semAvisoDoGit = (avisos: string[]) => avisos.filter((aviso) => !aviso.startsWith("git -C "));

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

  banco.prepare("UPDATE processo_do_trabalho SET fim = NULL WHERE id = ?").run(execucaoDe(primeira, true));
  await recusaAsync(
    () => removerProjeto(banco, "demo"),
    ErroDeRegra,
    `o projeto demo tem execução em andamento no I-${String(primeira)}.T1 (espere ela terminar ou pare a sessão, e remova de novo)`,
  );
  assert.deepEqual(contagens(banco), antes);
  assert.equal(existsSync(pastaDe(raizDo(banco), execucaoDe(primeira, true))), true);

  banco.prepare("UPDATE processo_do_trabalho SET fim = 't' WHERE id = ?").run(execucaoDe(primeira, true));
  banco.prepare("UPDATE ticket_demanda SET estado = 'em_execucao' WHERE demanda_id = ?").run(`I-${String(segunda)}`);
  await recusaAsync(
    () => removerProjeto(banco, "demo"),
    ErroDeRegra,
    `o projeto demo tem execução em andamento no I-${String(segunda)}.T1 (espere ela terminar ou pare a sessão, e remova de novo)`,
  );
  assert.deepEqual(contagens(banco), antes);
  banco.close();
});

test("removerProjeto apaga o projeto com execução simulada histórica que ficou na fila: a Simulação saiu (ticket 02)", async () => {
  const banco = novoBanco();
  popular(banco, "demo", "f".repeat(64));
  const [id] = simuladas(banco, "demo");
  banco.prepare("UPDATE execucao_simulada SET status = 'na_fila', erro = NULL").run();

  await removerProjeto(banco, "demo");

  assert.equal(buscarProjeto(banco, "demo"), undefined);
  assert.deepEqual(simuladas(banco, "demo"), []);
  assert.equal(existsSync(dirDaExecucaoSimulada(raizDo(banco), id ?? 0)), false);
  banco.close();
});

test("removerProjeto sem demandas nem sessões no disco só apaga o projeto", async () => {
  const banco = novoBanco();
  registrarProjeto(banco, exemplo);
  const { avisos } = await removerProjeto(banco, "fabriquinha");
  assert.deepEqual(semAvisoDoGit(avisos), []);
  assert.deepEqual(listarProjetos(banco), []);
  banco.close();
});

test("removerProjeto apaga as worktrees do projeto e avisa quando o prune do repositório falha", async () => {
  const banco = novoBanco();
  registrarProjeto(banco, exemplo);
  const pasta = join(raizDo(banco), "worktrees", "fabriquinha", "I-1");
  mkdirSync(pasta, { recursive: true });
  const { avisos } = await removerProjeto(banco, "fabriquinha");
  assert.equal(existsSync(join(raizDo(banco), "worktrees", "fabriquinha")), false);
  assert.equal(avisos.length, 1);
  assert.match(avisos[0] ?? "", /^git -C \/repos\/fabriquinha worktree prune falhou/);
  banco.close();
});

test("removerProjeto: falha ao apagar no disco vira aviso e não desfaz o banco", async () => {
  const banco = novoBanco();
  const raiz = raizDo(banco);
  popular(banco, "demo", "f".repeat(64));
  chmodSync(join(raiz, "execucoes"), 0o500); // sem escrita: não dá para apagar E-n dentro dela
  try {
    const { avisos } = await removerProjeto(banco, "demo");
    assert.equal(semAvisoDoGit(avisos).length, 4);
    for (const aviso of semAvisoDoGit(avisos)) assert.match(aviso, /^não foi possível apagar .*E-[\w-]+: /);
  } finally {
    chmodSync(join(raiz, "execucoes"), 0o700);
  }
  assert.equal(buscarProjeto(banco, "demo"), undefined);
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
  "commit_humano_posterior",
  "arquivo_commit_demanda",
  "commit_ticket_demanda",
  "uso_modelo_historico",
  "uso_modelo_execucao",
  "processo_do_trabalho",
  "trabalho_agentico",
  "trabalho_nao_gerenciado",
  "uso_declarado",
  "decisao_ticket",
  "arquivo_evidencia",
  "evidencia_historico",
  "evidencia_demanda",
  "limpeza_pendente_encerramento",
  "encerramento_demanda",
  "dependencia_ticket",
  "caminho_ticket",
  "arquivo_previsto_rodada",
  "arquivo_previsto_demanda",
  "versao_plano",
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
  registrarProjeto(banco, { ...exemplo, nome, raiz_git: `/repos/${nome}` });
  const digitos = d.slice(2);
  const [sha1, sha2, sha3] = [digitos.padStart(40, "a"), digitos.padStart(40, "c"), digitos.padStart(64, "9")];
  banco.exec(`
    INSERT INTO demanda VALUES ('${d}', '${nome}', 't', 'funcionalidade', 'd', 'em_execucao', 't', 'x', 's', 0, 'b');
    INSERT INTO demanda VALUES ('${d}2', '${nome}', 't', 'funcionalidade', 'd', 'em_execucao', 't', 'x', 's', 0, 'b');
    INSERT INTO dependencia_demanda VALUES ('${d}2', '${d}');
    INSERT INTO demanda_historico (demanda_id, criada_em) VALUES ('${d}', 't');
    INSERT INTO rodada VALUES ('${d}', 1, 't', 'implementar', '2026-01-01T00:00:00.000Z', 0, 'b');
    INSERT INTO rodada VALUES ('${d}', 2, 't', 'implementar', '2026-01-01T00:00:00.000Z', 0, 'b');
    INSERT INTO dependencia_rodada VALUES ('${d}', 2, 1);
    INSERT INTO criterio_citado_rodada VALUES ('${d}', 1, 'CA-1');
    INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, estado, estado_alterado_em, rodada_id)
      VALUES ('${d}', 1, 'implementar', 'concluido', 't', 1), ('${d}', 2, 'implementar', 'concluido', 't', 1);
    INSERT INTO dependencia_ticket VALUES ('${d}', 2, 1, 1);
    INSERT INTO caminho_ticket VALUES ('${d}', 1, 'src');
    INSERT INTO arquivo_previsto_rodada VALUES ('${d}', 1, 'src');
    INSERT INTO arquivo_previsto_demanda VALUES ('${d}', 'src');
    INSERT INTO versao_plano (demanda_id, numero, origem, autor_tipo, rodada_id, criada_em, dados)
      VALUES ('${d}', 1, 'aprovacao_do_planejamento', 'fabriquinha', NULL, 't', '{}');
    INSERT INTO decisao_ticket (demanda_id, ticket_id, decisao_id, gate, resultado, nota, motivo, por_tipo, em) VALUES ('${d}', 1, 1, 'gate_demanda', 'aprovado', NULL, NULL, 'auditor', 't');
    INSERT INTO evidencia_demanda (id, demanda_id, rodada_id, ticket_id, tipo, dados, em) VALUES ('${d}e', '${d}', NULL, 1, 'comportamento', '{}', 't');
    INSERT INTO evidencia_historico VALUES ('${d}e', 1, 'agente');
    INSERT INTO arquivo_evidencia VALUES ('${d}e', 1, 'a', '${sha3}', 'text/plain', 1);
    INSERT INTO encerramento_demanda (demanda_id, branch, base) VALUES ('${d}', 'b', 'main');
    INSERT INTO limpeza_pendente_encerramento VALUES ('${d}', 'x');
    INSERT INTO trabalho_agentico VALUES ('${d}s', '${d}', 1, 'autonomo', 'c');
    INSERT INTO uso_declarado VALUES ('pi', '${d}x', '${d}', '[]');
    INSERT INTO trabalho_nao_gerenciado VALUES ('pi', '${d}x', '${d}');
    INSERT INTO processo_do_trabalho (id, trabalho_id, inicio, fim, falha) VALUES ('${d}x1', '${d}s', 't', 't', 0);
    INSERT INTO uso_modelo_execucao VALUES ('${d}x1', 'p', 'm', 1, 1, 0, 0, NULL);
    INSERT INTO uso_modelo_historico VALUES ('${d}x1', 'p', 'm', 1);
    INSERT INTO commit_ticket_demanda VALUES ('${sha1}', '${d}', 1, 'm', 't'), ('${sha2}', '${d}', 2, 'm', 't');
    INSERT INTO arquivo_commit_demanda VALUES ('${sha1}', 'f', NULL, 'A', 1, 0);
    INSERT INTO commit_humano_posterior VALUES ('${sha2}', '${d}', 2, NULL, 1, 1, '${d}');
    INSERT INTO avaliacao (id, projeto, de, ate, pedido, criada_em) VALUES ('${d}av', '${nome}', '2026-01-01', '2026-01-02', 'p', 't');
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
  // demanda do outro projeto que depende da do projeto removido, e a linha de commit posterior dela sobre o ticket do removido
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

// Cadastro e edição pelo formulário: um clone com remoto de cara GitHub (o acesso desviado para um bare no disco), gh e
// pi falsos. realpath: a conferência do F5 compara o caminho do repositório literalmente, e o tmpdir pode ser um symlink.
const base = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-cadastro-")));
after(() => {
  rmSync(base, { recursive: true, force: true });
});
const gitconfig = join(base, "gitconfig");
writeFileSync(gitconfig, "[user]\n\tname = Auditor\n\temail = auditor@exemplo.com\n");
process.env.GIT_CONFIG_GLOBAL = gitconfig;
process.env.GIT_CONFIG_NOSYSTEM = "1";
const bin = join(base, "bin");
mkdirSync(bin);
writeFileSync(join(bin, "gh"), "#!/bin/sh\nexit 0\n");
chmodSync(join(bin, "gh"), 0o755);
process.env.PATH = `${bin}:${process.env.PATH ?? ""}`;
const piFalso = instalarPiFalso(base);
const modelosDoPi: PassoPi = {
  listaDeModelos: {
    tabela:
      "provider   model              context  max-out  thinking  images\n" +
      "anthropic  claude-opus-5-5    200K     64K      yes       yes\n" +
      "llamacpp   qwen3-coder-30b    32.8K    8.2K     yes       no\n",
  },
};
const opus = { provedor: "anthropic", nome: "claude-opus-5-5" };
const qwen = { provedor: "llamacpp", nome: "qwen3-coder-30b" };

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" }).toString().trim();

/** Clone com `origin` de cara GitHub e a branch `main` publicada num bare no disco. */
function clonePublicado(): string {
  const bare = mkdtempSync(join(base, "origin-"));
  git(bare, "init", "--bare", "-q");
  const repo = mkdtempSync(join(base, "repo-"));
  git(repo, "init", "-q", "-b", "main");
  git(repo, "commit", "-q", "--allow-empty", "-m", "início");
  git(repo, "push", "-q", bare, "HEAD:refs/heads/main");
  const url = "https://github.com/dono/repo.git";
  git(repo, "remote", "add", "origin", url);
  git(repo, "config", `url.${bare}.insteadOf`, url);
  return repo;
}

const formularioDeLoja = (repo: string) => ({
  nome: "loja",
  raiz_git: repo,
  branch_base: "main",
  preparacao: [],
  configuracoes: {},
});

const linhasDasEtapas = (banco: DatabaseSync) =>
  banco
    .prepare("SELECT etapa, modelo_provedor, modelo_nome, effort FROM configuracao_etapa_projeto ORDER BY etapa")
    .all()
    .map((linha) => ({ ...linha }));

test("cadastrarProjetoDoFormulario confere, deduz a hospedagem do remoto, grava as etapas escolhidas e fixa o cursor da base", async () => {
  piFalso.roteirizar([modelosDoPi]);
  const banco = novoBanco();
  const repo = clonePublicado();
  const configuracoes = {
    planejar: { modelo: opus, effort: "high" as const },
    implementar: { modelo: qwen },
    revisar_rodada: { effort: "low" as const },
    entender_e_desenhar: {},
  };
  const salvo = await cadastrarProjetoDoFormulario(
    banco,
    {
      ...formularioDeLoja(repo),
      hospedagem: "azure-devops",
      configuracoes,
    },
    conferirModeloNoPi,
  );
  assert.equal(salvo.hospedagem, "github");
  assert.equal(salvo.chave_sonarqube, "loja");
  assert.deepEqual(salvo.configuracoes, {
    planejar: configuracoes.planejar,
    implementar: configuracoes.implementar,
    revisar_rodada: configuracoes.revisar_rodada,
  });
  assert.deepEqual(
    linhasDasEtapas(banco).map((linha) => linha.etapa),
    ["implementar", "planejar", "revisar_rodada"],
    "a etapa sem modelo nem effort não deixa linha",
  );
  assert.equal(cursorDaBase(banco, "loja"), git(repo, "rev-parse", "HEAD"));
  await assert.rejects(
    cadastrarProjetoDoFormulario(banco, formularioDeLoja(repo), conferirModeloNoPi),
    /já existe o projeto loja/,
  );
  banco.close();
});

test("editarProjetoDoFormulario confere só o modelo novo ou trocado no pi e não varre a base", async () => {
  piFalso.roteirizar([modelosDoPi]);
  const banco = novoBanco();
  const repo = clonePublicado();
  await cadastrarProjetoDoFormulario(
    banco,
    {
      ...formularioDeLoja(repo),
      configuracoes: { planejar: { modelo: opus } },
    },
    conferirModeloNoPi,
  );
  const cursor = cursorDaBase(banco, "loja");
  git(repo, "commit", "-q", "--allow-empty", "-m", "outro");

  // O modelo que o pi não lista: erro no campo da etapa, e nada muda.
  await assert.rejects(
    editarProjetoDoFormulario(
      banco,
      {
        ...formularioDeLoja(repo),
        preparacao: ["npm ci"],
        configuracoes: {
          planejar: { modelo: opus },
          implementar: { modelo: { provedor: "inexistente", nome: "xyz" } },
        },
      },
      conferirModeloNoPi,
    ),
    (erro: unknown) =>
      erro instanceof ZodError &&
      erro.issues.length === 1 &&
      erro.issues[0]?.path.join(".") === "configuracoes.implementar.modelo" &&
      erro.issues[0].message.includes("o modelo inexistente/xyz não existe no pi"),
  );
  assert.deepEqual(buscarProjeto(banco, "loja")?.verificacoes.preparacao, []);
  assert.deepEqual(
    linhasDasEtapas(banco).map((linha) => linha.etapa),
    ["planejar"],
  );

  // Com o pi quebrado: o igual ao gravado salva sem chamá-lo; o trocado é rejeitado.
  piFalso.roteirizar([{ listaDeModelos: { codigo: 1 } }]);
  const editado = await editarProjetoDoFormulario(
    banco,
    {
      ...formularioDeLoja(repo),
      preparacao: ["npm ci"],
      configuracoes: { planejar: { modelo: opus, effort: "low" } },
    },
    conferirModeloNoPi,
  );
  assert.deepEqual(editado.verificacoes.preparacao, ["npm ci"]);
  assert.deepEqual(linhasDasEtapas(banco), [
    { etapa: "planejar", modelo_provedor: "anthropic", modelo_nome: "claude-opus-5-5", effort: "low" },
  ]);
  await assert.rejects(
    editarProjetoDoFormulario(
      banco,
      { ...formularioDeLoja(repo), configuracoes: { planejar: { modelo: qwen } } },
      conferirModeloNoPi,
    ),
    ZodError,
  );
  assert.equal(cursorDaBase(banco, "loja"), cursor, "a edição não varre a base");
  banco.close();
});

test("o cadastro pelo formulário recusa o repositório que a conferência reprova como ErroExterno, sem gravar", async () => {
  const banco = novoBanco();
  const pasta = mkdtempSync(join(base, "nao-git-"));
  await assert.rejects(
    cadastrarProjetoDoFormulario(banco, formularioDeLoja(pasta), conferirModeloNoPi),
    (erro: unknown) =>
      erro instanceof ErroExterno &&
      erro.message === `${pasta} não é um repositório git (informe o caminho da raiz de um clone do projeto)`,
  );
  assert.deepEqual(listarProjetos(banco), []);
  banco.close();
});
