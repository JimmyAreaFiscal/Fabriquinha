// Rotas da página da issue (F7 §4.2, §4.3, §7) contra o serviço de verdade, numa raiz temporária e numa porta livre.
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { setTimeout as dormir } from "node:timers/promises";
import { iniciarServico, type Servico } from "../../execucao/servico.ts";
import { caminhoArquivo } from "../../persistencia/arquivos.ts";
import { caminhoDaWorktree } from "../../repositorio/worktree.ts";
import { intervalo, type PaginaDaIssue } from "./issue.ts";

const base = mkdtempSync(join(tmpdir(), "fabriquinha-rotas-issue-"));
let raiz: string;
let servico: Servico;
let origem: string;

const SESSAO = "0b7c5a52-3f0e-4c1e-9d3a-6f1f2b9e8a10";
const AGORA = "2026-10-11T12:00:00.000Z";
const HTML = "<!doctype html><title>Desenho</title><script>fetch('/api/issues/1')</script>";
const SHA_HTML = "a".repeat(64);
const SHA_VIDEO = "b".repeat(64);
const VIDEO = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256));

before(async () => {
  const livre = createServer().listen(0, "127.0.0.1");
  await once(livre, "listening");
  process.env.FABRIQUINHA_PORTA = String((livre.address() as { port: number }).port);
  livre.close();
  await once(livre, "close");
  origem = `http://127.0.0.1:${process.env.FABRIQUINHA_PORTA}`;
  raiz = mkdtempSync(join(base, "raiz-"));
  servico = await iniciarServico(raiz);
  // I-1 em desenvolvimento com dois tickets: o de desenvolvimento aberto (elegível) e o de desenho concluído, com uma
  // sessão terminada e uso; I-2 concluída (dependência da I-1), com a worktree que a limpeza deixou para trás.
  servico.banco.exec(`
    INSERT INTO projeto (nome, repo, branch_base, hospedagem, testes, sonar_project_key, fitness)
      VALUES ('loja', '/nao/existe', 'main', 'github', '["npm test"]', 'loja', '[{"nome":"f","comando":"true","descricao":"d"}]');
    INSERT INTO varredura_base (projeto, ultimo_sha, em) VALUES ('loja', '${"c".repeat(40)}', '${new Date().toISOString()}');
    INSERT INTO issue (id, projeto, titulo, tipo, fase, criada_em, concluida_em)
      VALUES (2, 'loja', 'Base', 'problema', 'concluida', '${AGORA}', '${AGORA}');
    INSERT INTO issue (id, projeto, titulo, tipo, descricao, fase, criada_em)
      VALUES (1, 'loja', 'Busca', 'funcionalidade', '**rápida**', 'desenvolvimento', '${AGORA}');
    INSERT INTO issue (id, projeto, titulo, tipo, fase, criada_em) VALUES (3, 'loja', 'Outra', 'problema', 'registro', '${AGORA}');
    INSERT INTO issue_dep (issue, dep) VALUES (1, 2);
    INSERT INTO ticket (id, issue, etapa, titulo, status, origem, criado_em, concluido_em)
      VALUES (1, 1, 'desenho', 'Desenhar', 'concluido', 'fabriquinha', '${AGORA}', '${AGORA}');
    INSERT INTO ticket (id, issue, etapa, titulo, status, origem, criado_em)
      VALUES (2, 1, 'desenvolvimento', 'Cache', 'aberto', 'auditor', '${AGORA}');
    INSERT INTO ticket (id, issue, etapa, titulo, status, origem, criado_em)
      VALUES (3, 3, 'registro', 'Registrar', 'aberto', 'fabriquinha', '${AGORA}');
    INSERT INTO execucao (id, ticket, modo, sessao_pi, resultado, iniciada_em, terminada_em)
      VALUES (1, 1, 'autonomo', '${SESSAO}', 'sucesso', '${AGORA}', '2026-10-11T12:22:00.000Z');
    INSERT INTO sequencia (nome, valor) VALUES ('execucao', 1) ON CONFLICT (nome) DO UPDATE SET valor = 1;
    INSERT INTO uso (execucao, provedor, modelo, chamadas, input, output, cache_read, cache_write, custo)
      VALUES (1, 'anthropic', 'a', 3, 10, 10, 0, 0, 1.5), (1, 'llamacpp', 'b', 1, 10, 10, 0, 0, 0.25);
    INSERT INTO evidencia (id, ticket, tipo, produtor, dados, em) VALUES (1, 1, 'desenho_solucao', 'agente', '{}', '${AGORA}');
    INSERT INTO evidencia_arquivo (evidencia, nome, sha256, mime, bytes)
      VALUES (1, 'desenho (v2) de I-1''s*.html', '${SHA_HTML}', 'text/html; charset=utf-8', ${String(Buffer.byteLength(HTML))}),
             (1, 'video.webm', '${SHA_VIDEO}', 'video/webm', ${String(VIDEO.length)});
  `);
  for (const [sha, conteudo] of [
    [SHA_HTML, HTML],
    [SHA_VIDEO, VIDEO],
  ] as const) {
    const caminho = caminhoArquivo(servico.banco, sha);
    mkdirSync(dirname(caminho), { recursive: true });
    writeFileSync(caminho, conteudo);
  }
  mkdirSync(caminhoDaWorktree(raiz, "loja", 2), { recursive: true });
});
after(async () => {
  await servico.parar();
  rmSync(base, { recursive: true, force: true });
});

