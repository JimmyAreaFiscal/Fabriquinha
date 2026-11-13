import assert from "node:assert/strict";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { branchDemanda, branchRodada } from "../nucleo/nome_do_espaco.ts";
import { ErroDeRegra } from "../../../../shared/nucleo/erros.ts";
import {
  criarRepositorioDeTeste,
  commitarArquivo,
  rodarGit as git,
} from "../../../../../apoio-testes/repositorio_de_teste.ts";
import { caminhoDaWorktreeDemanda, caminhoDaWorktreeRodada, garantirWorktreeDemanda } from "./worktree-demanda.ts";
import { podarWorktreesNoCore } from "./worktree.ts";
import { AmbienteHostLocal, PASTA_DAS_ENTRADAS_DE_WORKTREE_DA_FABRIQUINHA } from "../../../ambiente/publico.ts";

const ambiente = new AmbienteHostLocal();

const branch = branchDemanda("D-1");
const chave = `branch.${branch}.fabriquinha`;
type Cenario = ReturnType<typeof criarRepositorioDeTeste>;
const caminho = (c: Cenario) => caminhoDaWorktreeDemanda(c.raiz, c.projeto.nome, "D-1");
const garantir = (c: Cenario) => garantirWorktreeDemanda(ambiente, c.raiz, c.projeto, "D-1", c.log);
const marca = (pasta: string) =>
  git(pasta, "rev-parse", "--path-format=absolute", "--git-path", "fabriquinha-preparada");

test("nomes, caminhos absolutos irmãos e identidades inválidas antes de I/O", async () => {
  assert.equal(branch, "fabriquinha/D-1");
  assert.equal(branchRodada("D-1", 2), "fabriquinha/D-1-2");
  assert.equal(caminhoDaWorktreeDemanda("/r", "loja", "D-1"), "/r/worktrees/loja/D-1/demanda");
  assert.equal(
    caminhoDaWorktreeRodada("/r", "loja", { demanda_id: "D-1", rodada_id: 2 }),
    "/r/worktrees/loja/D-1/rodadas/2",
  );
  for (const id of ["../D-1", "D-0", "D-1/../../x", "D-1-2", ""]) {
    assert.throws(() => caminhoDaWorktreeDemanda("/inexistente", "loja", id), ErroDeRegra);
    assert.throws(() => caminhoDaWorktreeRodada("/r", "loja", { demanda_id: id, rodada_id: 1 }), ErroDeRegra);
    const c = criarRepositorioDeTeste();
    await assert.rejects(garantirWorktreeDemanda(ambiente, c.raiz, c.projeto, id, c.log), ErroDeRegra);
    assert.equal(git(c.repo, "config", "--default", "", "--get", chave), "");
    assert.equal(existsSync(join(c.raiz, "worktrees")), false);
  }
  for (const nome of ["../loja", ".", "loja/x"]) {
    const c = criarRepositorioDeTeste();
    await assert.rejects(garantirWorktreeDemanda(ambiente, c.raiz, { ...c.projeto, nome }, "D-1", c.log), ErroDeRegra);
  }
  for (const rodada_id of [0, -1, 1.5, NaN]) {
    assert.throws(() => caminhoDaWorktreeRodada("/r", "loja", { demanda_id: "D-1", rodada_id }), ErroDeRegra);
  }
});

test("base configurada atualizada no origin, preparação em ordem e idempotência", async () => {
  const c = criarRepositorioDeTeste([
    "printf um > ordem; printf primeira",
    'test "$(cat ordem)" = um; printf dois >> ordem',
  ]);
  const outro = join(c.dir, "outro");
  git(c.dir, "clone", "-q", "-b", "integracao", c.bare, outro);
  const sha = commitarArquivo(outro, "remoto.txt", "remoto");
  git(outro, "push", "-q", "origin", "integracao");
  const p = await garantirWorktreeDemanda(ambiente, c.raiz, c.projeto, "D-1", c.log);
  assert.equal(git(p, "rev-parse", "HEAD"), sha);
  assert.equal(git(c.repo, "config", "--get", chave), `demanda:${p}`);
  assert.equal(readFileSync(join(p, "ordem"), "utf8"), "umdois");
  assert.match(readFileSync(c.log, "utf8"), /preparação: printf um.*primeira.*preparação: test/s);
  assert.equal(existsSync(marca(p)), true);
  assert.equal(existsSync(join(p, "fabriquinha-preparada")), false);
  git(c.repo, "remote", "remove", "origin");
  assert.equal(await garantirWorktreeDemanda(ambiente, c.raiz, c.projeto, "D-1", c.log), p);
  assert.equal(readFileSync(join(p, "ordem"), "utf8"), "umdois");
});

