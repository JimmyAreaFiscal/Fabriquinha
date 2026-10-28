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
import { ROTAS } from "../servidor.ts";

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
        cabecalhos: {},
        resposta: undefined as unknown as ServerResponse,
      });
    } catch (erro) {
      return traduzir(erro);
    }
  }
  throw new Error(`${metodo} ${caminho} não existe`);
}

/** O cadastro como o formulário manda, sem os campos do fluxo legado (CA-13). */
const formulario = (repo: string) => ({ nome: "loja", repo, branchBase: "main", preparacao: [] });

/** O projeto gravado do `formulario`: as colunas legadas com o padrão e a chave do SonarQube com o nome. */
const gravado = (repo: string) => ({
  ...formulario(repo),
  hospedagem: "github",
  sonar: { projectKey: "loja" },
});

test("configuração: o F4 §3 com a próxima busca só ligado, sem as execuções autônomas (CA-13)", async () => {
  assert.deepEqual(await chamar("GET", "/api/configuracao"), {
    agendadorAtivo: false,
    intervaloMin: 5,
    timeoutMin: 120,
    ociosidadeMin: 30,
    modeloAuditoria: null,
    proximaBusca: null,
  });
  const salvo = { agendadorAtivo: true, intervaloMin: 10, timeoutMin: 60, ociosidadeMin: 15, modeloAuditoria: null };
  assert.deepEqual(await chamar("POST", "/api/configuracao", salvo), { ...salvo, proximaBusca: PROXIMA.toISOString() });
});