const token = () => String(new URL(readFileSync(join(raiz, "web.url"), "utf8")).searchParams.get("token"));

/** Um pedido da própria página: com o cookie e, na mutação, `Sec-Fetch-Site: same-origin`. */
const pedir = (
  caminho: string,
  { method = "GET", corpo, headers = {} }: { method?: string; corpo?: unknown; headers?: Record<string, string> } = {},
) =>
  fetch(`${origem}${caminho}`, {
    method,
    headers: { cookie: `fabriquinha=${token()}`, "sec-fetch-site": "same-origin", ...headers },
    ...(corpo !== undefined && { body: JSON.stringify(corpo) }),
  });

const pagina = async (id = 1) => (await (await pedir(`/api/issues/${String(id)}`)).json()) as PaginaDaIssue;

test("GET /api/issues/:id: agregado, projeto, dependências com a fase, sessões, custos, limpeza e Executar agora", async () => {
  const p = await pagina();
  assert.equal(p.issue.titulo, "Busca");
  assert.equal(p.issue.descricao, "**rápida**");
  assert.deepEqual(
    p.tickets.map((t) => t.id),
    [1, 2],
  );
  assert.equal(p.evidencias[0]?.arquivos[0]?.sha256, SHA_HTML);
  assert.equal(p.projeto.nome, "loja");
  assert.deepEqual(p.dependencias, [{ id: 2, projeto: "loja", fase: "concluida" }]);
  assert.deepEqual(
    p.sessoes.map((s) => [s.sessao, s.ticket, s.estado]),
    [[SESSAO, 1, "terminada"]],
  );
  assert.deepEqual(p.custos, { 1: 1.75 });
  assert.deepEqual(p.limpeza, []);
  assert.deepEqual([p.executar?.ticket.id, p.executar?.ocupada], [2, undefined]);

  const concluida = await pagina(2);
  assert.equal(concluida.executar, undefined, "sem ticket elegível, sem Executar agora");
  assert.deepEqual(concluida.limpeza, [
    `git -C /nao/existe worktree remove --force ${caminhoDaWorktree(raiz, "loja", 2)}`,
  ]);

  const inexistente = await pedir("/api/issues/99");
  assert.deepEqual(
    [inexistente.status, await inexistente.json()],
    [404, { erro: "a issue I-99 não existe (confira o número da issue)" }],
  );
  assert.equal((await pedir("/api/issues/I-1")).status, 422);
});

test("dependências: C3 adiciona e C4 remove pelo Auditor; ciclo dá 409 e corpo inválido 422", async () => {
  assert.equal((await pedir("/api/issues/1/deps", { method: "POST", corpo: { dep: 3 } })).status, 204);
  assert.deepEqual(
    (await pagina()).dependencias.map((d) => [d.id, d.fase]),
    [
      [2, "concluida"],
      [3, "registro"],
    ],
  );
  const ciclo = await pedir("/api/issues/3/deps", { method: "POST", corpo: { dep: 1 } });
  assert.equal(ciclo.status, 409);
  assert.match(((await ciclo.json()) as { erro: string }).erro, /fecharia um ciclo/);
  const invalido = await pedir("/api/issues/1/deps", { method: "POST", corpo: { dep: "I-3" } });
  assert.equal(invalido.status, 422);
  assert.match(((await invalido.json()) as { erro: string }).erro, /→ at dep/);

  assert.equal((await pedir("/api/issues/1/deps/3", { method: "DELETE" })).status, 204);
  assert.deepEqual(
    (await pagina()).dependencias.map((d) => d.id),
    [2],
  );
});