test("base configurável com namespace é preservada na refspec", async () => {
  const c = criarRepositorioDeTeste([], "release/entrega");
  const p = await garantir(c);
  assert.equal(git(p, "rev-parse", "HEAD"), git(c.repo, "rev-parse", "origin/release/entrega"));
  assert.equal(git(c.repo, "branch", "--list", "main"), "");
});

test("pasta removida fisicamente: prune, commits conservados e preparação refeita", async () => {
  const c = criarRepositorioDeTeste(["printf x >> preparado"]);
  const p = await garantir(c);
  const sha = commitarArquivo(p, "trabalho.txt", "não perder");
  const antiga = marca(p);
  rmSync(p, { recursive: true });
  git(c.repo, "remote", "remove", "origin");
  assert.equal(await garantir(c), p);
  assert.equal(git(p, "rev-parse", "HEAD"), sha);
  assert.equal(readFileSync(join(p, "trabalho.txt"), "utf8"), "não perder");
  assert.equal(readFileSync(join(p, "preparado"), "utf8"), "x");
  assert.equal(existsSync(antiga), true);
  assert.equal(readFileSync(c.log, "utf8").match(/preparação:/g)?.length, 2);
});

test("falha de preparação não marca, interrompe comandos e permite retry sem fetch", async () => {
  const c = criarRepositorioDeTeste(["printf falha; exit 7", "touch nao-executar"]);
  await assert.rejects(garantir(c), /preparação.*código 7/);
  assert.equal(existsSync(marca(caminho(c))), false);
  assert.equal(existsSync(join(caminho(c), "nao-executar")), false);
  c.projeto.verificacoes.preparacao = ["printf recuperado > pronto"];
  git(c.repo, "remote", "remove", "origin");
  await garantir(c);
  assert.equal(existsSync(marca(caminho(c))), true);
  assert.equal(readFileSync(join(caminho(c), "pronto"), "utf8"), "recuperado");
});

test("branches alheias, marcas legadas/de outra raiz e config órfã são intocadas", async () => {
  for (const posse of ["", "legada 2026-01-01", "demanda:/outra/raiz", "rodada:/outra/raiz"]) {
    const c = criarRepositorioDeTeste();
    git(c.repo, "branch", branch);
    if (posse !== "") git(c.repo, "config", chave, posse);
    const antes = git(c.repo, "rev-parse", branch);
    await assert.rejects(garantir(c), /não pertence/);
    assert.equal(git(c.repo, "rev-parse", branch), antes);
    assert.equal(git(c.repo, "config", "--default", "", "--get", chave), posse);
    assert.equal(existsSync(caminho(c)), false);
  }
  const c = criarRepositorioDeTeste();
  git(c.repo, "config", chave, "outro dono sem branch");
  await assert.rejects(garantir(c), /não pertence/);
  assert.equal(git(c.repo, "config", "--get", chave), "outro dono sem branch");
  assert.equal(git(c.repo, "for-each-ref", "--format=%(refname)", `refs/heads/${branch}`), "");
});

test("colisão de prefixo de ref não faz uma branch inexistente parecer existente", async () => {
  const c = criarRepositorioDeTeste();
  git(c.repo, "branch", `${branch}-2`);
  const antes = git(c.repo, "rev-parse", `${branch}-2`);
  await garantir(c);
  assert.equal(git(c.repo, "rev-parse", `${branch}-2`), antes);
});

test("ref descendente ocupa o namespace, mas não é adotada como a ref exata", async () => {
  const c = criarRepositorioDeTeste();
  const descendente = `${branch}/humana`;
  git(c.repo, "branch", descendente);
  const sha = git(c.repo, "rev-parse", descendente);
  git(c.repo, "remote", "remove", "origin");
  await assert.rejects(garantir(c), /outra branch ocupa o prefixo/);
  assert.equal(git(c.repo, "rev-parse", descendente), sha);
  assert.equal(git(c.repo, "config", "--default", "", "--get", chave), "");
  assert.equal(existsSync(caminho(c)), false);
});

