import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { Projeto } from "../dominio/configuracao_projeto.ts";
import { ErroDeInexistente } from "../dominio/erros.ts";
import { abrir, escrever } from "./banco.ts";
import { projeto, projetos, registrarProjeto } from "./projetos.ts";
import {
  configuracaoProjeto,
  etapasDoProjeto,
  gravarConfiguracaoProjeto,
  substituirEtapasDoProjeto,
} from "./configuracao_projeto.ts";

const TABELAS = [
  "projeto",
  "configuracao_etapa_projeto",
  "comando_preparacao_projeto",
  "fitness_function_projeto",
  "linguagem_projeto",
  "configuracao_e2e",
  "glob_e2e",
];

function comBanco(corpo: (banco: DatabaseSync, raiz: string) => void): void {
  const raiz = mkdtempSync(join(tmpdir(), "cfg-projeto-"));
  const banco = abrir(raiz);
  try {
    for (const nome of ["a", "b"]) {
      banco
        .prepare(
          `INSERT INTO projeto (nome, repo, branch_base, hospedagem, preparacao, sonar_project_key)
           VALUES (?, ?, 'main', 'github', '["npm i"]', 'chave')`,
        )
        .run(nome, `/repo/${nome}`);
    }
    corpo(banco, raiz);
  } finally {
    banco.close();
    rmSync(raiz, { recursive: true, force: true });
  }
}

const dump = (banco: DatabaseSync): unknown[] =>
  TABELAS.map((t) => banco.prepare(`SELECT * FROM ${t} ORDER BY 1, 2, 3`).all());

const minima = (nome = "a") => ({
  nome,
  branch_base: "main",
  chave_sonarqube: "chave",
  raiz_git: `/repo/${nome}`,
  hospedagem: "github",
  fitness: [{ nome: "f", comando: "  npm run f  ", descricao: "d" }],
  linguagens: [{ caminho: ".", linguagem: "ts", comando_teste: "npm test" }],
});

const completa = {
  ...minima(),
  cursor_commit_humano: "abc",
  etapas: [
    { etapa: "planejar", modelo_provedor: "p", modelo_nome: "m", effort: "high" },
    { etapa: "implementar", effort: "low" },
    { etapa: "demanda" },
  ],
  preparacao: [
    { ordem: 10, comando: "segundo" },
    { ordem: 2, comando: "primeiro" },
  ],
  fitness: [
    { nome: "z", comando: "c", descricao: "d" },
    { nome: "a", comando: "c", descricao: "d" },
  ],
  linguagens: [
    { caminho: "web", linguagem: "ts", comando_teste: "t" },
    { caminho: "api", linguagem: "ts", comando_teste: "t" },
  ],
  e2e: [
    { caminho_linguagem: "web", comando_build: "b", comando_execucao: "e", codigo_falha: 255 },
    { caminho_linguagem: "api", comando_build: "b", comando_execucao: "e", codigo_falha: 1 },
  ],
  globs: [
    { caminho_linguagem: "web", glob: "z/*" },
    { caminho_linguagem: "api", glob: "b/*" },
    { caminho_linguagem: "api", glob: "a/*" },
  ],
};

const canonica = {
  ...completa,
  etapas: [
    { etapa: "demanda" },
    { etapa: "implementar", effort: "low" },
    { etapa: "planejar", modelo_provedor: "p", modelo_nome: "m", effort: "high" },
  ],
  preparacao: [
    { ordem: 2, comando: "primeiro" },
    { ordem: 10, comando: "segundo" },
  ],
  fitness: [
    { nome: "a", comando: "c", descricao: "d" },
    { nome: "z", comando: "c", descricao: "d" },
  ],
  linguagens: [completa.linguagens[1], completa.linguagens[0]],
  e2e: [completa.e2e[1], completa.e2e[0]],
  globs: [completa.globs[2], completa.globs[1], completa.globs[0]],
};

/** A configuração `completa` do projeto `a`: as etapas, que são do cadastro, e o resto, que é da configuração SDLC. */
function gravarCompleta(banco: DatabaseSync): Projeto {
  substituirEtapasDoProjeto(banco, "a", completa.etapas);
  return gravarConfiguracaoProjeto(banco, completa);
}

test("ida e volta completa, com listas na ordem canônica", () => {
  comBanco((banco) => {
    assert.deepEqual(gravarCompleta(banco), canonica);
    assert.deepEqual(configuracaoProjeto(banco, "a"), canonica);
  });
});

test("a gravação da configuração ignora as etapas da entrada e mantém as gravadas pelo cadastro", () => {
  comBanco((banco) => {
    assert.deepEqual(gravarConfiguracaoProjeto(banco, completa).etapas, []);
    substituirEtapasDoProjeto(banco, "a", completa.etapas);
    assert.deepEqual(gravarConfiguracaoProjeto(banco, { ...minima(), etapas: [] }).etapas, canonica.etapas);
    assert.deepEqual(configuracaoProjeto(banco, "a")?.etapas, canonica.etapas);
  });
});

