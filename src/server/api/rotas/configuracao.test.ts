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
import { fabricaDeBancosTemporarios } from "../../../../apoio-testes/banco/banco_temporario.ts";
import { instalarDockerFalso } from "../../../../apoio-testes/falsos/docker_falso.ts";
import { instalarPiFalso, type PassoPi } from "../../../../apoio-testes/falsos/pi_falso.ts";
import { Projeto } from "../../../modulos/demandas/publico.ts";
import { relogioDoSistema } from "../../../shared/nucleo/relogio.ts";
import { inserirAmbienteAlocado, liberarAmbiente } from "../../../../apoio-testes/falsos/ambiente_falso.ts";
import { cursorDaBase } from "../../../modulos/repositorio/publico.ts";
import { casar } from "../../web/compartilhado/caminhos.ts";
import { traduzir } from "../erros.ts";
import type { AmbientesDoServico } from "../rotas.ts";
import { ROTAS } from "../servidor.ts";
import { montarAmbientesDoServico } from "../../composicao/ambientes_do_servico.ts";
import { noLog } from "../../../shared/infra/registro.ts";
import { buscarProjeto, gravarProjeto } from "../../../../apoio-testes/demandas_de_teste.ts";
import { montarDemandasDoBanco } from "../../composicao/banco_da_fabriquinha.ts";

// realpath: a conferência do F5 compara o caminho do repositório literalmente, e o tmpdir pode ser um symlink.
const base = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-config-")));
after(() => {
  rmSync(base, { recursive: true, force: true });
});

const gitconfig = join(base, "gitconfig");
writeFileSync(gitconfig, "[user]\n\tname = Auditor\n\temail = auditor@exemplo.com\n");
process.env.GIT_CONFIG_GLOBAL = gitconfig;
process.env.GIT_CONFIG_NOSYSTEM = "1";

// gh autenticado na frente do PATH e pi com dois modelos.
const bin = join(base, "bin");
mkdirSync(bin);
writeFileSync(join(bin, "gh"), "#!/bin/sh\nexit 0\n");
chmodSync(join(bin, "gh"), 0o755);
process.env.PATH = `${bin}:${process.env.PATH ?? ""}`;
const piFalso = instalarPiFalso(base);
const modelos: PassoPi = {
  listaDeModelos: {
    tabela:
      "provider   model              context  max-out  thinking  images\n" +
      "anthropic  claude-opus-5-5    200K     64K      yes       yes\n" +
      "llamacpp   qwen3-coder-30b    32.8K    8.2K     yes       no\n",
  },
};

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

const abrirBancoTemporario = fabricaDeBancosTemporarios();
let banco: DatabaseSync;
let ambientes: AmbientesDoServico;
beforeEach(async () => {
  const aberto = abrirBancoTemporario();
  banco = aberto.banco;
  ambientes = await montarAmbientesDoServico({ banco, raiz: aberto.raiz, porta: 0, registrarErro: noLog });
  piFalso.roteirizar([modelos]);
});

const PROXIMA = new Date("2026-10-12T14:35:00.000Z");

/** Chama a rota como o servidor: o valor devolvido, ou `[status, mensagem]` do erro traduzido. */
async function chamar(metodo: string, caminho: string, corpo?: unknown): Promise<unknown> {
  for (const rota of ROTAS) {
    const params = rota.metodo === metodo ? casar(rota.caminho, caminho) : undefined;
    if (!params) continue;
    let valor: unknown;
    try {
      valor = await rota.tratar({
        banco,
        agendador: { proximaBusca: () => PROXIMA },
        ambientes,
        demandas: montarDemandasDoBanco(banco),
        relogio: relogioDoSistema,
        params,
        query: new URLSearchParams(),
        corpo,
        cabecalhos: {},
        resposta: undefined as unknown as ServerResponse,
      });
    } catch (erro) {
      return traduzir(erro);
    }
    // CA-3: o corpo 2xx em JSON passa pelo schema do contrato da rota; sem schema, o teste nomeia a rota.
    if (valor !== undefined) {
      assert.ok(rota.resposta, `${rota.metodo} ${rota.caminho} sem schema de resposta em contrato/`);
      rota.resposta.parse(valor);
    }
    return valor;
  }
  throw new Error(`${metodo} ${caminho} não existe`);
}