test("recusa symlinks (inclusive quebrados), arquivo e pasta ocupada antes do fetch", async () => {
  for (const tipo of ["link", "quebrado", "arquivo", "pasta", "ancestral"]) {
    const c = criarRepositorioDeTeste();
    const p = caminho(c);
    mkdirSync(dirname(p), { recursive: true });
    const destino = join(c.dir, "dados");
    mkdirSync(destino);
    writeFileSync(join(destino, "preservar"), "dados");
    if (tipo === "link") symlinkSync(destino, p);
    if (tipo === "quebrado") symlinkSync(join(c.dir, "ausente"), p);
    if (tipo === "arquivo") writeFileSync(p, "não remover");
    if (tipo === "pasta") mkdirSync(p);
    if (tipo === "ancestral") {
      rmSync(join(c.raiz, "worktrees"), { recursive: true });
      symlinkSync(destino, join(c.raiz, "worktrees"));
    }
    git(c.repo, "remote", "remove", "origin");
    await assert.rejects(garantir(c), /indevido|ocupado/);
    assert.equal(git(c.repo, "config", "--default", "", "--get", chave), "");
    assert.equal(readFileSync(join(destino, "preservar"), "utf8"), "dados");
  }
});

test("checkout de outra branch ou outro repositório não é adotado", async () => {
  for (const estrangeiro of [false, true]) {
    const c = criarRepositorioDeTeste();
    const p = await garantir(c);
    if (estrangeiro) {
      git(c.repo, "worktree", "remove", p);
      const outro = criarRepositorioDeTeste();
      git(outro.repo, "worktree", "add", "-b", branch, p);
    } else {
      git(p, "checkout", "-b", "humana");
    }
    writeFileSync(join(p, "dados"), "intacto");
    await assert.rejects(garantir(c), /checkout indevido/);
    assert.equal(readFileSync(join(p, "dados"), "utf8"), "intacto");
  }
});

test("branch própria em outro caminho é rejeitada, mesmo se a pasta registrada sumiu", async () => {
  for (const ausente of [false, true]) {
    const c = criarRepositorioDeTeste();
    const p = await garantir(c);
    const outro = join(c.dir, "movida");
    git(c.repo, "worktree", "move", p, outro);
    if (ausente) rmSync(outro, { recursive: true });
    await assert.rejects(garantir(c), /branch já usada/);
    assert.equal(existsSync(p), false);
  }
});

test("recusa worktrees ancestrais/descendentes registradas ou estrangeiras no disco", async () => {
  for (const estrangeiro of [false, true]) {
    for (const ancestral of [false, true]) {
      const c = criarRepositorioDeTeste();
      const repo = estrangeiro ? criarRepositorioDeTeste().repo : c.repo;
      const p = caminho(c);
      const ocupada = ancestral ? dirname(p) : join(p, "filho", "checkout");
      git(repo, "worktree", "add", "-b", "humana", ocupada);
      writeFileSync(join(ocupada, "dados"), "intacto");
      git(c.repo, "remote", "remove", "origin");
      await assert.rejects(garantir(c), /ancestral|descendente|aninhada/);
      assert.equal(git(c.repo, "config", "--default", "", "--get", chave), "");
      assert.equal(readFileSync(join(ocupada, "dados"), "utf8"), "intacto");
    }
  }
  const c = criarRepositorioDeTeste();
  const p = join(caminho(c), "ausente");
  git(c.repo, "worktree", "add", "-b", "humana", p);
  rmSync(caminho(c), { recursive: true });
  await assert.rejects(garantir(c), /aninhada/);
});

test("links internos da preparação são conservados e não seguidos na inspeção", async () => {
  const c = criarRepositorioDeTeste();
  const p = await garantir(c);
  mkdirSync(join(p, "pasta"));
  symlinkSync(c.repo, join(p, "pasta", "link"));
  assert.equal(await garantir(c), p);
  assert.equal(existsSync(join(p, "pasta", "link", "base.txt")), true);
});