test("etapas: lidas sem a configuração SDLC, substituídas sozinhas; a inválida não altera nada", () => {
  comBanco((banco) => {
    assert.deepEqual(etapasDoProjeto(banco, "b"), []);
    substituirEtapasDoProjeto(banco, "b", [{ etapa: "sessao_em_aberto", effort: "max" }]);
    assert.equal(configuracaoProjeto(banco, "b"), undefined);
    assert.deepEqual(etapasDoProjeto(banco, "b"), [{ etapa: "sessao_em_aberto", effort: "max" }]);

    gravarCompleta(banco);
    substituirEtapasDoProjeto(banco, "a", [{ etapa: "demanda", modelo_provedor: "p", modelo_nome: "m" }]);
    assert.deepEqual(configuracaoProjeto(banco, "a"), {
      ...canonica,
      etapas: [{ etapa: "demanda", modelo_provedor: "p", modelo_nome: "m" }],
    });
    const antes = dump(banco);
    assert.throws(() => {
      substituirEtapasDoProjeto(banco, "a", [{ etapa: "planejar", modelo_provedor: "p" }]);
    }, /modelo_nome/);
    assert.deepEqual(dump(banco), antes);
    assert.equal(banco.isTransaction, false);
    assert.deepEqual(etapasDoProjeto(banco, "b"), [{ etapa: "sessao_em_aberto", effort: "max" }]);
  });
});

test("a leitura dentro de uma escrita faz parte dela, sem abrir outra transação", () => {
  comBanco((banco) => {
    gravarCompleta(banco);
    assert.deepEqual(
      escrever(banco, () => configuracaoProjeto(banco, "a")),
      canonica,
    );
  });
});

test("configuração mínima aplica defaults e trim; opcionais ficam ausentes", () => {
  comBanco((banco) => {
    const esperado = {
      ...minima(),
      fitness: [{ nome: "f", comando: "npm run f", descricao: "d" }],
      etapas: [],
      preparacao: [],
      e2e: [],
      globs: [],
    };
    assert.deepEqual(gravarConfiguracaoProjeto(banco, minima()), esperado);
    assert.deepEqual(configuracaoProjeto(banco, "a"), esperado);
  });
});

test("mesmo nome de linguagem em caminhos distintos e leitura após reabrir", () => {
  comBanco((banco, raiz) => {
    gravarCompleta(banco);
    const outro = abrir(raiz);
    assert.deepEqual(
      configuracaoProjeto(outro, "a")?.linguagens.map((l) => l.linguagem),
      ["ts", "ts"],
    );
    assert.deepEqual(configuracaoProjeto(outro, "a"), canonica);
    outro.close();
  });
});

test("substituição remove cursor e listas opcionais e mantém as etapas", () => {
  comBanco((banco) => {
    gravarCompleta(banco);
    const nova = {
      ...minima(),
      raiz_git: "/novo",
      hospedagem: "azure-devops",
      branch_base: "dev",
      chave_sonarqube: "k2",
    };
    const lida = gravarConfiguracaoProjeto(banco, nova);
    assert.equal(lida.cursor_commit_humano, undefined);
    assert.deepEqual(configuracaoProjeto(banco, "a"), lida);
    assert.equal(lida.raiz_git, "/novo");
    assert.deepEqual(lida.etapas, canonica.etapas);
    assert.equal(banco.prepare("SELECT count(*) AS n FROM comando_preparacao_projeto").get()?.n, 0);
    assert.equal(banco.prepare("SELECT count(*) AS n FROM glob_e2e").get()?.n, 0);
  });
});

test("ausência: sem configuração nova ou projeto inexistente lê undefined sem inventar nada", () => {
  comBanco((banco) => {
    const antes = dump(banco);
    assert.equal(configuracaoProjeto(banco, "a"), undefined);
    assert.equal(configuracaoProjeto(banco, "nao-existe"), undefined);
    assert.deepEqual(dump(banco), antes);
    assert.throws(() => gravarConfiguracaoProjeto(banco, minima("nao-existe")), ErroDeInexistente);
    assert.equal(banco.isTransaction, false);
  });
});

test("entrada inválida não altera nada", () => {
  comBanco((banco) => {
    gravarCompleta(banco);
    const antes = dump(banco);
    assert.throws(() => gravarConfiguracaoProjeto(banco, { ...completa, linguagens: [] }));
    assert.deepEqual(dump(banco), antes);
    assert.deepEqual(configuracaoProjeto(banco, "a"), canonica);
  });
});