/** O cadastro como o formulário manda, sem os campos do fluxo legado (CA-13) e com as etapas no padrão do pi. */
const formulario = (repo: string) => ({
  nome: "loja",
  raiz_git: repo,
  branch_base: "main",
  preparacao: [],
  configuracoes: {},
});

/** O projeto gravado do `formulario`, como a rota o devolve: a hospedagem deduzida e a chave do SonarQube com o nome. */
const gravado = (repo: string) => ({
  nome: "loja",
  raiz_git: repo,
  branch_base: "main",
  hospedagem: "github",
  chave_sonarqube: "loja",
  etapas: [],
  verificacoes: { preparacao: [], fitness: [], linguagens: [], e2e: [], globs: [] },
  configuracoes: {},
});

/** O `gravado` como `buscarProjeto()` o lê do banco, sem a projeção do formulário. */
function noBanco(repo: string) {
  const { configuracoes: _configuracoes, ...cadastro } = gravado(repo);
  return cadastro;
}

const etapasGravadas = () =>
  banco
    .prepare("SELECT * FROM configuracao_etapa_projeto ORDER BY etapa")
    .all()
    .map((l) => ({ ...l }));

test("configuração: o F4 §3 com a próxima busca só ligado, sem as execuções autônomas (CA-13)", async () => {
  assert.deepEqual(await chamar("GET", "/api/configuracao"), {
    agendadorAtivo: false,
    intervaloMin: 5,
    timeoutMin: 120,
    ociosidadeMin: 30,
    proximaBusca: null,
  });
  const salvo = { agendadorAtivo: true, intervaloMin: 10, timeoutMin: 60, ociosidadeMin: 15 };
  assert.deepEqual(await chamar("POST", "/api/configuracao", salvo), { ...salvo, proximaBusca: PROXIMA.toISOString() });
  assert.deepEqual(await chamar("GET", "/api/configuracao"), { ...salvo, proximaBusca: PROXIMA.toISOString() });
});

test("o modelo das avaliações saiu com a Avaliação (ticket 02): mandá-lo dá 422 e nada muda", async () => {
  const antes = await chamar("GET", "/api/configuracao");
  const [status, erro] = (await chamar("POST", "/api/configuracao", {
    modeloAuditoria: { provedor: "anthropic", nome: "claude-opus-5-5" },
  })) as [number, string];
  assert.equal(status, 422);
  assert.match(erro, /modeloAuditoria/);
  assert.deepEqual(await chamar("GET", "/api/configuracao"), antes);
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
    { provedor: "anthropic", nome: "claude-opus-5-5" },
    { provedor: "llamacpp", nome: "qwen3-coder-30b" },
  ]);
});

