import assert from "node:assert/strict";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { ZodError } from "zod";
import { abrirBancoTemporario } from "../../apoio-testes/banco_temporario.ts";
import { editarProjeto, gravarConfiguracaoSdlc, registrarProjeto } from "../aplicacao/projeto/cadastro.ts";
import { ErroDeInexistente, ErroDeRegra } from "../nucleo/erros.ts";
import { Projeto, ProjetoConfigurado } from "../nucleo/projeto.ts";
import { abrir, escrever } from "./banco.ts";
import { criarDemandaNova } from "./demandas.ts";
import { registrarDemanda } from "../nucleo/transicoes_demanda.ts";
import { iniciarTentativaDoTicket } from "../nucleo/reserva_ticket.ts";
import { FABRIQUINHA } from "../nucleo/ator.ts";
import {
  apagarProjeto,
  buscarProjeto,
  carregarProjeto,
  donoDoRepositorio,
  gravarProjeto,
  listarProjetos,
  projetoExistente,
  tarefaComExecucaoSimuladaPendente,
  ticketEmAndamentoDoProjeto,
} from "./projetos.ts";

const TABELAS = [
  "projeto",
  "configuracao_etapa_projeto",
  "comando_preparacao_projeto",
  "fitness_function_projeto",
  "linguagem_projeto",
  "configuracao_e2e",
  "glob_e2e",
];
const cadastro = (nome = "a") => ({
  nome,
  branch_base: "main",
  chave_sonarqube: "chave",
  raiz_git: `/repo/${nome}`,
  hospedagem: "github",
});
const minima = (nome = "a") => ({
  ...cadastro(nome),
  verificacoes: {
    fitness: [{ nome: "f", comando: "  npm run f  ", descricao: "d" }],
    linguagens: [{ caminho: ".", linguagem: "ts", comando_teste: "npm test" }],
  },
});
const completa = ProjetoConfigurado.parse({
  ...minima(),
  etapas: [
    { etapa: "planejar", configuracao_agente: { modelo: { provedor: "p", nome: "m" }, effort: "high" } },
    { etapa: "implementar", configuracao_agente: { effort: "low" } },
    { etapa: "entender_e_desenhar" },
  ],
  verificacoes: {
    preparacao: ["primeiro", "segundo"],
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
  },
});
const canonica = {
  ...completa,
  etapas: [completa.etapas[2], completa.etapas[1], completa.etapas[0]],
  verificacoes: {
    ...completa.verificacoes,
    fitness: [completa.verificacoes.fitness[1], completa.verificacoes.fitness[0]],
    linguagens: [completa.verificacoes.linguagens[1], completa.verificacoes.linguagens[0]],
    e2e: [completa.verificacoes.e2e[1], completa.verificacoes.e2e[0]],
    globs: [completa.verificacoes.globs[2], completa.verificacoes.globs[1], completa.verificacoes.globs[0]],
  },
};
function comBanco(corpo: (banco: DatabaseSync, raiz: string) => void): void {
  const { raiz, banco, fechar } = abrirBancoTemporario();
  try {
    for (const nome of ["a", "b"]) gravarProjeto(banco, Projeto.parse(cadastro(nome)));
    corpo(banco, raiz);
  } finally {
    fechar();
  }
}
const fotografarTabelas = (banco: DatabaseSync): unknown[] =>
  TABELAS.map((tabela) => banco.prepare(`SELECT * FROM ${tabela} ORDER BY 1, 2, 3`).all());

function gravarCompleta(banco: DatabaseSync): void {
  gravarProjeto(banco, completa);
  // A leitura ordena também a preparação já existente, mesmo que haja lacunas na posição.
  banco.exec(
    "DELETE FROM comando_preparacao_projeto WHERE projeto = 'a'; INSERT INTO comando_preparacao_projeto VALUES ('a', 10, 'segundo'), ('a', 2, 'primeiro')",
  );
}

