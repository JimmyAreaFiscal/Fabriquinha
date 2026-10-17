// Gate do PR na página da issue (F7 §4.4, §7) com o `gh` falso: revisar nas abas, pedir mudanças com o motivo e
// concluir a sessão em aberto pelo chat; com o PR aberto, Encerrar desabilitado e o 409 do servidor; depois do merge,
// encerrar com a nota, a worktree removida e as branches mantidas.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { caminhoArquivo } from "../src/persistencia/arquivos.ts";
import { abrir } from "../src/persistencia/banco.ts";
import { agregado } from "../src/persistencia/issues.ts";
import { projeto as lerProjeto } from "../src/persistencia/projetos.ts";
import { caminhoDaWorktree, garantirWorktree } from "../src/repositorio/worktree.ts";
import { expect, prNoGitHub, projeto, test } from "./apoio.ts";

const AGORA = "2026-10-11T12:00:00.000Z";
const SESSAO = "4d1e2f3a-5b6c-4d7e-8f90-a1b2c3d4e5f6";
const URL_PR = "https://github.com/dono/loja/pull/7";
const CORPO = "## 1. Por quê\n\nA busca está **lenta**. <b>sem html</b>\n\n## 2. O que mudou\n\nÍndice na busca.\n";
const WEBM = Buffer.from("1a45dfa3", "hex");

/** Guarda o conteúdo como o F2 guarda um anexo e devolve o hash. */
function guardar(raiz: string, conteudo: string | Buffer): string {
  const banco = abrir(raiz);
  const sha = createHash("sha256").update(conteudo).digest("hex");
  const caminho = caminhoArquivo(banco, sha);
  banco.close();
  mkdirSync(dirname(caminho), { recursive: true });
  writeFileSync(caminho, conteudo);
  return sha;
}

const consumo = (custo: number, input: number) => ({
  chamadas: 1,
  tokens: { input, output: 0, cacheRead: 0, cacheWrite: 0 },
  custo,
});

/**
 * I-1 da loja no gate do PR, como o encerramento a deixa: a worktree com a branch publicada, o encerramento T-3
 * concluído na sessão autônoma, com o vídeo, a produtividade e o `pr_aberto` com o corpo; a revisão T-2 com a
 * comprovação e a fitness.
 */