test("cadastrar: confere, grava com a hospedagem deduzida do remoto e fixa o cursor inicial da base", async () => {
  const repo = clone();
  const lido = gravado(repo);
  assert.deepEqual(
    await chamar("POST", "/api/projetos", { ...formulario(repo), hospedagem: "azure-devops" }),
    gravado(repo),
  );
  assert.deepEqual(buscarProjeto(banco, "loja"), noBanco(repo));
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

test("CA-13: o cadastro não aceita testes, SonarQube, fitness nem as etapas do fluxo legado; nada é gravado", async () => {
  const repo = clone();
  for (const legado of [
    { testes: ["npm test"] },
    { sonar: {} },
    { fitness: [{ nome: "f", comando: "true", descricao: "d" }] },
    { configuracoes: { desenho: { modelo: { provedor: "anthropic", nome: "claude-opus-5-5" } } } },
    { configuracoes: { desenho: { effort: "high" } } },
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

test("modelo e effort por etapa: grava só as etapas escolhidas e as devolve no GET; o modelo novo ou trocado é conferido no pi", async () => {
  const repo = clone();
  const opus = { provedor: "anthropic", nome: "claude-opus-5-5" };
  const qwen = { provedor: "llamacpp", nome: "qwen3-coder-30b" };
  const escolhidos = {
    configuracoes: {
      planejar: { modelo: opus, effort: "high" },
      implementar: { modelo: qwen },
      revisar_rodada: { effort: "low" },
    },
  };
  assert.deepEqual(await chamar("POST", "/api/projetos", { ...formulario(repo), ...escolhidos }), {
    ...gravado(repo),
    ...escolhidos,
    etapas: [
      { etapa: "planejar", configuracao_agente: escolhidos.configuracoes.planejar },
      { etapa: "implementar", configuracao_agente: escolhidos.configuracoes.implementar },
      { etapa: "revisar_rodada", configuracao_agente: escolhidos.configuracoes.revisar_rodada },
    ],
  });
  const linhas = [
    {
      projeto: "loja",
      etapa: "implementar",
      modelo_provedor: "llamacpp",
      modelo_nome: "qwen3-coder-30b",
      effort: null,
    },
    {
      projeto: "loja",
      etapa: "planejar",
      modelo_provedor: "anthropic",
      modelo_nome: "claude-opus-5-5",
      effort: "high",
    },
    { projeto: "loja", etapa: "revisar_rodada", modelo_provedor: null, modelo_nome: null, effort: "low" },
  ];
  assert.deepEqual(etapasGravadas(), linhas);
  const etapas = [
    { etapa: "implementar", configuracao_agente: escolhidos.configuracoes.implementar },
    { etapa: "planejar", configuracao_agente: escolhidos.configuracoes.planejar },
    { etapa: "revisar_rodada", configuracao_agente: escolhidos.configuracoes.revisar_rodada },
  ];
  assert.deepEqual(await chamar("GET", "/api/projetos/loja"), { ...gravado(repo), ...escolhidos, etapas });
  assert.deepEqual(await chamar("GET", "/api/projetos"), [{ ...gravado(repo), ...escolhidos, etapas }]);

  // O par que o pi não lista dá 422 no campo da etapa; nem o cadastro nem as etapas mudam.
  assert.deepEqual(
    await chamar("POST", "/api/projetos/loja", {
      ...formulario(repo),
      preparacao: ["npm ci"],
      configuracoes: {
        ...escolhidos.configuracoes,
        entender_e_desenhar: { modelo: { provedor: "inexistente", nome: "xyz" } },
      },
    }),
    [
      422,
      "✖ o modelo inexistente/xyz não existe no pi (escolha um par listado por pi --list-models)\n  → at configuracoes.entender_e_desenhar.modelo",
    ],
  );
  assert.deepEqual(buscarProjeto(banco, "loja")?.verificacoes.preparacao, []);
  assert.deepEqual(etapasGravadas(), linhas);

  // Com o pi quebrado: o modelo igual ao gravado salva sem chamá-lo, e o trocado é rejeitado.
  piFalso.roteirizar([{ listaDeModelos: { codigo: 1 } }]);
  try {
    assert.deepEqual(
      await chamar("POST", "/api/projetos/loja", {
        ...formulario(repo),
        configuracoes: { planejar: { modelo: opus } },
      }),
      {
        ...gravado(repo),
        configuracoes: { planejar: { modelo: opus } },
        etapas: [{ etapa: "planejar", configuracao_agente: { modelo: opus } }],
      },
    );
    assert.deepEqual(etapasGravadas(), [
      {
        projeto: "loja",
        etapa: "planejar",
        modelo_provedor: "anthropic",
        modelo_nome: "claude-opus-5-5",
        effort: null,
      },
    ]);
    const [status, erro] = (await chamar("POST", "/api/projetos/loja", {
      ...formulario(repo),
      configuracoes: { planejar: { modelo: qwen } },
    })) as [number, string];
    assert.equal(status, 422);
    assert.match(erro, /o pi falhou ao listar os modelos[^]*→ at configuracoes\.planejar\.modelo$/);
  } finally {
    piFalso.roteirizar([modelos]);
  }
  // Tudo no padrão do pi: nenhuma linha de etapa fica.
  await chamar("POST", "/api/projetos/loja", formulario(repo));
  assert.deepEqual(etapasGravadas(), []);
  // A etapa sem modelo nem effort escolhido também não deixa linha.
  await chamar("POST", "/api/projetos/loja", { ...formulario(repo), configuracoes: { planejar: {} } });
  assert.deepEqual(etapasGravadas(), []);
  // Linha de etapa sem coluna preenchida (gravada fora do cadastro) não vira configuração no formulário.
  banco.prepare("INSERT INTO configuracao_etapa_projeto (projeto, etapa) VALUES ('loja', 'planejar')").run();
  assert.deepEqual(await chamar("GET", "/api/projetos/loja"), {
    ...gravado(repo),
    configuracoes: {},
    etapas: [{ etapa: "planejar" }],
  });
});

test("as etapas do cadastro e a configuração SDLC não se apagam: cada gravação substitui só o que é dela", async () => {
  const repo = clone();
  await chamar("POST", "/api/projetos", formulario(repo));
  gravarProjeto(
    banco,
    Projeto.parse({
      nome: "loja",
      branch_base: "main",
      chave_sonarqube: "loja",
      raiz_git: repo,
      hospedagem: "github",
      verificacoes: {
        fitness: [{ nome: "cobertura", comando: "npm run cobertura", descricao: "Cobertura mínima." }],
        linguagens: [{ caminho: ".", linguagem: "typescript", comando_teste: "npm test" }],
      },
    }),
  );
  await chamar("POST", "/api/projetos/loja", {
    ...formulario(repo),
    configuracoes: { implementar: { effort: "max" } },
  });
  const lida = montarDemandasDoBanco(banco).projeto("loja");
  assert.deepEqual(lida.etapas, [{ etapa: "implementar", configuracao_agente: { effort: "max" } }]);
  assert.equal(lida.verificacoes.linguagens.length, 1);

  const { etapas: _etapas, ...semEtapas } = lida;
  const salva = (await chamar("POST", "/api/projetos/loja/configuracao-sdlc", {
    ...semEtapas,
    branch_base: "main",
  })) as {
    configuracao: { etapas: unknown };
  };
  assert.deepEqual(salva.configuracao.etapas, [{ etapa: "implementar", configuracao_agente: { effort: "max" } }]);
  assert.deepEqual(etapasGravadas(), [
    { projeto: "loja", etapa: "implementar", modelo_provedor: null, modelo_nome: null, effort: "max" },
  ]);
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
    verificacoes: { ...gravado(repo).verificacoes, preparacao: ["npm ci"] },
  });
  assert.deepEqual(buscarProjeto(banco, "loja")?.verificacoes.preparacao, ["npm ci"]);
  assert.equal(buscarProjeto(banco, "outro"), undefined);
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
  assert.match(erro, /✖ caminho absoluto\n {2}→ at raiz_git/);
  assert.match(erro, /→ at preparacao\[0\]/);
  assert.deepEqual(await chamar("GET", "/api/projetos"), []);
});

test("o formulário do projeto não tem mais o link do produto da Simulação (ticket 02): mandá-lo dá 422", async () => {
  const [status, erro] = (await chamar("POST", "/api/projetos", {
    ...formulario(clone()),
    link_produto: "https://demo.exemplo.com",
  })) as [number, string];
  assert.equal(status, 422);
  assert.match(erro, /link_produto/);
  assert.equal(buscarProjeto(banco, "loja"), undefined);
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
  INSERT INTO demanda (id, projeto, titulo, tipo, descricao, estado, estado_alterado_em, criada_por_ferramenta, criada_por_sessao, enviada, branch) VALUES ('I-1', 'loja', 'Busca', 'problema', 'd', 'em_execucao', '2026-10-12T14:00:00.000Z', 'f', 's', 1, 'fabriquinha/I-1');
    INSERT INTO processo_demanda (demanda_id, estado, estado_alterado_em, branch) SELECT id, estado, estado_alterado_em, branch FROM demanda WHERE estado IS NOT NULL AND id NOT IN (SELECT demanda_id FROM processo_demanda);
  INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, estado, estado_alterado_em)
    VALUES ('I-1', 1, 'implementar', '${andamento ? "em_execucao" : "concluido"}', '2026-10-12T14:00:00.000Z');
  INSERT INTO trabalho_agentico VALUES ('s', 'I-1', 1, 'autonomo', 's');
  INSERT INTO processo_do_trabalho (id, trabalho_id, inicio, fim, falha)
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

const AMBIENTE_PADRAO = {
  tipo: "host_local",
  memoria_maxima_mb: 2048,
  cpus: 2,
  ociosidade_para_eliminar_min: 60,
  conjunto: "variavel",
  capacidade_do_conjunto: null,
  minimo_do_conjunto: 0,
};

test("ambiente: o padrão é host_local com o conjunto vazio; salvar grava e um valor inválido dá 422 sem mudar nada", async () => {
  assert.deepEqual(await chamar("GET", "/api/ambiente"), { configuracao: AMBIENTE_PADRAO, conjunto: [] });
  const salvo = {
    tipo: "container",
    memoria_maxima_mb: 1024,
    cpus: 1.5,
    ociosidade_para_eliminar_min: 15,
    conjunto: "fixo",
    capacidade_do_conjunto: 3,
    minimo_do_conjunto: 0,
  };
  assert.deepEqual(await chamar("POST", "/api/ambiente", salvo), { configuracao: salvo, conjunto: [] });

  const [status, erro] = (await chamar("POST", "/api/ambiente", { ...salvo, memoria_maxima_mb: 100 })) as [
    number,
    string,
  ];
  assert.equal(status, 422);
  assert.match(erro, /→ at memoria_maxima_mb/);
  const [statusDoFixo, erroDoFixo] = (await chamar("POST", "/api/ambiente", {
    ...salvo,
    capacidade_do_conjunto: null,
  })) as [number, string];
  assert.equal(statusDoFixo, 422);
  assert.match(erroDoFixo, /✖ o conjunto fixo precisa de uma capacidade\n {2}→ at capacidade_do_conjunto/);
  assert.deepEqual(await chamar("GET", "/api/ambiente"), { configuracao: salvo, conjunto: [] });
});

test("ambiente: a lista traz só o conjunto da Fabriquinha; eliminar remove o livre e recusa o alocado, sem tocar nos outros containers", async () => {
  const docker = instalarDockerFalso(join(base, "docker"));
  const sonarqube = docker.semearContainer({ imagem: "sonarqube" });
  const doUsuario = docker.semearContainer({ imagem: "postgres" });
  const livre = docker.semearContainer({ rotulos: { "fabriquinha.ambiente": "a-livre" } });
  const alocado = docker.semearContainer({
    rotulos: { "fabriquinha.ambiente": "a-alocado" },
    uso: { cpu: "50.00%", memoria: "512MiB / 2GiB" },
  });
  for (const [id, container_id, alocado_para] of [
    ["a-livre", livre.id, "I-2"],
    ["a-alocado", alocado.id, "I-1"],
  ] as const)
    inserirAmbienteAlocado(banco, {
      id,
      container_id,
      imagem: "alpine",
      alocado_para,
      criado_em: "2026-11-09T10:00:00.000Z",
    });
  liberarAmbiente(banco, "a-livre", "livre", "2026-11-09T11:00:00.000Z");

  const { conjunto } = (await chamar("GET", "/api/ambiente")) as { conjunto: { id: string; estado: string }[] };
  assert.deepEqual(
    conjunto.map(({ id, estado }) => ({ id, estado })),
    [
      { id: "a-livre", estado: "livre" },
      { id: "a-alocado", estado: "alocado" },
    ],
  );

  assert.equal(
    docker.registro().some(([comando]) => comando === "stats"),
    false,
    "no host_local, o docker não mede",
  );
  const comoContainer = { ...AMBIENTE_PADRAO, tipo: "container" };
  const medido = (await chamar("POST", "/api/ambiente", comoContainer)) as { conjunto: { medido?: unknown }[] };
  assert.deepEqual(
    medido.conjunto.map((ambiente) => ambiente.medido),
    [
      { cpus: 0, memoria_mb: 0 },
      { cpus: 0.5, memoria_mb: 512 },
    ],
    "a configuração gravada vale na pergunta seguinte da gestão, e a lista traz o medido",
  );

  const [status, erro] = (await chamar("DELETE", "/api/ambiente/a-alocado")) as [number, string];
  assert.equal(status, 409);
  assert.match(erro, /está alocado a I-1/);
  assert.equal(await chamar("DELETE", "/api/ambiente/a-livre"), undefined);
  const restante = (await chamar("GET", "/api/ambiente")) as { conjunto: { id: string }[] };
  assert.deepEqual(
    restante.conjunto.map(({ id }) => id),
    ["a-alocado"],
  );

  assert.deepEqual(
    docker.registro().filter(([comando]) => comando === "rm"),
    [["rm", "--force", livre.id]],
  );
  const idsMexidos = docker.registro().flat();
  assert.ok(!idsMexidos.includes(sonarqube.id) && !idsMexidos.includes(doUsuario.id));
});