test("registro de outra branch no destino ausente é rejeitado antes de fetch/config", async () => {
  const c = criarRepositorioDeTeste();
  const p = caminho(c);
  git(c.repo, "worktree", "add", "-b", "humana", p);
  rmSync(p, { recursive: true });
  git(c.repo, "remote", "remove", "origin");
  await assert.rejects(garantir(c), /checkout indevido registrado/);
  assert.equal(git(c.repo, "config", "--default", "", "--get", chave), "");
  assert.equal(git(c.repo, "for-each-ref", "--format=%(refname)", `refs/heads/${branch}`), "");
});

test("erro Git operacional vira ErroDeRegra sem posse nem ref", async () => {
  const c = criarRepositorioDeTeste();
  git(c.repo, "remote", "set-url", "origin", join(c.dir, "inexistente"));
  await assert.rejects(
    garantir(c),
    (erro: unknown) => erro instanceof ErroDeRegra && /git fetch.*falhou/.test(erro.message),
  );
  assert.equal(git(c.repo, "config", "--default", "", "--get", chave), "");
  assert.equal(existsSync(caminho(c)), false);
});

test("o git local da worktree roda no Ambiente e o fetch, que precisa de credenciais, roda no core", async () => {
  const c = criarRepositorioDeTeste();
  const argumentosNoAmbiente: string[][] = [];
  const ambienteQueRegistra = Object.create(ambiente) as AmbienteHostLocal;
  ambienteQueRegistra.executar = (comando) => {
    if (comando.programa === "git") argumentosNoAmbiente.push(comando.argumentos);
    return ambiente.executar(comando);
  };
  const pasta = await garantirWorktreeDemanda(ambienteQueRegistra, c.raiz, c.projeto, "D-1", c.log);
  const subcomandosNoAmbiente = argumentosNoAmbiente.map((argumentos) => argumentos[2]);
  assert.ok(subcomandosNoAmbiente.includes("worktree"));
  assert.ok(argumentosNoAmbiente.some((argumentos) => argumentos.includes("add") && argumentos.includes(pasta)));
  assert.ok(subcomandosNoAmbiente.includes("rev-parse"));
  for (const subcomandoDeRede of ["fetch", "push", "ls-remote"]) {
    assert.ok(!argumentosNoAmbiente.some((argumentos) => argumentos.includes(subcomandoDeRede)));
  }
  // O fetch no core atualizou a ref da base no clone do usuário.
  assert.equal(git(pasta, "rev-parse", "HEAD"), git(c.repo, "rev-parse", "origin/integracao"));
});

test("no Ambiente que não escreve em todo o .git o core cria a worktree e deixa a pasta administrativa dela na pasta que o Ambiente escreve, com um link em worktrees", async () => {
  const c = criarRepositorioDeTeste();
  const ambienteContainer = Object.create(ambiente, {
    escreveEmTodoOGitDoClone: { value: false },
  }) as AmbienteHostLocal;
  const comandosGitNoAmbiente: string[][] = [];
  ambienteContainer.executar = (comando) => {
    if (comando.programa === "git") comandosGitNoAmbiente.push(comando.argumentos);
    return ambiente.executar(comando);
  };
  const pasta = await garantirWorktreeDemanda(ambienteContainer, c.raiz, c.projeto, "D-1", c.log);

  assert.ok(!comandosGitNoAmbiente.some((argumentos) => argumentos.includes("add")), "o `worktree add` é do core");
  const entrada = join(c.repo, ".git", "worktrees", "demanda");
  assert.ok(lstatSync(entrada).isSymbolicLink());
  assert.ok(existsSync(join(c.repo, ".git", PASTA_DAS_ENTRADAS_DE_WORKTREE_DA_FABRIQUINHA, "demanda", "HEAD")));
  assert.equal(git(pasta, "status", "--porcelain"), "");
  assert.match(git(c.repo, "worktree", "list"), /demanda/);

  // Sem a worktree, a poda leva o link e a pasta administrativa.
  rmSync(dirname(pasta), { recursive: true });
  await podarWorktreesNoCore(c.repo);
  assert.ok(!existsSync(entrada));
  assert.deepEqual(readdirSync(join(c.repo, ".git", PASTA_DAS_ENTRADAS_DE_WORKTREE_DA_FABRIQUINHA)), []);
});