async function noGatePR(raiz: string): Promise<string> {
  projeto(raiz);
  const banco = abrir(raiz);
  const loja = lerProjeto(banco, "loja");
  banco.close();
  if (!loja) throw new Error("o projeto loja não foi cadastrado");
  const worktree = await garantirWorktree(raiz, loja, { id: 1, criadaEm: AGORA }, join(raiz, "log"), () =>
    Promise.resolve(),
  );
  execFileSync("git", ["push", "-q", "-u", "origin", "fabriquinha/I-1"], { cwd: worktree, stdio: "pipe" });
  mkdirSync(join(raiz, "sessoes"), { recursive: true });
  writeFileSync(
    join(raiz, "sessoes", `2026-10-11T12-00-00-000Z_${SESSAO}.jsonl`),
    JSON.stringify({ type: "session", version: 3, id: SESSAO }) + "\n",
  );
  const corpo = guardar(raiz, CORPO);
  const video = guardar(raiz, WEBM);
  const aula = guardar(raiz, "<!doctype html><html><body><h1>Aula do código da I-1</h1></body></html>");
  const log = guardar(raiz, "cobertura 92%\n");
  const pr = { hospedagem: "github", id: "7", url: URL_PR, branch: "fabriquinha/I-1", base: "main" };
  const comprovacao = {
    criterios: [{ id: "CA-1", atendido: true, comoVerificado: "teste de busca com 10 mil itens", arquivos: [] }],
  };
  const fitness = {
    linhas: [
      {
        nome: "cobertura",
        comando: "npm test",
        codigoSaida: 0,
        estourou: false,
        duracaoMs: 41_000,
        log: "cobertura.log",
      },
    ],
  };
  const explicacao = { explicacoes: [{ nome: "cobertura", explicacao: "Cobertura das rotas novas em 92%." }] };
  const produtividade = {
    etapas: [
      {
        etapa: "desenvolvimento",
        execucoes: 9,
        falhas: 1,
        reprovacoes: 0,
        duracaoMs: 0,
        modelos: [],
        ...consumo(5.1, 2_000_000),
      },
      {
        etapa: "revisao",
        execucoes: 2,
        falhas: 0,
        reprovacoes: 0,
        duracaoMs: 0,
        modelos: [],
        ...consumo(1.5, 250_000),
      },
    ],
    consultas: { ...consumo(0.24, 50_000), execucoes: 0, modelos: [] },
  };
  const json = (x: object) => JSON.stringify(x).replaceAll("'", "''");
  const b = abrir(raiz);
  b.exec(`
    INSERT INTO issue (id, projeto, titulo, tipo, descricao, fase, criada_em)
      VALUES (1, 'loja', 'Busca lenta', 'problema', 'A busca demora.', 'aprovacao_pr', '${AGORA}');
    INSERT INTO ticket (id, issue, etapa, titulo, descricao, status, origem, criado_em, concluido_em) VALUES
      (1, 1, 'registro', 'Registrar a necessidade', '', 'concluido', 'fabriquinha', '${AGORA}', '${AGORA}'),
      (2, 1, 'revisao', 'Revisar', '', 'concluido', 'fabriquinha', '${AGORA}', '${AGORA}'),
      (3, 1, 'encerramento', 'Publicar o PR', '', 'concluido', 'fabriquinha', '${AGORA}', '${AGORA}');
    INSERT INTO sequencia (nome, valor) VALUES ('ticket', 3) ON CONFLICT (nome) DO UPDATE SET valor = 3;
    -- O caminho da issue até o gate do PR, sem o ajuste do PR (F6 §7: a fase de antes de cada comando).
    INSERT INTO comando (issue, nome, ator, fase, em) VALUES
      (1, 'decidirRegistro', 'auditor', 'registro', '${AGORA}'),
      (1, 'concluirTicket', 'fabriquinha', 'desenho', '${AGORA}'),
      (1, 'decidirDesenho', 'auditor', 'aprovacao_desenho', '${AGORA}'),
      (1, 'concluirTicket', 'fabriquinha', 'desenvolvimento', '${AGORA}'),
      (1, 'concluirTicket', 'fabriquinha', 'revisao', '${AGORA}'),
      (1, 'concluirTicket', 'fabriquinha', 'encerramento', '${AGORA}');
    INSERT INTO execucao (id, ticket, modo, sessao_pi, resultado, iniciada_em, terminada_em)
      VALUES (1, 3, 'autonomo', '${SESSAO}', 'sucesso', '${AGORA}', '${AGORA}');
    INSERT INTO sequencia (nome, valor) VALUES ('execucao', 1) ON CONFLICT (nome) DO UPDATE SET valor = 1;
    INSERT INTO evidencia (id, ticket, tipo, produtor, dados, em) VALUES
      (1, 2, 'comprovacao_criterios', 'agente', '${json(comprovacao)}', '${AGORA}'),
      (2, 2, 'matriz_fitness', 'fabriquinha', '${json(fitness)}', '${AGORA}'),
      (3, 2, 'explicacao_fitness', 'agente', '${json(explicacao)}', '${AGORA}'),
      (4, 3, 'video_demonstracao', 'agente', '{"roteiro":"r"}', '${AGORA}'),
      (5, 3, 'relatorio_produtividade', 'fabriquinha', '${json(produtividade)}', '${AGORA}'),
      (6, 3, 'pr_aberto', 'fabriquinha', '${json(pr)}', '${AGORA}'),
      (7, 3, 'aula_codigo', 'agente', '{"trechos":[]}', '${AGORA}');
    INSERT INTO sequencia (nome, valor) VALUES ('evidencia', 7) ON CONFLICT (nome) DO UPDATE SET valor = 7;
    INSERT INTO evidencia_arquivo (evidencia, nome, sha256, mime, bytes) VALUES
      (2, 'cobertura.log', '${log}', 'text/plain; charset=utf-8', 14),
      (4, 'demonstracao.webm', '${video}', 'video/webm', ${String(WEBM.length)}),
      (7, 'aula.html', '${aula}', 'text/html; charset=utf-8', 70),
      (6, 'corpo.md', '${corpo}', 'text/markdown; charset=utf-8', ${String(Buffer.byteLength(CORPO))});
  `);
  b.close();
  return worktree;
}