test("projetoExistente devolve o projeto cadastrado", () => {
  comBanco((banco) => {
    assert.deepEqual(projetoExistente(banco, "a"), Projeto.parse(cadastro()));
  });
});

test("projetoExistente recusa o projeto inexistente, com a orientação padrão ou a de quem chama", () => {
  comBanco((banco) => {
    for (const [orientacao, mensagem] of [
      [undefined, "o projeto fantasma não existe (confira o nome do projeto)"],
      ["confira a execução", "o projeto fantasma não existe (confira a execução)"],
    ])
      assert.throws(
        () => projetoExistente(banco, "fantasma", orientacao),
        (erro) => erro instanceof ErroDeInexistente && erro.message === mensagem,
      );
  });
});

test("carregarProjeto recusa o projeto inexistente com a orientação de configurar", () => {
  comBanco((banco) => {
    assert.throws(
      () => carregarProjeto(banco, "fantasma"),
      (erro) =>
        erro instanceof ErroDeRegra &&
        erro.message === "o projeto fantasma não tem configuração do SDLC (configure o projeto)",
    );
    assert.throws(
      () => carregarProjeto(banco, "a"),
      (erro) =>
        erro instanceof ErroDeRegra &&
        erro.message === "o projeto a não tem configuração do SDLC (configure o projeto)",
    );
    gravarCompleta(banco);
    assert.deepEqual(carregarProjeto(banco, "a"), canonica);
  });
});

test("donoDoRepositorio acha só o outro projeto que usa o repositório; gravarProjeto atualiza o mesmo nome", () => {
  comBanco((banco) => {
    gravarProjeto(banco, Projeto.parse({ ...cadastro(), branch_base: "dev" }));
    assert.equal(listarProjetos(banco).length, 2);
    assert.equal(projetoExistente(banco, "a").branch_base, "dev");
    assert.equal(donoDoRepositorio(banco, "/repo/a", "outro"), "a");
    assert.equal(donoDoRepositorio(banco, "/repo/a", "a"), undefined);
    assert.equal(donoDoRepositorio(banco, "/inexistente", "a"), undefined);
  });
});

test("ida e volta completa, com listas na ordem canônica", () => {
  comBanco((banco) => {
    gravarCompleta(banco);
    assert.deepEqual(buscarProjeto(banco, "a"), canonica);
    assert.deepEqual(listarProjetos(banco), [canonica, Projeto.parse(cadastro("b"))]);
  });
});

test("a gravação SDLC mantém as etapas e a preparação gravadas pelo cadastro", () => {
  comBanco((banco) => {
    const ignoradas = gravarConfiguracaoSdlc(banco, completa);
    assert.deepEqual(ignoradas.etapas, []);
    assert.deepEqual(ignoradas.verificacoes.preparacao, []);
    gravarProjeto(banco, { ...completa, verificacoes: { ...completa.verificacoes, preparacao: ["uv sync"] } });
    const mantidas = gravarConfiguracaoSdlc(banco, ProjetoConfigurado.parse(minima()));
    assert.deepEqual(mantidas.etapas, canonica.etapas);
    assert.deepEqual(mantidas.verificacoes.preparacao, ["uv sync"]);
    assert.deepEqual(buscarProjeto(banco, "a")?.etapas, canonica.etapas);
  });
});

