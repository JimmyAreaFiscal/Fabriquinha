// Configuração (F7 §4.4; I-247 CA-13): cadastrar um projeto com um campo inválido, corrigir, salvar e ligar o
// agendador; o cadastro grava o projeto sem colunas do fluxo legado, com a chave do SonarQube no nome dele.
import type { TestInfo } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { inserirAmbienteAlocado, liberarAmbiente } from "../../apoio-testes/falsos/ambiente_falso.ts";
import { abrirBancoDaFabriquinha } from "../../src/server/system/banco_da_fabriquinha.ts";
import { salvarConfiguracaoDoAmbiente } from "../../src/shared/armazenamento/configuracao_do_ambiente.ts";
import { ConfiguracaoDoAmbiente } from "../../src/shared/nucleo/configuracao_do_ambiente.ts";
import { expect, fotografar, projeto, test } from "../apoio.ts";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" });

/** Clone com `origin` de cara GitHub; um `insteadOf` local desvia o acesso para um bare no disco, com `main`. */
function clone(raiz: string): string {
  const bare = join(raiz, "origin.git");
  const repo = join(raiz, "loja");
  mkdirSync(bare);
  mkdirSync(repo);
  git(bare, "init", "--bare", "-q");
  git(repo, "init", "-q", "-b", "main");
  git(repo, "-c", "user.name=x", "-c", "user.email=x@x", "commit", "-q", "--allow-empty", "-m", "início");
  git(repo, "push", "-q", bare, "HEAD:refs/heads/main");
  git(repo, "remote", "add", "origin", "https://github.com/dono/loja.git");
  git(repo, "config", `url.${bare}.insteadOf`, "https://github.com/dono/loja.git");
  return realpathSync(repo);
}