test("Executar agora: 409 com a execução que ocupa o D8, a recusa do C5, e 204 quando inicia", async () => {
  servico.banco.exec(`
    INSERT INTO ticket (id, issue, etapa, titulo, status, origem, criado_em)
      VALUES (4, 3, 'desenvolvimento', 'Outro', 'em_execucao', 'fabriquinha', '${AGORA}');
    INSERT INTO execucao (id, ticket, modo, sessao_pi, resultado, iniciada_em)
      VALUES (9, 4, 'autonomo', '${crypto.randomUUID()}', 'em_andamento', '${AGORA}');
  `);
  const ocupada = "já há uma execução autônoma em andamento (D8): E-9 de T-4";
  assert.deepEqual([(await pagina()).executar?.ticket.titulo, (await pagina()).executar?.ocupada], ["Cache", ocupada]);
  const recusada = await pedir("/api/tickets/2/executar", { method: "POST" });
  assert.deepEqual([recusada.status, await recusada.json()], [409, { erro: `${ocupada} (espere ela terminar)` }]);
  servico.banco.exec(`
    UPDATE execucao SET resultado = 'sucesso', terminada_em = '${AGORA}' WHERE id = 9;
    UPDATE ticket SET status = 'aberto' WHERE id = 4;
  `);

  const c5 = await pedir("/api/tickets/3/executar", { method: "POST" });
  assert.equal(c5.status, 409);
  assert.match(((await c5.json()) as { erro: string }).erro, /T-3 é da etapa registro, que roda em modo interativo/);

  assert.equal((await pedir("/api/tickets/2/executar", { method: "POST" })).status, 204);
  // O repositório do projeto não existe: a execução falha ao criar a worktree, em segundo plano.
  for (let i = 0; i < 500 && (await pagina()).tickets[1]?.status !== "falhou"; i++) await dormir(10);
  assert.equal((await pagina()).tickets[1]?.status, "falhou");
});

test("log e prompt da execução como texto; o que não existe dá 404", async () => {
  const dir = join(raiz, "execucoes", "E-1");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "log"), "linha 1\n");
  writeFileSync(join(dir, "prompt.md"), "# Prompt\n");
  const log = await pedir("/api/execucoes/1/log");
  assert.deepEqual(
    [log.status, log.headers.get("content-type"), await log.text()],
    [200, "text/plain; charset=utf-8", "linha 1\n"],
  );
  assert.equal(await (await pedir("/api/execucoes/1/prompt")).text(), "# Prompt\n");
  const semLog = await pedir("/api/execucoes/77/log");
  assert.deepEqual([semLog.status, await semLog.json()], [404, { erro: "a execução E-77 não tem log" }]);
  assert.equal((await pedir("/api/execucoes/77/prompt")).status, 404);
  assert.equal((await pedir("/api/execucoes/..%2f..%2fetc/log")).status, 422);
});

test("arquivos: só hash registrado, com o mime, nosniff e o sandbox; ?baixar com o nome original", async () => {
  for (const sha of ["f".repeat(64), "nao-e-hash"]) {
    const r = await pedir(`/arquivos/${sha}`);
    assert.equal(r.status, 404, sha);
  }
  const html = await pedir(`/arquivos/${SHA_HTML}`);
  assert.equal(html.status, 200);
  assert.equal(await html.text(), HTML);
  assert.equal(html.headers.get("content-type"), "text/html; charset=utf-8");
  assert.equal(html.headers.get("content-security-policy"), "sandbox allow-scripts");
  assert.equal(html.headers.get("x-content-type-options"), "nosniff");
  assert.equal(html.headers.get("content-disposition"), null);

  const baixar = await pedir(`/arquivos/${SHA_HTML}?baixar`);
  // RFC 5987: `'`, `(`, `)` e `*` não são attr-char e também vão em %XX, que o `encodeURIComponent` não faz.
  assert.equal(
    baixar.headers.get("content-disposition"),
    "attachment; filename*=UTF-8''desenho%20%28v2%29%20de%20I-1%27s%2A.html",
  );
  assert.equal((await fetch(`${origem}/arquivos/${SHA_HTML}`)).status, 401, "sem o cookie");
});