test("preparação: lida sem SDLC, substituída na ordem 1..n; a inválida não altera nada", () => {
  comBanco((banco) => {
    const projetoB = projetoExistente(banco, "b");
    assert.deepEqual(projetoB.verificacoes.preparacao, []);
    gravarProjeto(banco, {
      ...projetoB,
      verificacoes: { ...projetoB.verificacoes, preparacao: ["uv venv .venv", "uv sync"] },
    });
    assert.throws(() => carregarProjeto(banco, "b"), ErroDeRegra);
    assert.deepEqual(projetoExistente(banco, "b").verificacoes.preparacao, ["uv venv .venv", "uv sync"]);
    gravarCompleta(banco);
    const projetoA = projetoExistente(banco, "a");
    gravarProjeto(banco, { ...projetoA, verificacoes: { ...projetoA.verificacoes, preparacao: ["npm ci"] } });
    assert.deepEqual(buscarProjeto(banco, "a"), {
      ...canonica,
      verificacoes: { ...canonica.verificacoes, preparacao: ["npm ci"] },
    });
    assert.deepEqual(
      banco
        .prepare("SELECT ordem, comando FROM comando_preparacao_projeto WHERE projeto = 'b' ORDER BY ordem")
        .all()
        .map((comando) => ({ ...comando })),
      [
        { ordem: 1, comando: "uv venv .venv" },
        { ordem: 2, comando: "uv sync" },
      ],
    );
    const antes = fotografarTabelas(banco);
    assert.throws(() => {
      gravarProjeto(banco, { ...projetoA, verificacoes: { ...projetoA.verificacoes, preparacao: ["npm ci", ""] } });
    }, /CHECK/);
    assert.deepEqual(fotografarTabelas(banco), antes);
    assert.equal(banco.isTransaction, false);
    assert.deepEqual(projetoExistente(banco, "b").verificacoes.preparacao, ["uv venv .venv", "uv sync"]);
  });
});

test("etapas: lidas sem SDLC, substituídas; a inválida não altera nada", () => {
  comBanco((banco) => {
    const projetoB = projetoExistente(banco, "b");
    assert.deepEqual(projetoB.etapas, []);
    const etapasB = Projeto.parse({
      ...projetoB,
      etapas: [{ etapa: "ajustar_resultado", configuracao_agente: { effort: "max" } }],
    }).etapas;
    gravarProjeto(banco, { ...projetoB, etapas: etapasB });
    assert.throws(() => carregarProjeto(banco, "b"), ErroDeRegra);
    assert.deepEqual(projetoExistente(banco, "b").etapas, etapasB);
    gravarCompleta(banco);
    const substituido = Projeto.parse({
      ...completa,
      etapas: [{ etapa: "entender_e_desenhar", configuracao_agente: { modelo: { provedor: "p", nome: "m" } } }],
    });
    gravarProjeto(banco, substituido);
    assert.deepEqual(buscarProjeto(banco, "a"), { ...canonica, etapas: substituido.etapas });
    const antes = fotografarTabelas(banco);
    assert.throws(() => {
      gravarProjeto(
        banco,
        Projeto.parse({
          ...completa,
          etapas: [{ etapa: "planejar", configuracao_agente: { modelo: { provedor: "p" } } }],
        }),
      );
    }, /nome/);
    assert.deepEqual(fotografarTabelas(banco), antes);
    assert.equal(banco.isTransaction, false);
    assert.deepEqual(projetoExistente(banco, "b").etapas, etapasB);
  });
});

test("a leitura dentro de uma escrita faz parte dela, sem abrir outra transação", () => {
  comBanco((banco) => {
    gravarCompleta(banco);
    assert.deepEqual(
      escrever(banco, () => buscarProjeto(banco, "a")),
      canonica,
    );
    assert.deepEqual(
      escrever(banco, () => listarProjetos(banco)),
      [canonica, Projeto.parse(cadastro("b"))],
    );
  });
});

test("configuração mínima aplica defaults e trim; opcionais ficam ausentes", () => {
  comBanco((banco) => {
    const esperado = ProjetoConfigurado.parse(minima());
    gravarProjeto(banco, esperado);
    assert.deepEqual(buscarProjeto(banco, "a"), esperado);
    assert.equal(esperado.verificacoes.fitness[0]?.comando, "npm run f");
    assert.equal(Object.hasOwn(projetoExistente(banco, "a"), "link_produto"), false);
  });
});