test("erro tardio no INSERT de glob reverte tudo e libera a transação", () => {
  comBanco((banco) => {
    gravarCompleta(banco);
    const antes = dump(banco);
    banco.exec(`CREATE TRIGGER falha_glob BEFORE INSERT ON glob_e2e WHEN NEW.glob = 'boom'
      BEGIN SELECT RAISE(ABORT, 'falha de teste'); END`);
    const nova = {
      ...minima(),
      cursor_commit_humano: "novo",
      e2e: [{ caminho_linguagem: ".", comando_build: "b", comando_execucao: "e", codigo_falha: 3 }],
      globs: [{ caminho_linguagem: ".", glob: "boom" }],
    };
    assert.throws(() => gravarConfiguracaoProjeto(banco, nova), /falha de teste/);
    assert.equal(banco.isTransaction, false);
    assert.deepEqual(dump(banco), antes);
    assert.deepEqual(configuracaoProjeto(banco, "a"), canonica);
  });
});

test("repo duplicado propaga o erro e preserva a configuração anterior", () => {
  comBanco((banco) => {
    gravarCompleta(banco);
    const antes = dump(banco);
    assert.throws(() => gravarConfiguracaoProjeto(banco, { ...minima(), raiz_git: "/repo/b" }), /UNIQUE/);
    assert.deepEqual(dump(banco), antes);
  });
});

test("projetos são isolados e campos comuns são compartilhados com o cadastro", () => {
  comBanco((banco) => {
    gravarCompleta(banco);
    gravarConfiguracaoProjeto(banco, minima("b"));
    assert.deepEqual(configuracaoProjeto(banco, "a"), canonica);
    assert.equal(configuracaoProjeto(banco, "b")?.fitness.length, 1);

    // A preparação do cadastro fica como estava: a da configuração SDLC mora na tabela dela.
    assert.equal(banco.prepare("SELECT preparacao FROM projeto WHERE nome = 'a'").get()?.preparacao, '["npm i"]');
    banco.exec("UPDATE projeto SET branch_base = 'outra' WHERE nome = 'a'");
    assert.equal(configuracaoProjeto(banco, "a")?.branch_base, "outra");
    gravarConfiguracaoProjeto(banco, { ...completa, branch_base: "nova" });
    assert.equal(banco.prepare("SELECT branch_base FROM projeto WHERE nome = 'a'").get()?.branch_base, "nova");
  });
});

test("leitura é um snapshot: substituição commitada entre os SELECTs só aparece na leitura seguinte", () => {
  comBanco((banco, raiz) => {
    gravarCompleta(banco);
    const nova = {
      ...minima(),
      branch_base: "dev",
      linguagens: [{ caminho: "web", linguagem: "ts", comando_teste: "t" }],
    };
    const leitor = new DatabaseSync(join(raiz, "fabriquinha.db"));
    // eslint-disable-next-line @typescript-eslint/unbound-method -- preserva o método para restaurar; chamada usa .call(leitor).
    const prepare = leitor.prepare;
    let escreveu = false;
    try {
      assert.equal(leitor.prepare("PRAGMA journal_mode").get()?.journal_mode, "wal");
      // Instrumentação local: outra conexão commita B depois do SELECT base e antes do de linguagens.
      leitor.prepare = (sql: string) => {
        if (sql.includes("FROM linguagem_projeto") && !escreveu) {
          escreveu = true;
          gravarConfiguracaoProjeto(banco, nova);
        }
        return prepare.call(leitor, sql);
      };
      assert.deepEqual(configuracaoProjeto(leitor, "a"), canonica);
      assert.ok(escreveu);
      assert.equal(leitor.isTransaction, false);
      assert.deepEqual(configuracaoProjeto(leitor, "a"), { ...Projeto.parse(nova), etapas: canonica.etapas });
      assert.equal(leitor.isTransaction, false);
    } finally {
      leitor.prepare = prepare;
      leitor.close();
    }
  });
});

test("raiz_git relativa é recusada sem mutação e as leituras legadas seguem válidas", () => {
  comBanco((banco) => {
    const legado = {
      nome: "loja",
      repo: "/repos/loja",
      branchBase: "main",
      hospedagem: "github",
      sonar: { projectKey: "loja" },
    };
    banco.exec("DELETE FROM projeto"); // as fixtures a/b têm JSON legado inválido; aqui só dados válidos
    registrarProjeto(banco, legado);
    registrarProjeto(banco, { ...legado, nome: "outro", repo: "/repos/outro" });
    const sdlc = { ...minima("loja"), raiz_git: "/repos/loja" };
    gravarConfiguracaoProjeto(banco, sdlc);
    const antes = dump(banco);
    assert.throws(() => gravarConfiguracaoProjeto(banco, { ...sdlc, raiz_git: "repo-relativo" }), /absoluta/);
    assert.deepEqual(dump(banco), antes);
    assert.equal(banco.isTransaction, false);
    assert.equal(projeto(banco, "loja")?.repo, "/repos/loja");
    assert.equal(projetos(banco).length, 2);
    gravarConfiguracaoProjeto(banco, { ...sdlc, raiz_git: "/repos/nova" });
    assert.equal(projeto(banco, "loja")?.repo, "/repos/nova");
    assert.deepEqual(configuracaoProjeto(banco, "loja")?.raiz_git, "/repos/nova");
  });
});