test("arquivos: Range de um intervalo dá 206 com o trecho certo; fora do arquivo, 416", async () => {
  const r = await pedir(`/arquivos/${SHA_VIDEO}`, { headers: { range: "bytes=100-199" } });
  assert.equal(r.status, 206);
  assert.equal(r.headers.get("content-range"), `bytes 100-199/${String(VIDEO.length)}`);
  assert.equal(r.headers.get("content-length"), "100");
  assert.equal(r.headers.get("accept-ranges"), "bytes");
  assert.equal(r.headers.get("content-type"), "video/webm");
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), VIDEO.subarray(100, 200));

  const fim = await pedir(`/arquivos/${SHA_VIDEO}`, { headers: { range: "bytes=-10" } });
  assert.deepEqual(Buffer.from(await fim.arrayBuffer()), VIDEO.subarray(990));

  const inteiro = await pedir(`/arquivos/${SHA_VIDEO}`, { headers: { range: "bytes=0-1,5-6" } });
  assert.equal(inteiro.status, 200, "mais de um intervalo: o arquivo inteiro");
  assert.equal((await inteiro.arrayBuffer()).byteLength, VIDEO.length);

  const fora = await pedir(`/arquivos/${SHA_VIDEO}`, { headers: { range: "bytes=5000-" } });
  assert.deepEqual([fora.status, fora.headers.get("content-range")], [416, `bytes */${String(VIDEO.length)}`]);
});

test("arquivos: o navegador que cancela o pedido no meio (vídeo) não é erro do serviço", async (t) => {
  const sha = "e".repeat(64);
  servico.banco.exec(
    `INSERT INTO evidencia_arquivo (evidencia, nome, sha256, mime, bytes) VALUES (1, 'longo.webm', '${sha}', 'video/webm', 33554432)`,
  );
  mkdirSync(dirname(caminhoArquivo(servico.banco, sha)), { recursive: true });
  writeFileSync(caminhoArquivo(servico.banco, sha), Buffer.alloc(32 * 1024 * 1024));
  const erros = t.mock.method(console, "error", () => undefined);
  const controle = new AbortController();
  const r = await fetch(`${origem}/arquivos/${sha}`, {
    headers: { cookie: `fabriquinha=${token()}`, range: "bytes=0-" },
    signal: controle.signal,
  });
  assert.equal(r.status, 206);
  await r.body?.getReader().read();
  controle.abort();
  // Só pode passar por engano, nunca falhar por engano: o erro, se houvesse, sairia logo depois do fechamento.
  await dormir(500);
  assert.equal(erros.mock.callCount(), 0);
});

test("arquivos: o arquivo que não se lê depois dos cabeçalhos corta a conexão e vai para o log", async (t) => {
  const sha = "9".repeat(64);
  servico.banco.exec(
    `INSERT INTO evidencia_arquivo (evidencia, nome, sha256, mime, bytes) VALUES (1, 'trancado.txt', '${sha}', 'text/plain', 3)`,
  );
  const caminho = caminhoArquivo(servico.banco, sha);
  mkdirSync(dirname(caminho), { recursive: true });
  writeFileSync(caminho, "abc", { mode: 0o000 });
  const erros = t.mock.method(console, "error", () => undefined);
  await assert.rejects(async () => (await pedir(`/arquivos/${sha}`)).text());
  assert.match(String(erros.mock.calls[0]?.arguments[1]), /EACCES/);
});

test("intervalo: as formas de um intervalo de bytes e o que se ignora", () => {
  assert.equal(intervalo(undefined, 10), undefined);
  assert.equal(intervalo("bytes=-", 10), undefined);
  assert.equal(intervalo("items=0-1", 10), undefined);
  assert.equal(intervalo("bytes=5-2", 10), undefined, "fim antes do início é sintaxe inválida");
  assert.deepEqual(intervalo("bytes=2-", 10), { inicio: 2, fim: 9 });
  assert.deepEqual(intervalo("bytes=2-99", 10), { inicio: 2, fim: 9 });
  assert.deepEqual(intervalo("bytes=-3", 10), { inicio: 7, fim: 9 });
  assert.deepEqual(intervalo("bytes=-30", 10), { inicio: 0, fim: 9 });
  assert.equal(intervalo("bytes=-0", 10), "fora");
  assert.equal(intervalo("bytes=10-", 10), "fora");
  assert.equal(intervalo("bytes=-1", 0), "fora");
});

test("arquivo vazio sai com 200 e corpo vazio", async () => {
  const sha = "d".repeat(64);
  servico.banco.exec(
    `INSERT INTO evidencia_arquivo (evidencia, nome, sha256, mime, bytes) VALUES (1, 'vazio.txt', '${sha}', 'text/plain; charset=utf-8', 0)`,
  );
  mkdirSync(dirname(caminhoArquivo(servico.banco, sha)), { recursive: true });
  writeFileSync(caminhoArquivo(servico.banco, sha), "");
  const r = await pedir(`/arquivos/${sha}`);
  assert.deepEqual([r.status, r.headers.get("content-length"), await r.text()], [200, "0", ""]);
});