test("mesmo nome de linguagem em caminhos distintos e leitura após reabrir", () => {
  comBanco((banco, raiz) => {
    gravarCompleta(banco);
    const outro = abrir(raiz);
    try {
      assert.deepEqual(
        projetoExistente(outro, "a").verificacoes.linguagens.map((linguagem) => linguagem.linguagem),
        ["ts", "ts"],
      );
      assert.deepEqual(buscarProjeto(outro, "a"), canonica);
    } finally {
      outro.close();
    }
  });
});

test("substituição SDLC remove listas opcionais e mantém etapas e preparação; gravação integral substitui todas", () => {
  comBanco((banco) => {
    gravarCompleta(banco);
    const nova = ProjetoConfigurado.parse({
      ...minima(),
      raiz_git: "/novo",
      hospedagem: "azure-devops",
      branch_base: "dev",
      chave_sonarqube: "k2",
    });
    const lida = gravarConfiguracaoSdlc(banco, nova);
    assert.deepEqual(buscarProjeto(banco, "a"), {
      ...nova,
      etapas: canonica.etapas,
      verificacoes: { ...nova.verificacoes, preparacao: canonica.verificacoes.preparacao },
    });
    assert.equal(lida.raiz_git, "/novo");
    assert.deepEqual(lida.etapas, canonica.etapas);
    assert.deepEqual(lida.verificacoes.preparacao, canonica.verificacoes.preparacao);
    assert.equal(banco.prepare("SELECT count(*) AS n FROM glob_e2e").get()?.n, 0);
    gravarProjeto(banco, { ...nova, link_produto: "https://produto.exemplo.com" });
    assert.deepEqual(buscarProjeto(banco, "a"), { ...nova, link_produto: "https://produto.exemplo.com" });
    gravarProjeto(banco, Projeto.parse(cadastro()));
    assert.deepEqual(buscarProjeto(banco, "a"), Projeto.parse(cadastro()));
  });
});

test("ausência: projeto inexistente lê undefined; cadastro sem SDLC é legível; upsert insere", () => {
  comBanco((banco) => {
    const antes = fotografarTabelas(banco);
    assert.deepEqual(buscarProjeto(banco, "a"), Projeto.parse(cadastro()));
    assert.equal(buscarProjeto(banco, "nao-existe"), undefined);
    assert.deepEqual(fotografarTabelas(banco), antes);
    assert.throws(
      () => gravarConfiguracaoSdlc(banco, ProjetoConfigurado.parse(minima("nao-existe"))),
      ErroDeInexistente,
    );
    assert.equal(banco.isTransaction, false);
    gravarProjeto(banco, ProjetoConfigurado.parse(minima("nao-existe")));
    assert.deepEqual(carregarProjeto(banco, "nao-existe"), ProjetoConfigurado.parse(minima("nao-existe")));
  });
});

test("entrada inválida é recusada pelo schema antes da gravação e não altera nada", () => {
  comBanco((banco) => {
    gravarCompleta(banco);
    const antes = fotografarTabelas(banco);
    assert.throws(() => {
      gravarProjeto(
        banco,
        ProjetoConfigurado.parse({ ...completa, verificacoes: { ...completa.verificacoes, linguagens: [] } }),
      );
    }, ZodError);
    assert.deepEqual(fotografarTabelas(banco), antes);
    assert.deepEqual(buscarProjeto(banco, "a"), canonica);
  });
});

