// Rotas da Configuração (F7 §4.2) chamadas como o servidor as chama, contra um banco de verdade, um clone com
// remoto de cara GitHub (o acesso desviado para um bare no disco), gh e pi falsos. A guarda e a tradução dos erros
// em HTTP são do servidor (servidor.test.ts); aqui, o erro traduzido é o que o cliente receberia.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after, beforeEach, test } from "node:test";
import { abrir } from "../../persistencia/banco.ts";
import { projeto } from "../../persistencia/projetos.ts";
import { cursorDaBase } from "../../persistencia/retrabalho.ts";
import { casar } from "../cliente/caminhos.ts";
import { traduzir } from "../erros.ts";
import { ROTAS } from "../rotas.ts";

// realpath: a conferência do F5 compara o caminho do repositório literalmente, e o tmpdir pode ser um symlink.
const base = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-config-")));
after(() => {
  rmSync(base, { recursive: true, force: true });
});

const gitconfig = join(base, "gitconfig");
writeFileSync(gitconfig, "[user]\n\tname = Auditor\n\temail = auditor@exemplo.com\n");
process.env.GIT_CONFIG_GLOBAL = gitconfig;
process.env.GIT_CONFIG_NOSYSTEM = "1";

// gh autenticado e pi com dois modelos, na frente do PATH e em $FABRIQUINHA_PI.
const bin = join(base, "bin");
mkdirSync(bin);
writeFileSync(join(bin, "gh"), "#!/bin/sh\nexit 0\n");
writeFileSync(
  join(bin, "pi"),
  `#!/bin/sh
cat <<'TABELA'
provider   model              context  max-out  thinking  images
anthropic  claude-opus-5-5    200K     64K      yes       yes
llamacpp   qwen3-coder-30b    32.8K    8.2K     yes       no
TABELA
`,
);
chmodSync(join(bin, "gh"), 0o755);
chmodSync(join(bin, "pi"), 0o755);
process.env.PATH = `${bin}:${process.env.PATH ?? ""}`;
process.env.FABRIQUINHA_PI = join(bin, "pi");

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" }).toString().trim();