/** O agregado da I-1, lido do banco da instância. */
function issue(raiz: string) {
  const banco = abrir(raiz);
  try {
    return agregado(banco, 1);
  } finally {
    banco.close();
  }
}

test("revisa o PR, pede mudanças com o motivo e conclui a sessão em aberto pelo chat", async ({
  pagina,
  fabriquinha,
}) => {
  await noGatePR(fabriquinha.raiz);
  prNoGitHub(fabriquinha.raiz, "OPEN", URL_PR);
  await pagina.goto(`${fabriquinha.base}/projects/loja/issues/I-1`);
  const gate = pagina.getByRole("region", { name: "Gate do PR" });
  await expect(gate.locator(".gate-cabeca")).toContainText("Gate do PRPR #7 ↗aguarda você há");
  // A descrição curta, sem "ver tudo", fica nítida: sem o degradê da recolhida.
  const descricao = pagina.locator("[data-descricao]");
  await expect(pagina.getByRole("button", { name: "ver tudo" })).toBeHidden();
  expect(await descricao.evaluate((d) => getComputedStyle(d, "::after").content)).toBe("none");
  await expect(gate.getByRole("link", { name: "abrir o chat da sessão →" })).toHaveAttribute(
    "href",
    `/sessions/${SESSAO}`,
  );

  // Revisão: vídeo de demonstração, cards, a aula do código, o corpo em Markdown sem HTML, comprovação e fitness.
  const revisao = gate.getByRole("tabpanel", { name: "Revisão" });
  await expect(gate.getByRole("tab", { name: "Revisão" })).toHaveAttribute("aria-selected", "true");
  await expect(revisao.getByLabel("Vídeo de demonstração")).toHaveAttribute("src", /^\/arquivos\/[0-9a-f]{64}$/);
  await revisao.getByRole("button", { name: "HTML Aula do código" }).click();
  await expect(pagina.frameLocator("iframe").getByRole("heading")).toHaveText("Aula do código da I-1");
  await pagina.keyboard.press("Escape");
  await expect(revisao.locator(".numero")).toHaveText([
    "US$ 6,84custo",
    "2,3 Mtokens",
    "11execuções · 1 falha",
    "0reprovações",
  ]);
  const corpo = revisao.locator(".corpo-pr");
  await expect(corpo.getByRole("heading")).toHaveText(["1. Por quê", "2. O que mudou"]);
  await expect(corpo.locator("strong")).toHaveText("lenta");
  await expect(corpo).toContainText("<b>sem html</b>");
  await expect(revisao.locator("td")).toContainText(["CA-1", "✓ sim", "teste de busca com 10 mil itens"]);
  await expect(revisao).toContainText("Cobertura das rotas novas em 92%.");

  // Decisão: o PR aberto, sem nota nem encerrar; pedir mudanças só com o motivo.
  await gate.getByRole("tab", { name: "Decisão" }).click();
  const decisao = gate.getByRole("tabpanel", { name: "Decisão" });
  await expect(revisao).toBeHidden();
  await expect(decisao.locator(".estado-pr")).toContainText("Estado no GitHubaberto · aguardando mergelido");
  await expect(decisao.getByRole("link", { name: "Abrir PR #7 ↗" })).toHaveAttribute("href", URL_PR);
  await expect(decisao.getByRole("button", { name: "Encerrar issue" })).toBeDisabled();
  await expect(decisao.getByRole("button", { name: "4" })).toBeDisabled();
  await expect(decisao.locator('[data-bloqueio="encerrar"]')).toHaveText("o PR ainda não foi mergeado");
  const pedir = decisao.getByRole("button", { name: "Pedir mudanças" });
  await expect(pedir).toBeDisabled();
  const motivo = decisao.getByRole("textbox", { name: "O que precisa mudar no PR" });
  await motivo.fill("Falta o índice da busca: crie um ticket para ele.");
  await expect(pedir).toBeEnabled();

  // O Atualizar relê o estado e mantém a aba e o motivo.
  await decisao.getByRole("button", { name: "Atualizar" }).click();
  await expect(decisao.locator(".estado-pr")).toContainText("lido agora");
  await expect(motivo).toHaveValue("Falta o índice da busca: crie um ticket para ele.");
  await expect(pedir).toBeEnabled();

  await pedir.click();
  await expect(gate).toBeHidden();
  await expect(pagina.locator('.trilho-fases [aria-current="step"]')).toHaveText("Ajuste do PR");
  const ag = issue(fabriquinha.raiz);
  expect(ag?.decisoes.map((d) => [d.gate, d.aprovado, d.motivo])).toEqual([
    ["pr", false, "Falta o índice da busca: crie um ticket para ele."],
  ]);

  // A sessão em aberto, no chat: o agente cria o ticket, e o Auditor conclui a sessão.
  const sessao = pagina.locator(".linha-tempo > li").filter({ hasText: "Ajustar o PR" }).getByRole("link");
  await sessao.click();
  await expect(pagina.locator("[data-conversa] .msg.agente").last()).toHaveText(
    "Criei o ticket de desenvolvimento do índice.",
  );
  await pagina.getByRole("button", { name: "Concluir sessão" }).click();
  await expect(pagina.locator(".estado-sessao .pill")).toHaveText("terminada");
  await expect.poll(() => issue(fabriquinha.raiz)?.issue.fase).toBe("desenvolvimento");
  expect(issue(fabriquinha.raiz)?.tickets.at(-1)?.titulo).toBe("Criar o índice da busca");
});