test("erro tardio no INSERT de glob reverte tudo e libera a transação", () => {
  comBanco((banco) => {
    gravarCompleta(banco);
    const antes = fotografarTabelas(banco);
    banco.exec(
      "CREATE TRIGGER falha_glob BEFORE INSERT ON glob_e2e WHEN NEW.glob = 'boom' BEGIN SELECT RAISE(ABORT, 'falha de teste'); END",
    );
    const nova = ProjetoConfigurado.parse({
      ...minima(),
      branch_base: "dev",
      verificacoes: {
        ...minima().verificacoes,
        e2e: [{ caminho_linguagem: ".", comando_build: "b", comando_execucao: "e", codigo_falha: 3 }],
        globs: [{ caminho_linguagem: ".", glob: "boom" }],
      },
    });
    assert.throws(() => {
      gravarProjeto(banco, nova);
    }, /falha de teste/);
    assert.equal(banco.isTransaction, false);
    assert.deepEqual(fotografarTabelas(banco), antes);
    assert.deepEqual(buscarProjeto(banco, "a"), canonica);
    assert.throws(() => {
      gravarProjeto(banco, { ...nova, nome: "novo", raiz_git: "/novo" });
    }, /falha de teste/);
    assert.equal(buscarProjeto(banco, "novo"), undefined);
    assert.deepEqual(fotografarTabelas(banco), antes);
  });
});

test("repositório duplicado propaga o erro e preserva a configuração anterior", () => {
  comBanco((banco) => {
    gravarCompleta(banco);
    const antes = fotografarTabelas(banco);
    assert.throws(() => {
      gravarProjeto(banco, { ...completa, raiz_git: "/repo/b" });
    }, /UNIQUE/);
    assert.deepEqual(fotografarTabelas(banco), antes);
  });
});

test("projetos são isolados e campos comuns são compartilhados com o cadastro", () => {
  comBanco((banco) => {
    gravarCompleta(banco);
    gravarProjeto(banco, ProjetoConfigurado.parse(minima("b")));
    assert.deepEqual(buscarProjeto(banco, "a"), canonica);
    assert.equal(projetoExistente(banco, "b").verificacoes.fitness.length, 1);
    banco.exec("UPDATE projeto SET branch_base = 'outra' WHERE nome = 'a'");
    assert.equal(buscarProjeto(banco, "a")?.branch_base, "outra");
    gravarProjeto(banco, { ...completa, branch_base: "nova" });
    assert.equal(banco.prepare("SELECT branch_base FROM projeto WHERE nome = 'a'").get()?.branch_base, "nova");
  });
});

test("leitura é um snapshot: substituição commitada entre os SELECTs só aparece na leitura seguinte", () => {
  comBanco((banco, raiz) => {
    gravarCompleta(banco);
    const nova = ProjetoConfigurado.parse({
      ...minima(),
      branch_base: "dev",
      verificacoes: { ...minima().verificacoes, linguagens: [{ caminho: "web", linguagem: "ts", comando_teste: "t" }] },
    });
    const leitor = new DatabaseSync(join(raiz, "fabriquinha.db"));
    // eslint-disable-next-line @typescript-eslint/unbound-method -- restauração do método; chamada usa .call(leitor).
    const prepararConsulta = leitor.prepare;
    let escreveu = false;
    try {
      assert.equal(leitor.prepare("PRAGMA journal_mode").get()?.journal_mode, "wal");
      leitor.prepare = (sql: string) => {
        if (sql.includes("FROM linguagem_projeto") && !escreveu) {
          escreveu = true;
          gravarProjeto(banco, nova);
        }
        return prepararConsulta.call(leitor, sql);
      };
      assert.deepEqual(buscarProjeto(leitor, "a"), canonica);
      assert.ok(escreveu);
      assert.equal(leitor.isTransaction, false);
      assert.deepEqual(buscarProjeto(leitor, "a"), nova);
      assert.equal(leitor.isTransaction, false);
    } finally {
      leitor.prepare = prepararConsulta;
      leitor.close();
    }
  });
});