test("modelo das avaliações: o par listado pelo pi grava; o que o pi não lista dá 422 e mantém o anterior; o igual ao gravado não chama o pi", async () => {
  const opus = { provedor: "anthropic", modelo: "claude-opus-5-5" };
  const lido = async () => ((await chamar("GET", "/api/configuracao")) as { modeloAuditoria: unknown }).modeloAuditoria;
  assert.deepEqual(
    ((await chamar("POST", "/api/configuracao", { modeloAuditoria: opus })) as { modeloAuditoria: unknown })
      .modeloAuditoria,
    opus,
  );
  assert.deepEqual(await lido(), opus);

  assert.deepEqual(
    await chamar("POST", "/api/configuracao", { modeloAuditoria: { provedor: "inexistente", modelo: "xyz" } }),
    [
      422,
      "✖ o modelo inexistente/xyz não existe no pi (escolha um par listado por pi --list-models)\n  → at modeloAuditoria",
    ],
  );
  assert.deepEqual(await lido(), opus, "a recusa não gravou nada");

  // Igual ao gravado: o pi nem é chamado (aqui, quebrado); sem modelo, volta ao padrão.
  process.env.FABRIQUINHA_PI = "false";
  try {
    assert.deepEqual(
      (
        (await chamar("POST", "/api/configuracao", { intervaloMin: 7, modeloAuditoria: opus })) as {
          intervaloMin: number;
        }
      ).intervaloMin,
      7,
    );
    assert.equal(
      ((await chamar("POST", "/api/configuracao", {})) as { modeloAuditoria: unknown }).modeloAuditoria,
      null,
    );
  } finally {
    process.env.FABRIQUINHA_PI = join(bin, "pi");
  }
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

test("modelos: os pares de pi --list-models, para o seletor", async () => {
  assert.deepEqual(await chamar("GET", "/api/modelos"), [
    { provedor: "anthropic", modelo: "claude-opus-5-5" },
    { provedor: "llamacpp", modelo: "qwen3-coder-30b" },
  ]);
});

test("cadastrar: confere, grava com a hospedagem deduzida do remoto e fixa o cursor inicial da base", async () => {
  const repo = clone();
  const lido = gravado(repo);
  assert.deepEqual(
    await chamar("POST", "/api/projetos", { ...formulario(repo), hospedagem: "azure-devops" }),
    gravado(repo),
  );
  assert.deepEqual(projeto(banco, "loja"), lido);
  assert.equal(cursorDaBase(banco, "loja"), git(repo, "rev-parse", "HEAD"));
  assert.deepEqual(await chamar("GET", "/api/projetos"), [lido]);
  assert.deepEqual(await chamar("GET", "/api/projetos/loja"), lido);
  assert.deepEqual(await chamar("GET", "/api/projetos/nao-existe"), [
    404,
    "o projeto nao-existe não existe (confira o nome do projeto)",
  ]);
  assert.deepEqual(await chamar("POST", "/api/projetos", formulario(repo)), [
    409,
    "já existe o projeto loja (edite-o na Configuração)",
  ]);
});

test("CA-13: o cadastro não aceita testes, SonarQube, fitness, modelos nem efforts; nada é gravado", async () => {
  const repo = clone();
  for (const legado of [
    { testes: ["npm test"] },
    { sonar: { projectKey: "loja" } },
    { fitness: [{ nome: "f", comando: "true", descricao: "d" }] },
    { modelos: {} },
    { efforts: { desenho: "high" } },
  ]) {
    const [status, erro] = (await chamar("POST", "/api/projetos", { ...formulario(repo), ...legado })) as [
      number,
      string,
    ];
    assert.equal(status, 422);
    assert.match(erro, new RegExp(Object.keys(legado)[0] ?? ""));
  }
  assert.deepEqual(await chamar("GET", "/api/projetos"), []);
});

test("editar: o nome do caminho vale, o do corpo é ignorado, o cursor da base fica; projeto que não existe dá 404", async () => {
  const repo = clone();
  await chamar("POST", "/api/projetos", formulario(repo));
  const inicial = cursorDaBase(banco, "loja");
  // A base andou depois do cadastro: só o cadastro fixa o cursor inicial (F6 §4.4); a edição não varre.
  git(repo, "commit", "-q", "--allow-empty", "-m", "depois");
  git(repo, "push", "-q", "origin", "HEAD:refs/heads/main");
  const editado = { ...formulario(repo), nome: "outro", preparacao: ["npm ci"] };
  assert.deepEqual(await chamar("POST", "/api/projetos/loja", editado), {
    ...gravado(repo),
    preparacao: ["npm ci"],
  });
  assert.deepEqual(projeto(banco, "loja")?.preparacao, ["npm ci"]);
  assert.equal(projeto(banco, "outro"), undefined);
  assert.equal(cursorDaBase(banco, "loja"), inicial);
  assert.deepEqual(await chamar("POST", "/api/projetos/nao-existe", formulario(clone())), [
    404,
    "o projeto nao-existe não existe (cadastre-o na Configuração)",
  ]);
});

test("campo inválido dá 422 com o caminho, antes de conferir o repositório; nada é gravado", async () => {
  const [status, erro] = (await chamar("POST", "/api/projetos", {
    ...formulario("relativo"),
    nome: "Loja X",
    preparacao: [" "],
  })) as [number, string];
  assert.equal(status, 422);
  assert.match(
    erro,
    /✖ use letras minúsculas, números e hífen, começando por letra ou número \(até 64\)\n {2}→ at nome/,
  );
  assert.match(erro, /✖ caminho absoluto\n {2}→ at repo/);
  assert.match(erro, /→ at preparacao\[0\]/);
  assert.deepEqual(await chamar("GET", "/api/projetos"), []);
});

test("link do produto: válido é gravado, inválido dá 422 em linkProduto e o anterior fica", async () => {
  const repo = clone();
  const link = "https://demo.exemplo.com";
  await chamar("POST", "/api/projetos", { ...formulario(repo), linkProduto: link });
  const [status, erro] = (await chamar("POST", "/api/projetos/loja", {
    ...formulario(repo),
    linkProduto: "isso nao e um link",
  })) as [number, string];
  assert.equal(status, 422);
  assert.match(erro, /✖ Informe um link http\(s\) válido, como https:\/\/produto.exemplo.com\n {2}→ at linkProduto/);
  assert.equal(projeto(banco, "loja")?.linkProduto, link);
});

test("falha do F5 dá 502 com a mensagem da conferência; nada é gravado", async () => {
  const pasta = mkdtempSync(join(base, "nao-git-"));
  assert.deepEqual(await chamar("POST", "/api/projetos", formulario(pasta)), [
    502,
    `${pasta} não é um repositório git (informe o caminho da raiz de um clone do projeto)`,
  ]);
  assert.deepEqual(await chamar("GET", "/api/projetos"), []);
});

/** A demanda I-1 do `loja` com o ticket e a execução da sessão dele, terminada ou ainda em andamento. */
const demandaComExecucao = (andamento: boolean) => `
  INSERT INTO demanda VALUES ('I-1', 'loja', 'Busca', 'problema', 'd', 'execucao', '2026-10-12T14:00:00.000Z', 'f', 's', 1, 'fabriquinha/I-1');
  INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, status, status_alterado_em)
    VALUES ('I-1', 1, 'implementar', '${andamento ? "em_execucao" : "concluido"}', '2026-10-12T14:00:00.000Z');
  INSERT INTO sessao VALUES ('s', 'I-1', 1, 'autonomo', 's');
  INSERT INTO execucao_sessao (id, sessao_id, inicio, fim, falha)
    VALUES ('e', 's', '2026-10-12T14:20:00.000Z', ${andamento ? "NULL" : "'2026-10-12T15:00:00.000Z'"}, 0);`;

test("remover: apaga o projeto e tudo dele, responde { avisos } e o projeto some do GET (404 no detalhe)", async () => {
  await chamar("POST", "/api/projetos", formulario(clone()));
  banco.exec(demandaComExecucao(false));
  assert.deepEqual(await chamar("DELETE", "/api/projetos/loja"), { avisos: [] });
  assert.deepEqual(await chamar("GET", "/api/projetos"), []);
  assert.deepEqual(await chamar("GET", "/api/projetos/loja"), [
    404,
    "o projeto loja não existe (confira o nome do projeto)",
  ]);
  assert.equal(banco.prepare("SELECT count(*) AS n FROM demanda").get()?.n, 0);
});

test("remover projeto que não existe dá 404 com a mensagem do projeto", async () => {
  const [status, erro] = (await chamar("DELETE", "/api/projetos/fantasma")) as [number, string];
  assert.equal(status, 404);
  assert.match(erro, /o projeto fantasma não existe/);
});

test("remover projeto com execução em andamento dá 409 e o projeto continua", async () => {
  await chamar("POST", "/api/projetos", formulario(clone()));
  banco.exec(demandaComExecucao(true));
  const [status, erro] = (await chamar("DELETE", "/api/projetos/loja")) as [number, string];
  assert.equal(status, 409);
  assert.match(erro, /execução em andamento/);
  assert.equal(((await chamar("GET", "/api/projetos")) as unknown[]).length, 1);
});