test("com o PR aberto, Encerrar fica desabilitado e o servidor recusa; depois do merge, encerra com a nota", async ({
  pagina,
  fabriquinha,
}) => {
  const worktree = await noGatePR(fabriquinha.raiz);
  prNoGitHub(fabriquinha.raiz, "OPEN", URL_PR);
  await pagina.goto(`${fabriquinha.base}/projects/loja/issues/I-1`);
  const gate = pagina.getByRole("region", { name: "Gate do PR" });
  await gate.getByRole("tab", { name: "Decisão" }).click();
  const decisao = gate.getByRole("tabpanel", { name: "Decisão" });
  const encerrar = decisao.getByRole("button", { name: "Encerrar issue" });
  await expect(encerrar).toBeDisabled();

  // O servidor relê o estado e recusa, mesmo pedido direto.
  const recusa = await pagina.evaluate(async () => {
    const r = await fetch("/api/issues/1/pr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ aprovado: true, nota: 4 }),
    });
    return [r.status, ((await r.json()) as { erro: string }).erro];
  });
  expect(recusa).toEqual([
    409,
    "a I-1 não pode ser encerrada: o PR está aberto, não mergeado (faça o merge na plataforma, com merge commit, e encerre de novo)",
  ]);

  // O Auditor faz o merge na plataforma e atualiza: as notas se abrem, e pedir mudanças se fecha.
  prNoGitHub(fabriquinha.raiz, "MERGED", URL_PR);
  await decisao.getByRole("button", { name: "Atualizar" }).click();
  await expect(decisao.locator(".estado-pr .pill")).toHaveText(/^mergeado em \d\d\/10 \d\d:02$/);
  await expect(decisao.getByRole("button", { name: "Pedir mudanças" })).toBeDisabled();
  await expect(decisao.locator('[data-bloqueio="pedir"]')).toHaveText("o PR já foi mergeado");
  await expect(decisao.locator('[data-bloqueio="encerrar"]')).toHaveText("escolha a nota");
  await expect(encerrar).toBeDisabled();
  await decisao.getByRole("button", { name: "4" }).click();
  await expect(decisao.getByRole("button", { name: "4" })).toHaveAttribute("aria-pressed", "true");
  await expect(decisao.locator('[data-bloqueio="encerrar"]')).toHaveText("");
  await encerrar.click();

  await expect(gate).toBeHidden();
  await expect(pagina.locator('.trilho-fases [aria-current="step"]')).toHaveCount(0);
  // Fases passadas em verde; o ajuste do PR, que a issue não teve, fica neutro.
  await expect(pagina.locator(".trilho-fases .passo.feito")).toHaveText([
    "Registro",
    "Desenho",
    "Aprovação do desenho",
    "Desenvolvimento",
    "Revisão",
    "Encerramento",
    "Aprovação do PR",
  ]);
  await expect(pagina.locator(".trilho-fases .passo", { hasText: "Ajuste do PR" })).not.toHaveClass(/feito/);
  const ag = issue(fabriquinha.raiz);
  expect(ag?.issue.fase).toBe("concluida");
  expect(ag?.decisoes.map((d) => [d.gate, d.aprovado, d.nota])).toEqual([["pr", true, 4]]);
  expect(existsSync(worktree)).toBe(false);
  expect(existsSync(caminhoDaWorktree(fabriquinha.raiz, "loja", 1))).toBe(false);
  const repo = join(fabriquinha.raiz, "loja");
  expect(execFileSync("git", ["branch", "--list", "fabriquinha/I-1"], { cwd: repo }).toString().trim()).toBe(
    "fabriquinha/I-1",
  );
  expect(execFileSync("git", ["ls-remote", "--heads", "origin", "fabriquinha/I-1"], { cwd: repo }).toString()).toMatch(
    /refs\/heads\/fabriquinha\/I-1/,
  );
  await expect(pagina.getByText("A limpeza falhou")).toHaveCount(0);
  await expect(pagina.getByText("Avisos do encerramento")).toHaveCount(0);
});