/** Clone com `origin` de cara GitHub e a branch `main` publicada num bare no disco. */
function clone(): string {
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

let banco: DatabaseSync;
beforeEach(() => {
  banco = abrir(mkdtempSync(join(base, "raiz-")));
});

const PROXIMA = new Date("2026-10-12T14:35:00.000Z");

/** Chama a rota como o servidor: o valor devolvido, ou `[status, mensagem]` do erro traduzido. */
async function chamar(metodo: string, caminho: string, corpo?: unknown): Promise<unknown> {
  for (const rota of ROTAS) {
    const params = rota.metodo === metodo ? casar(rota.caminho, caminho) : undefined;
    if (!params) continue;
    try {
      return await rota.tratar({
        banco,
        agendador: { proximaBusca: () => PROXIMA },
        params,
        query: new URLSearchParams(),
        corpo,
        resposta: undefined as unknown as ServerResponse,
      });
    } catch (erro) {
      return traduzir(erro);
    }
  }
  throw new Error(`${metodo} ${caminho} não existe`);
}

const formulario = (repo: string) => ({
  nome: "loja",
  repo,
  branchBase: "main",
  preparacao: [],
  testes: ["npm test"],
  sonar: { projectKey: "loja" },
  fitness: [{ nome: "cobertura", comando: "npm run cobertura", descricao: "Cobertura mínima." }],
  modelos: { desenho: { provedor: "anthropic", modelo: "claude-opus-5-5" } },
});

test("configuração: o F4 §3 com a próxima busca só ligado e a execução autônoma em andamento", async () => {
  assert.deepEqual(await chamar("GET", "/api/configuracao"), {
    agendadorAtivo: false,
    intervaloMin: 5,
    timeoutMin: 120,
    ociosidadeMin: 30,
    proximaBusca: null,
    emAndamento: null,
  });

  banco.exec(`
    INSERT INTO projeto (nome, repo, branch_base, hospedagem, testes, sonar_project_key, fitness)
      VALUES ('p', '/nao/existe', 'main', 'github', '["npm test"]', 'p', '[{"nome":"f","comando":"true","descricao":"d"}]');
    INSERT INTO issue (id, projeto, titulo, tipo, fase, criada_em) VALUES (3, 'p', 'Busca', 'problema', 'desenho', '2026-10-12T14:00:00.000Z');
    INSERT INTO ticket (id, issue, etapa, titulo, status, origem, criado_em)
      VALUES (7, 3, 'desenho', 'Desenho', 'em_execucao', 'fabriquinha', '2026-10-12T14:00:00.000Z');
    INSERT INTO execucao (id, ticket, modo, sessao_pi, resultado, iniciada_em)
      VALUES (9, 7, 'autonomo', 's', 'em_andamento', '2026-10-12T14:20:00.000Z');
  `);
  const salvo = { agendadorAtivo: true, intervaloMin: 10, timeoutMin: 60, ociosidadeMin: 15 };
  assert.deepEqual(await chamar("POST", "/api/configuracao", salvo), {
    ...salvo,
    proximaBusca: PROXIMA.toISOString(),
    emAndamento: { execucao: 9, ticket: 7, issue: 3, iniciadaEm: "2026-10-12T14:20:00.000Z" },
  });
});

test("configuração inválida dá 422 com o caminho de cada campo, em português, e nada muda", async () => {
  const [status, erro] = (await chamar("POST", "/api/configuracao", {
    agendadorAtivo: true,
    intervaloMin: 0,
    timeoutMin: 9,
  })) as [number, string];
  assert.equal(status, 422);
  assert.equal(
    erro,
    "✖ Pequeno demais: esperava que o número fosse >= 1\n  → at intervaloMin\n" +
      "✖ Pequeno demais: esperava que o número fosse >= 10\n  → at timeoutMin",
  );
  assert.equal(((await chamar("GET", "/api/configuracao")) as { agendadorAtivo: boolean }).agendadorAtivo, false);
});

test("modelos: os pares de pi --list-models, para os seletores", async () => {
  assert.deepEqual(await chamar("GET", "/api/modelos"), [
    { provedor: "anthropic", modelo: "claude-opus-5-5" },
    { provedor: "llamacpp", modelo: "qwen3-coder-30b" },
  ]);
});

test("cadastrar: confere, grava com a hospedagem deduzida do remoto e fixa o cursor inicial da base", async () => {
  const repo = clone();
  const salvo = { ...formulario(repo), hospedagem: "github" };
  assert.deepEqual(await chamar("POST", "/api/projetos", { ...formulario(repo), hospedagem: "azure-devops" }), salvo);
  assert.deepEqual(projeto(banco, "loja"), salvo);
  assert.equal(cursorDaBase(banco, "loja"), git(repo, "rev-parse", "HEAD"));
  assert.deepEqual(await chamar("GET", "/api/projetos"), [{ ...salvo, issues: 0 }]);
  banco.exec(
    "INSERT INTO issue (id, projeto, fase, criada_em) VALUES (1, 'loja', 'registro', '2026-10-12T14:00:00.000Z')",
  );
  assert.deepEqual(await chamar("GET", "/api/projetos"), [{ ...salvo, issues: 1 }]);
  assert.deepEqual(await chamar("POST", "/api/projetos", formulario(repo)), [
    409,
    "já existe o projeto loja (edite-o na Configuração)",
  ]);
});

test("editar: o nome do caminho vale, o do corpo é ignorado; projeto que não existe dá 404", async () => {
  const repo = clone();
  await chamar("POST", "/api/projetos", formulario(repo));
  const editado = { ...formulario(repo), nome: "outro", testes: ["npm test", "npm run e2e"], modelos: {} };
  assert.deepEqual(await chamar("POST", "/api/projetos/loja", editado), {
    ...editado,
    nome: "loja",
    hospedagem: "github",
  });
  assert.deepEqual(projeto(banco, "loja")?.testes, ["npm test", "npm run e2e"]);
  assert.equal(projeto(banco, "outro"), undefined);
  assert.deepEqual(await chamar("POST", "/api/projetos/nao-existe", formulario(clone())), [
    404,
    "o projeto nao-existe não existe (cadastre-o na Configuração)",
  ]);
});

test("campo inválido dá 422 com o caminho, antes de conferir o repositório; nada é gravado", async () => {
  const [status, erro] = (await chamar("POST", "/api/projetos", {
    ...formulario("relativo"),
    nome: "Loja X",
    testes: [],
    fitness: [
      { nome: "f", comando: "x", descricao: "d" },
      { nome: "f", comando: "y", descricao: "d" },
    ],
  })) as [number, string];
  assert.equal(status, 422);
  assert.match(
    erro,
    /✖ use letras minúsculas, números e hífen, começando por letra ou número \(até 64\)\n {2}→ at nome/,
  );
  assert.match(erro, /✖ caminho absoluto\n {2}→ at repo/);
  assert.match(erro, /→ at testes/);
  assert.match(erro, /✖ nome de fitness function repetido\n {2}→ at fitness/);
  assert.deepEqual(await chamar("GET", "/api/projetos"), []);
});

test("falha do F5 dá 502 com a mensagem da conferência; nada é gravado", async () => {
  const pasta = mkdtempSync(join(base, "nao-git-"));
  assert.deepEqual(await chamar("POST", "/api/projetos", formulario(pasta)), [
    502,
    `${pasta} não é um repositório git (informe o caminho da raiz de um clone do projeto)`,
  ]);
  assert.deepEqual(await chamar("GET", "/api/projetos"), []);
});

test("modelo que o pi não lista dá 422 no campo da etapa; nada é gravado", async () => {
  const [status, erro] = (await chamar("POST", "/api/projetos", {
    ...formulario(clone()),
    modelos: {
      desenho: { provedor: "anthropic", modelo: "claude-opus-5-5" },
      revisao: { provedor: "anthropic", modelo: "claude-opus" },
      sessao: { provedor: "openai", modelo: "gpt-6" },
    },
  })) as [number, string];
  assert.equal(status, 422);
  assert.equal(
    erro,
    "✖ o modelo anthropic/claude-opus não existe no pi (escolha um par listado por pi --list-models)\n  → at modelos.revisao\n" +
      "✖ o modelo openai/gpt-6 não existe no pi (escolha um par listado por pi --list-models)\n  → at modelos.sessao",
  );
  assert.deepEqual(await chamar("GET", "/api/projetos"), []);
});