test("raiz_git relativa é recusada pelo schema sem mutação; cadastro e SDLC compartilham a raiz", () => {
  comBanco((banco) => {
    banco.exec("DELETE FROM projeto");
    registrarProjeto(banco, cadastro("loja"));
    registrarProjeto(banco, cadastro("outro"));
    const sdlc = ProjetoConfigurado.parse(minima("loja"));
    gravarConfiguracaoSdlc(banco, sdlc);
    const antes = fotografarTabelas(banco);
    assert.throws(
      () => gravarConfiguracaoSdlc(banco, ProjetoConfigurado.parse({ ...sdlc, raiz_git: "repo-relativo" })),
      (erro) => erro instanceof ZodError && erro.issues[0]?.message === "caminho absoluto",
    );
    assert.deepEqual(fotografarTabelas(banco), antes);
    assert.equal(banco.isTransaction, false);
    assert.equal(buscarProjeto(banco, "loja")?.raiz_git, "/repo/loja");
    assert.equal(listarProjetos(banco).length, 2);
    gravarConfiguracaoSdlc(banco, { ...sdlc, raiz_git: "/repos/nova" });
    assert.equal(buscarProjeto(banco, "loja")?.raiz_git, "/repos/nova");
    assert.equal(carregarProjeto(banco, "loja").raiz_git, "/repos/nova");
  });
});

test("cadastro edita preparação sem substituir as demais verificações", () => {
  comBanco((banco) => {
    gravarCompleta(banco);
    const editado = editarProjeto(banco, { ...completa, verificacoes: { preparacao: ["npm ci"] } });
    assert.deepEqual(editado.verificacoes, { ...canonica.verificacoes, preparacao: ["npm ci"] });
  });
});

test("execuções pendentes são isoladas por projeto; apagarProjeto devolve referências e só anexos órfãos", () => {
  comBanco((banco) => {
    gravarCompleta(banco);
    banco.exec(`
      INSERT INTO demanda (id, projeto, titulo, tipo, descricao, estado, estado_alterado_em, criada_por_ferramenta, criada_por_sessao, enviada, branch) VALUES
        ('I-1', 'a', 'A', 'problema', 'descrição', 'em_execucao', 'agora', 'pi', 's', 1, 'a'),
        ('I-2', 'b', 'B', 'problema', 'descrição', 'em_execucao', 'agora', 'pi', 's', 1, 'b');
      INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, estado, estado_alterado_em) VALUES
        ('I-1', 1, 'implementar', 'aberto', 'agora'), ('I-2', 1, 'implementar', 'em_execucao', 'agora');
      INSERT INTO sessao (id, demanda_id, ticket_id, modo, conversa_referencia) VALUES ('s1', 'I-1', 1, 'autonomo', 'conversa');
      INSERT INTO execucao_sessao (id, sessao_id, inicio, fim, falha) VALUES ('execucao', 's1', 'agora', NULL, 0);
      INSERT INTO usuario_simulado (id, projeto, nome, descricao) VALUES (1, 'a', 'Maria', 'd'), (2, 'b', 'João', 'd');
      INSERT INTO tarefa (id, projeto, texto, n, criada_em) VALUES (1, 'a', 't', 1, 'agora'), (2, 'b', 't', 1, 'agora');
      INSERT INTO tarefa_usuario VALUES (1, 1), (2, 2);
      INSERT INTO execucao_simulada (id, tarefa, usuario, status) VALUES (1, 1, 1, 'na_fila'), (2, 2, 2, 'na_fila');
      INSERT INTO evidencia_demanda (id, demanda_id, tipo, em) VALUES ('ev1', 'I-1', 'comportamento', 'agora'), ('ev2', 'I-2', 'comportamento', 'agora');
      INSERT INTO arquivo_evidencia VALUES
        ('ev1', 1, 'orfao.txt', '${"a".repeat(64)}', 'text/plain', 1),
        ('ev1', 2, 'compartilhado.txt', '${"b".repeat(64)}', 'text/plain', 1),
        ('ev1', 3, 'usuario.txt', '${"c".repeat(64)}', 'text/plain', 1),
        ('ev2', 1, 'compartilhado.txt', '${"b".repeat(64)}', 'text/plain', 1);
      INSERT INTO usuario_simulado_anexo VALUES (2, 'usuario.txt', '${"c".repeat(64)}', 1);
    `);
    assert.deepEqual({ ...ticketEmAndamentoDoProjeto(banco, "a") }, { demanda_id: "I-1", ticket_id: 1 });
    banco.exec("UPDATE execucao_sessao SET fim = 'depois'");
    assert.equal(ticketEmAndamentoDoProjeto(banco, "a"), undefined);
    banco.exec("UPDATE ticket_demanda SET estado = 'em_execucao' WHERE demanda_id = 'I-1'");
    assert.deepEqual({ ...ticketEmAndamentoDoProjeto(banco, "a") }, { demanda_id: "I-1", ticket_id: 1 });
    assert.equal(tarefaComExecucaoSimuladaPendente(banco, "a"), "1");
    banco.exec("UPDATE execucao_simulada SET status = 'em_andamento' WHERE id = 1");
    assert.equal(tarefaComExecucaoSimuladaPendente(banco, "a"), "1");
    banco.exec("UPDATE execucao_simulada SET status = 'falhou', erro = 'fim' WHERE id = 1");
    assert.equal(tarefaComExecucaoSimuladaPendente(banco, "a"), undefined);
    assert.deepEqual(
      escrever(banco, () => apagarProjeto(banco, "a")),
      {
        execucoes: ["execucao"],
        sessoes: ["conversa"],
        simuladas: [1],
        orfaos: ["a".repeat(64)],
      },
    );
    assert.equal(buscarProjeto(banco, "a"), undefined);
    assert.ok(buscarProjeto(banco, "b"));
    assert.equal(tarefaComExecucaoSimuladaPendente(banco, "b"), "2");
    assert.deepEqual({ ...ticketEmAndamentoDoProjeto(banco, "b") }, { demanda_id: "I-2", ticket_id: 1 });
    for (const tabela of TABELAS.slice(1))
      assert.equal(
        banco.prepare(`SELECT count(*) AS quantidade FROM ${tabela} WHERE projeto = 'a'`).get()?.quantidade,
        0,
      );
    assert.deepEqual(banco.prepare("PRAGMA foreign_key_check").all(), []);
  });
});