test("encerrar com a limpeza da worktree falhando mostra o que falhou, com a saída do git", async ({
  pagina,
  fabriquinha,
}) => {
  const worktree = await noGatePR(fabriquinha.raiz);
  prNoGitHub(fabriquinha.raiz, "MERGED", URL_PR);
  // O git já não conhece a worktree: o `worktree remove` falha, e ela fica no disco.
  rmSync(join(fabriquinha.raiz, "loja", ".git", "worktrees"), { recursive: true, force: true });
  await pagina.goto(`${fabriquinha.base}/projects/loja/issues/I-1`);
  const gate = pagina.getByRole("region", { name: "Gate do PR" });
  await gate.getByRole("tab", { name: "Decisão" }).click();
  const decisao = gate.getByRole("tabpanel", { name: "Decisão" });
  await decisao.getByRole("button", { name: "5" }).click();
  await decisao.getByRole("button", { name: "Encerrar issue" }).click();

  await expect(gate).toBeHidden();
  expect(issue(fabriquinha.raiz)?.issue.fase).toBe("concluida");
  const aviso = pagina.getByRole("status").filter({ hasText: "Avisos do encerramento" });
  await expect(aviso).toContainText("a issue foi encerrada, com estes avisos:");
  await expect(aviso.locator(".comandos")).toContainText(`worktree remove --force ${worktree} falhou: fatal:`);
  expect(existsSync(worktree)).toBe(true);

  // Recarregada, a página volta ao comando a rodar, lido do disco.
  await pagina.reload();
  const pendente = pagina.getByRole("status").filter({ hasText: "A limpeza falhou" });
  await expect(pendente).toContainText("a issue foi encerrada, mas a worktree ficou no disco; rode:");
  await expect(pendente.locator(".comandos")).not.toContainText("falhou");
});