test("cadastra um projeto com um campo inválido, corrige, salva e liga o agendador; sem os campos legados (CA-13)", async ({
  pagina,
  fabriquinha,
}, info: TestInfo) => {
  const repo = clone(fabriquinha.raiz);
  await pagina.goto(`${fabriquinha.base}/config`);
  await expect(pagina).toHaveTitle("Configuração · Fabriquinha");
  const menu = pagina.getByRole("navigation", { name: "Configuração" });
  await expect(menu.getByRole("link", { name: "Agendador" })).toHaveAttribute("aria-current", "page");
  await expect(menu.getByRole("link", { name: "Agendador" })).toContainText("desligado");
  await expect(pagina.locator(".status-ag")).toHaveText("Desligado: não procura tickets");

  await menu.getByRole("link", { name: "+ Novo projeto" }).click();
  await expect(pagina).toHaveURL(`${fabriquinha.base}/config?novo`);
  await expect(pagina.getByRole("heading", { name: "Novo projeto" })).toBeVisible();
  await expect(pagina.getByLabel("Hospedagem")).toHaveValue("deduzida do remoto ao salvar");
  const formulario = pagina.locator("form[data-projeto]");
  await expect(formulario.locator("h3")).toHaveText(["Repositório", "Preparação", /^Modelo e effort por etapa/]);
  await expect(formulario).not.toContainText(/Testes|SonarQube|Fitness/);
  await pagina.getByLabel("Nome", { exact: true }).fill("Loja X");
  await pagina.getByLabel("Caminho do repositório").fill(repo);
  await pagina.getByRole("button", { name: "+ comando" }).click();
  await pagina.getByLabel("Preparação da worktree: comando 1").fill("npm ci");
  // O projeto novo já escolhe o modelo e o effort de uma etapa; as outras ficam no padrão do pi.
  const planejar = pagina.getByLabel("Planejar", { exact: true });
  await planejar.selectOption("anthropic/claude-opus-5-5");
  await pagina.getByLabel("Effort de Planejar").selectOption("high");

  await pagina.getByRole("button", { name: "Cadastrar projeto" }).click();
  const nome = pagina.getByLabel("Nome", { exact: true });
  await expect(nome).toHaveAttribute("aria-invalid", "true");
  await expect(pagina.locator(".campo", { has: nome }).locator(".msg-erro")).toHaveText(
    "use letras minúsculas, números e hífen, começando por letra ou número (até 64)",
  );
  await expect(pagina.locator(".rodape-form")).toContainText("1 campo com erro");
  await expect(pagina.getByLabel("Preparação da worktree: comando 1")).toHaveValue("npm ci");
  await expect(planejar).toHaveValue("anthropic/claude-opus-5-5");

  await nome.fill("loja");
  await pagina.getByRole("button", { name: "Cadastrar projeto" }).click();
  await expect(pagina).toHaveURL(`${fabriquinha.base}/config?projeto=loja`);
  await expect(pagina.getByRole("heading", { level: 2, name: /^loja/ })).toBeVisible();
  await expect(menu.getByRole("link", { name: "loja" })).toHaveAttribute("aria-current", "page");
  await expect(menu.getByRole("link", { name: "loja" })).toContainText("GitHub");
  await expect(pagina.getByLabel("Nome", { exact: true })).toHaveAttribute("readonly", "");
  await expect(pagina.getByLabel("Hospedagem")).toHaveValue("GitHub");
  await expect(pagina.getByLabel("Preparação da worktree: comando 1")).toHaveValue("npm ci");
  await expect(planejar).toHaveValue("anthropic/claude-opus-5-5");
  await expect(pagina.getByLabel("Effort de Planejar")).toHaveValue("high");
  await expect(pagina.getByLabel("Effort de Implementar")).toHaveValue("");
  await expect(pagina.getByRole("button", { name: "Salvar projeto" })).toBeVisible();
  const banco = abrirBancoDaFabriquinha(fabriquinha.raiz);
  expect({ ...banco.prepare("SELECT * FROM projeto WHERE nome = 'loja'").get() }).toEqual({
    nome: "loja",
    raiz_git: expect.any(String),
    branch_base: "main",
    hospedagem: "github",
    chave_sonarqube: "loja",
    link_produto: null,
    imagem_do_ambiente: null,
  });
  // A preparação vai para a tabela que o fluxo da demanda lê ao criar a worktree.
  expect({ ...banco.prepare("SELECT * FROM comando_preparacao_projeto").get() }).toEqual({
    projeto: "loja",
    ordem: 1,
    comando: "npm ci",
  });
  expect({ ...banco.prepare("SELECT * FROM configuracao_etapa_projeto").get() }).toEqual({
    projeto: "loja",
    etapa: "planejar",
    modelo_provedor: "anthropic",
    modelo_nome: "claude-opus-5-5",
    effort: "high",
  });
  banco.close();
  for (const largura of [1440, 375]) {
    await pagina.setViewportSize({ width: largura, height: 900 });
    expect(await pagina.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await fotografar(pagina, info, `configuracao-projeto-${String(largura)}`);
  }
  await pagina.setViewportSize({ width: 1440, height: 900 });

  await menu.getByRole("link", { name: "Agendador" }).click();
  await expect(pagina.getByText("Desligado: não procura tickets")).toBeVisible();
  await pagina.getByText("procura tickets abertos das demandas e os executa").click();
  await pagina.getByRole("spinbutton", { name: "Procurar a cada" }).fill("10");
  await pagina.getByRole("button", { name: "Salvar" }).click();
  await expect(menu.getByRole("link", { name: "Agendador" })).toContainText("ligado");
  await expect(pagina.locator(".status-ag")).toHaveText(/^Próxima busca às \d\d:\d\d$/);
  await expect(pagina.getByRole("spinbutton", { name: "Procurar a cada" })).toHaveValue("10");
  await expect(pagina.getByRole("checkbox", { name: /Agendador/ })).toBeChecked();
  for (const largura of [1440, 375]) {
    await pagina.setViewportSize({ width: largura, height: 900 });
    expect(await pagina.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await fotografar(pagina, info, `configuracao-agendador-${String(largura)}`);
  }
});

test("a Configuração não tem mais Avaliações nem o link do produto e os usuários simulados da Simulação (ticket 02)", async ({
  pagina,
  fabriquinha,
}) => {
  projeto(fabriquinha.raiz);
  await pagina.goto(`${fabriquinha.base}/config?avaliacoes`);
  const menu = pagina.getByRole("navigation", { name: "Configuração" });
  await expect(menu.getByRole("link", { name: "Agendador" })).toHaveAttribute("aria-current", "page");
  await expect(menu.getByRole("link", { name: "Avaliações" })).toHaveCount(0);
  await menu.getByRole("link", { name: "loja" }).click();
  await expect(pagina.getByRole("button", { name: "Salvar projeto" })).toBeVisible();
  await expect(pagina.getByLabel("Link do produto")).toHaveCount(0);
  await expect(pagina.getByText("Usuários simulados")).toHaveCount(0);
});

/** As nove etapas do ticket, na ordem do formulário. */
const ETAPAS = [
  "Demanda",
  "Planejar",
  "Implementar",
  "Revisar rodada",
  "Encerrar rodada",
  "Sessão em aberto",
  "Revisar demanda",
  "Encerrar demanda",
  "Resolver conflito",
];

test("escolhe o modelo e o effort de cada etapa no cadastro do projeto, salva e vê o mesmo; o modelo que o pi deixou de listar fica", async ({
  pagina,
  fabriquinha,
}, info: TestInfo) => {
  projeto(
    fabriquinha.raiz,
    `INSERT INTO configuracao_etapa_projeto VALUES ('loja', 'planejar', 'anthropic', 'claude-antigo', NULL),
       ('loja', 'revisar_rodada', NULL, NULL, 'high')`,
  );
  // A conferência do cadastro deduz a hospedagem do remoto: um `origin` de cara GitHub, desviado para o bare local.
  const repo = join(fabriquinha.raiz, "loja");
  git(repo, "remote", "set-url", "origin", "https://github.com/dono/loja.git");
  git(repo, "config", `url.${join(fabriquinha.raiz, "origin.git")}.insteadOf`, "https://github.com/dono/loja.git");

  await pagina.goto(`${fabriquinha.base}/config?projeto=loja`);
  const grupo = pagina.locator(".grupo", { has: pagina.getByRole("heading", { name: /^Modelo e effort por etapa/ }) });
  await expect(grupo.locator("label")).toHaveText(ETAPAS);
  // O seletor vem de GET /api/modelos (o pi falso lista dois); o gravado que o pi não lista continua nas opções.
  const planejar = pagina.getByLabel("Planejar", { exact: true });
  await expect(planejar).toHaveValue("anthropic/claude-antigo");
  await expect(planejar.locator("option")).toHaveText([
    "padrão do pi",
    "anthropic / claude-opus-5-5",
    "anthropic / claude-sonnet-5-5",
    "anthropic / claude-antigo",
  ]);
  await expect(pagina.getByLabel("Effort de Revisar rodada")).toHaveValue("high");
  const effortImplementar = pagina.getByLabel("Effort de Implementar");
  await expect(effortImplementar.locator("option")).toHaveText([
    "padrão do pi",
    "off",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
  ]);
  const implementar = pagina.getByLabel("Implementar", { exact: true });
  await expect(implementar).toHaveClass("padrao");
  await implementar.selectOption("anthropic/claude-sonnet-5-5");
  await expect(implementar).not.toHaveClass("padrao");
  await effortImplementar.selectOption("low");
  await expect(pagina.locator("form[data-projeto] .rodape-form")).toContainText(
    "Ao salvar, a Fabriquinha confere o repositório, a branch, o remoto e os modelos.",
  );
  for (const largura of [1440, 375]) {
    await pagina.setViewportSize({ width: largura, height: 900 });
    expect(await pagina.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await fotografar(pagina, info, `configuracao-etapas-${String(largura)}`);
  }
  await pagina.setViewportSize({ width: 1440, height: 900 });

  await Promise.all([
    pagina.waitForResponse((r) => r.url().endsWith("/api/projetos/loja") && r.request().method() === "POST"),
    pagina.getByRole("button", { name: "Salvar projeto" }).click(),
  ]);
  await pagina.reload();
  await expect(pagina.getByLabel("Implementar", { exact: true })).toHaveValue("anthropic/claude-sonnet-5-5");
  await expect(pagina.getByLabel("Effort de Implementar")).toHaveValue("low");
  await expect(pagina.getByLabel("Planejar", { exact: true })).toHaveValue("anthropic/claude-antigo");
  await expect(pagina.getByLabel("Effort de Revisar rodada")).toHaveValue("high");
  await expect(pagina.getByLabel("Effort de Demanda")).toHaveClass("padrao");
  const banco = abrirBancoDaFabriquinha(fabriquinha.raiz);
  expect(
    banco
      .prepare("SELECT * FROM configuracao_etapa_projeto WHERE projeto = 'loja' ORDER BY etapa")
      .all()
      .map((l) => ({ ...l })),
  ).toEqual([
    {
      projeto: "loja",
      etapa: "implementar",
      modelo_provedor: "anthropic",
      modelo_nome: "claude-sonnet-5-5",
      effort: "low",
    },
    { projeto: "loja", etapa: "planejar", modelo_provedor: "anthropic", modelo_nome: "claude-antigo", effort: null },
    { projeto: "loja", etapa: "revisar_rodada", modelo_provedor: null, modelo_nome: null, effort: "high" },
  ]);
  banco.close();
});

test("Ambiente: mostra o tipo, os limites e o conjunto; Eliminar o container livre pede confirmação, e o alocado não tem como (I-286, CA-5)", async ({
  pagina,
  fabriquinha,
}, info: TestInfo) => {
  const { dockerFalso } = fabriquinha;
  const livre = dockerFalso.semearContainer({ imagem: "alpine", rotulos: { "fabriquinha.ambiente": "amb-livre" } });
  const alocado = dockerFalso.semearContainer({
    imagem: "node:22",
    rotulos: { "fabriquinha.ambiente": "amb-alocado" },
  });
  const banco = abrirBancoDaFabriquinha(fabriquinha.raiz);
  inserirAmbienteAlocado(banco, {
    id: "amb-livre",
    container_id: livre.id,
    imagem: "alpine",
    alocado_para: "I-1",
    criado_em: "2026-11-09T10:00:00.000Z",
  });
  liberarAmbiente(banco, "amb-livre", "livre", "2026-11-09T11:00:00.000Z");
  inserirAmbienteAlocado(banco, {
    id: "amb-alocado",
    container_id: alocado.id,
    imagem: "node:22",
    alocado_para: "I-2",
    criado_em: "2026-11-09T12:00:00.000Z",
  });
  banco.close();

  await pagina.goto(`${fabriquinha.base}/config`);
  const menu = pagina.getByRole("navigation", { name: "Configuração" });
  await menu.getByRole("link", { name: "Ambiente" }).click();
  await expect(menu.getByRole("link", { name: "Ambiente" })).toHaveAttribute("aria-current", "page");
  await expect(pagina.getByLabel("Tipo de Ambiente")).toHaveValue("host_local");
  await expect(pagina.getByRole("spinbutton", { name: "Memória máxima por container" })).toHaveValue("2048");
  await expect(pagina.getByRole("spinbutton", { name: "CPUs por container" })).toHaveValue("2");
  await expect(pagina.getByRole("spinbutton", { name: "Eliminar container livre após" })).toHaveValue("60");

  const linhaDoLivre = pagina.locator('tr[data-ambiente="amb-livre"]');
  const linhaDoAlocado = pagina.locator('tr[data-ambiente="amb-alocado"]');
  const data = /\d{2}\/\d{2}\/\d{4}/;
  for (const [linha, id, imagem, estado, alocadoPara] of [
    [linhaDoLivre, "amb-livre", "alpine", "livre", "—"],
    [linhaDoAlocado, "amb-alocado", "node:22", "alocado", "I-2"],
  ] as const) {
    const celulas = linha.locator("td");
    await expect(celulas.nth(0)).toHaveText(id);
    await expect(celulas.nth(1)).toHaveText(imagem);
    await expect(celulas.nth(2)).toHaveText(estado);
    await expect(celulas.nth(3)).toHaveText(alocadoPara);
    await expect(celulas.nth(4)).toHaveText(data);
    // Com host_local, o docker não mede o uso.
    await expect(celulas.nth(5)).toHaveText("—");
    await expect(celulas.nth(6)).toHaveText("—");
  }
  await expect(linhaDoAlocado.getByRole("button", { name: "Eliminar" })).toBeDisabled();
  await expect(linhaDoLivre.getByRole("button", { name: "Eliminar" })).toBeEnabled();
  await fotografar(pagina, info, "configuracao-ambiente");

  await linhaDoLivre.getByRole("button", { name: "Eliminar" }).click();
  const confirmacao = pagina.getByRole("dialog", { name: "Eliminar o container amb-livre" });
  await expect(confirmacao).toBeVisible();
  await confirmacao.getByRole("button", { name: "Cancelar" }).click();
  await expect(linhaDoLivre).toBeVisible();
  expect(dockerFalso.registro().filter(([comando]) => comando === "rm")).toEqual([]);

  await linhaDoLivre.getByRole("button", { name: "Eliminar" }).click();
  await pagina
    .getByRole("dialog", { name: "Eliminar o container amb-livre" })
    .getByRole("button", { name: "Eliminar container" })
    .click();
  await expect(linhaDoLivre).toHaveCount(0);
  await expect(linhaDoAlocado).toBeVisible();
  expect(dockerFalso.registro().filter(([comando]) => comando === "rm")).toEqual([["rm", "--force", livre.id]]);
  expect(dockerFalso.containers().map(({ id }) => id)).toEqual([alocado.id]);
});

test("Ambiente: no container, o conjunto traz a CPU e a memória que o docker mede agora, numa chamada só, na largura larga e na do celular", async ({
  pagina,
  fabriquinha,
}, info: TestInfo) => {
  const { dockerFalso } = fabriquinha;
  const ocupado = dockerFalso.semearContainer({
    imagem: "fabriquinha/loja:3f9a",
    rotulos: { "fabriquinha.ambiente": "amb-ocupado" },
    uso: { cpu: "37.50%", memoria: "300.4MiB / 2GiB" },
  });
  const ocioso = dockerFalso.semearContainer({
    imagem: "fabriquinha/loja:3f9a",
    rotulos: { "fabriquinha.ambiente": "amb-ocioso" },
    uso: { cpu: "0.00%", memoria: "1.5GiB / 2GiB" },
  });
  const banco = abrirBancoDaFabriquinha(fabriquinha.raiz);
  for (const [id, container_id, alocado_para] of [
    ["amb-ocupado", ocupado.id, "I-12.R1"],
    ["amb-ocioso", ocioso.id, "I-7"],
  ] as const)
    inserirAmbienteAlocado(banco, {
      id,
      container_id,
      imagem: "fabriquinha/loja:3f9a",
      alocado_para,
      criado_em: "2026-11-09T12:00:00.000Z",
    });
  liberarAmbiente(banco, "amb-ocioso", "livre", "2026-11-09T13:00:00.000Z");
  // A tela grava o tipo container; a gestão do serviço o lê na pergunta seguinte, sem reiniciar.
  salvarConfiguracaoDoAmbiente(banco, ConfiguracaoDoAmbiente.parse({ tipo: "container" }));
  banco.close();

  await pagina.goto(`${fabriquinha.base}/config?ambiente`);
  await expect(pagina.getByLabel("Tipo de Ambiente")).toHaveValue("container");
  await expect(pagina.locator(".conjunto-ambiente thead th")).toHaveText([
    "Id",
    "Imagem",
    "Estado",
    "Alocado para",
    "Desde",
    "CPU",
    "Memória",
    "",
  ]);
  for (const [id, cpu, memoria] of [
    ["amb-ocupado", "0,38 CPUs", "300 MB"],
    ["amb-ocioso", "0,00 CPUs", "1.536 MB"],
  ] as const) {
    const celulas = pagina.locator(`tr[data-ambiente="${id}"] td`);
    await expect(celulas.nth(5)).toHaveText(cpu);
    await expect(celulas.nth(6)).toHaveText(memoria);
  }
  expect(dockerFalso.registro().filter(([comando]) => comando === "stats")).toEqual([
    ["stats", "--no-stream", "--format", "{{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}", ocupado.id, ocioso.id],
  ]);
  for (const largura of [1440, 375]) {
    await pagina.setViewportSize({ width: largura, height: 900 });
    expect(await pagina.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await fotografar(pagina, info, `configuracao-ambiente-medido-${String(largura)}`);
  }
  // No celular, a tabela rola de lado dentro do painel, como antes: rolada até o fim, a CPU e a memória aparecem.
  const memoriaDoOcupado = pagina.locator('tr[data-ambiente="amb-ocupado"] td').nth(6);
  await memoriaDoOcupado.scrollIntoViewIfNeeded();
  await expect(memoriaDoOcupado).toBeInViewport();
  // De volta ao topo da página, a tabela continua rolada de lado: a foto inteira não repete o menu fixo no meio.
  await pagina.evaluate(() => {
    scrollTo(0, 0);
  });
  await fotografar(pagina, info, "configuracao-ambiente-medido-375-rolada");
});

test("Ambiente: salva os limites; com host_local, o padrão, subir e abrir a Configuração não chama o docker (I-286, CA-1)", async ({
  pagina,
  fabriquinha,
}) => {
  await pagina.goto(`${fabriquinha.base}/config?ambiente`);
  await expect(pagina.getByText("Nenhum container no conjunto.")).toBeVisible();
  await pagina.getByRole("spinbutton", { name: "Memória máxima por container" }).fill("1024");
  await pagina.getByRole("button", { name: "Salvar" }).click();
  await expect(pagina.getByRole("button", { name: "Salvar" })).toBeEnabled();
  await pagina.reload();
  await expect(pagina.getByRole("spinbutton", { name: "Memória máxima por container" })).toHaveValue("1024");
  await expect(pagina.getByLabel("Tipo de Ambiente")).toHaveValue("host_local");

  await pagina.getByRole("spinbutton", { name: "Memória máxima por container" }).fill("100");
  await pagina.getByRole("button", { name: "Salvar" }).click();
  await expect(pagina.locator(".num-campo.erro .msg-erro")).toHaveCount(1);
  expect(fabriquinha.dockerFalso.registro()).toEqual([]);
});

test("Ambiente: o tamanho do conjunto é variável sem limite por padrão; o fixo exige a capacidade, desativa o mínimo e a ociosidade, e é gravado", async ({
  pagina,
  fabriquinha,
}, info: TestInfo) => {
  await pagina.goto(`${fabriquinha.base}/config?ambiente`);
  const tipoDeConjunto = pagina.getByLabel("Tipo de conjunto");
  const capacidade = pagina.getByRole("spinbutton", { name: "Capacidade do conjunto" });
  const minimo = pagina.getByRole("spinbutton", { name: "Manter ao menos" });
  const ociosidade = pagina.getByRole("spinbutton", { name: "Eliminar container livre após" });
  await expect(tipoDeConjunto).toHaveValue("variavel");
  await expect(capacidade).toHaveValue("");
  await expect(capacidade).toHaveAttribute("placeholder", "sem limite");
  await expect(minimo).toHaveValue("0");
  for (const campo of [minimo, ociosidade]) await expect(campo).toBeEnabled();

  await tipoDeConjunto.selectOption("fixo");
  for (const campo of [minimo, ociosidade]) await expect(campo).toBeDisabled();
  await pagina.getByRole("button", { name: "Salvar" }).click();
  const erroDaCapacidade = pagina.locator("#campo-capacidade_do_conjunto-erro");
  await expect(erroDaCapacidade).toHaveText("o conjunto fixo precisa de uma capacidade");
  await expect(capacidade).toHaveAttribute("aria-invalid", "true");
  await fotografar(pagina, info, "configuracao-ambiente-fixo-sem-capacidade");

  await capacidade.fill("3");
  await pagina.getByRole("button", { name: "Salvar" }).click();
  await expect(erroDaCapacidade).toHaveCount(0);
  await pagina.reload();
  await expect(tipoDeConjunto).toHaveValue("fixo");
  await expect(capacidade).toHaveValue("3");
  for (const campo of [minimo, ociosidade]) await expect(campo).toBeDisabled();
  await fotografar(pagina, info, "configuracao-ambiente-fixo");

  await tipoDeConjunto.selectOption("variavel");
  for (const campo of [minimo, ociosidade]) await expect(campo).toBeEnabled();
  await minimo.fill("4");
  await pagina.getByRole("button", { name: "Salvar" }).click();
  await expect(pagina.locator("#campo-minimo_do_conjunto-erro")).toHaveText("o mínimo passa da capacidade do conjunto");
  await capacidade.fill("");
  await pagina.getByRole("button", { name: "Salvar" }).click();
  await expect(pagina.locator(".msg-erro")).toHaveCount(0);
  await pagina.reload();
  await expect(tipoDeConjunto).toHaveValue("variavel");
  await expect(capacidade).toHaveValue("");
  await expect(minimo).toHaveValue("4");
  expect(fabriquinha.dockerFalso.registro()).toEqual([]);
});