test("apagarProjeto remove as Tentativas antes dos tickets sem deixar referências quebradas", () => {
  comBanco((banco) => {
    const agora = "2026-01-01T00:00:00.000Z";
    criarDemandaNova(banco, (id) =>
      iniciarTentativaDoTicket(
        registrarDemanda(
          {
            id,
            projeto: "a",
            titulo: "com Tentativa",
            descricao: "d",
            tipo: "problema",
          },
          { tipo: "externo", ferramenta: "pi", sessao: "s1" },
          { agora },
        ),
        { ticket_id: 1, processo_id: "exec-1" },
        FABRIQUINHA,
        { agora },
      ),
    );
    assert.equal(banco.prepare("SELECT count(*) AS quantidade FROM tentativa").get()?.quantidade, 1);
    escrever(banco, () => apagarProjeto(banco, "a"));
    assert.equal(buscarProjeto(banco, "a"), undefined);
    assert.ok(buscarProjeto(banco, "b"));
    assert.deepEqual(banco.prepare("SELECT * FROM tentativa").all(), []);
    assert.deepEqual(banco.prepare("SELECT * FROM ticket_demanda").all(), []);
    assert.deepEqual(banco.prepare("PRAGMA foreign_key_check").all(), []);
  });
});

test("listarProjetos vazio e apagarProjeto inexistente não inventam registros", () => {
  comBanco((banco) => {
    apagarProjeto(banco, "a");
    apagarProjeto(banco, "b");
    assert.deepEqual(listarProjetos(banco), []);
    assert.deepEqual(apagarProjeto(banco, "fantasma"), { execucoes: [], sessoes: [], simuladas: [], orfaos: [] });
    assert.equal(ticketEmAndamentoDoProjeto(banco, "fantasma"), undefined);
    assert.equal(tarefaComExecucaoSimuladaPendente(banco, "fantasma"), undefined);
  });
});
