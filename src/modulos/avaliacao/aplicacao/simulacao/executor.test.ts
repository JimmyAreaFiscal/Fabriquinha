// Executor da Simulação (F8 §5) contra banco real, um servidor HTTP local no lugar do produto e um pi falso
// roteirizado: grava o que recebeu e entrega ou não o relatório conforme o passo.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer as servidorHttp, type Server } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after, before, beforeEach, test } from "node:test";
import { fabricaDeBancosTemporarios } from "../../../../../apoio-testes/banco_temporario.ts";
import { instalarPiFalso, type PiFalso } from "../../../../../apoio-testes/pi_falso.ts";
import { relogioFixo } from "../../../compartilhado/nucleo/relogio.ts";
import { SEM_LINK } from "../../nucleo/simulacao.ts";
import { PACOTE } from "../../../harness/pi/pi.ts";
import { raizDo } from "../../../compartilhado/armazenamento/banco.ts";
import { dirDaExecucaoSimulada } from "../../../compartilhado/infra/registro.ts";
import { buscarProjeto } from "../../../projeto/armazenamento/projetos.ts";
import { editarProjeto, registrarProjeto } from "../../../projeto/aplicacao/cadastro.ts";
import { anexar, criarTarefa, criarUsuarioSimulado, tarefas } from "../../armazenamento/simulacao.ts";
import { conferirLink, executarTarefa, executarTarefaComConfiguracao } from "./executor.ts";

const abrirBancoTemporario = fabricaDeBancosTemporarios();
const base = mkdtempSync(join(tmpdir(), "fabriquinha-executor-"));
const OPCOES = { timeoutMin: 1, relogio: relogioFixo("2026-05-01T12:00:00.000Z") };

const ordem = join(base, "ordem");
let piFalso: PiFalso;
let produto: Server;
let link: string;
const antes = { ...process.env };

before(async () => {
  piFalso = instalarPiFalso(base);
  process.env.FABRIQUINHA_ROOT = join(base, "raiz");
  process.env.FALSO_PI_ORDEM = ordem;
  process.env.GH_TOKEN = "segredo";
  produto = servidorHttp((_, resposta) => {
    resposta.statusCode = 500; // a página quebrada ainda é um produto no ar
    resposta.end("erro");
  });
  await new Promise<void>((pronto) => produto.listen(0, "127.0.0.1", pronto));
  link = `http://127.0.0.1:${String((produto.address() as { port: number }).port)}`;
});

after(async () => {
  process.env = antes;
  await new Promise((pronto) => produto.close(pronto));
  rmSync(base, { recursive: true, force: true });
});

beforeEach(() => {
  piFalso.roteirizar([
    {
      simulacao: {
        relatorio: { usabilidade: ["O botão Enviar é pequeno"], bugs: [] },
        demoraMs: 40,
        registraArgs: true,
      },
    },
  ]);
});

const DESCRICAO = "Contadora de 60 anos, pouca familiaridade com sistemas web";

/** Um banco com o projeto `p` (com `link_produto`), os usuários `usuarios` e uma Tarefa de `n` execuções para todos. */
function cenario(texto: string, n: number, usuarios = ["Dona Maria"], link_produto = link) {
  const { banco } = abrirBancoTemporario();
  registrarProjeto(banco, {
    nome: "p",
    raiz_git: "/repos/p",
    branch_base: "main",
    hospedagem: "github",
    chave_sonarqube: "p",
    link_produto,
  });
  const alocados = usuarios.map((nome) => criarUsuarioSimulado(banco, "p", { nome, descricao: DESCRICAO }));
  const tarefa = criarTarefa(banco, "p", { texto, n, usuarios: alocados.map((u) => u.id) });
  return { banco, tarefa: tarefa.id, usuarios: alocados };
}

const execucoes = (banco: DatabaseSync) => tarefas(banco, "p").flatMap((t) => t.execucoes);
/** A pasta da execução simulada `id`. */
const dirDe = (banco: DatabaseSync, id: number) => dirDaExecucaoSimulada(raizDo(banco), id);
/** O que o pi falso gravou ao subir, na pasta da execução `id`. */
const lido = (banco: DatabaseSync, id: number) =>
  JSON.parse(readFileSync(join(dirDe(banco, id), "args.json"), "utf8")) as {
    args: string[];
    link: string;
    saida: string;
    token: string | null;
    arquivos: string[];
  };
/** O ID da primeira execução da Tarefa. */
const primeira = (banco: DatabaseSync) => execucoes(banco)[0]?.id ?? 0;

test("conferirLink: qualquer resposta HTTP conta como no ar; conexão rejeitada, não", async () => {
  assert.equal(await conferirLink(link), true);
  const portaFechada = createServer();
  await new Promise<void>((pronto) => portaFechada.listen(0, "127.0.0.1", pronto));
  const { port } = portaFechada.address() as { port: number };
  await new Promise((pronto) => portaFechada.close(pronto));
  assert.equal(await conferirLink(`http://127.0.0.1:${String(port)}`), false);
});

test("sem link do produto, executarTarefa lança antes de enfileirar (CA-10)", () => {
  const { banco, tarefa } = cenario("Registrar uma necessidade", 1, ["Dona Maria"], "");
  assert.throws(() => executarTarefa(banco, tarefa, OPCOES), { message: SEM_LINK });
  assert.deepEqual(execucoes(banco), []);
  banco.close();
});

test("N execuções por usuário, uma por vez, todas concluídas com o relatório (CA-11 e CA-12)", async () => {
  writeFileSync(ordem, "");
  const { banco, tarefa, usuarios } = cenario("Registrar uma necessidade", 2, ["Dona Maria", "Seu João"]);
  const fim = executarTarefa(banco, tarefa, OPCOES);
  // Enfileirou já, de forma síncrona: nenhuma execução rodou ainda.
  assert.deepEqual(
    execucoes(banco).map((e) => e.status),
    ["em_andamento", "na_fila", "na_fila", "na_fila"],
  );
  await fim;

  const feitas = execucoes(banco);
  assert.deepEqual(
    feitas.map((e) => [e.usuarioNome, e.status]),
    [
      ["Dona Maria", "concluida"],
      ["Dona Maria", "concluida"],
      ["Seu João", "concluida"],
      ["Seu João", "concluida"],
    ],
  );
  assert.deepEqual(feitas[0]?.relatorio, { usabilidade: ["O botão Enviar é pequeno"], bugs: [] });
  assert.deepEqual(
    feitas.map((e) => e.usuario),
    [usuarios[0]?.id, usuarios[0]?.id, usuarios[1]?.id, usuarios[1]?.id],
  );
  assert.equal(readFileSync(ordem, "utf8"), "ini\nfim\n".repeat(4));
  const row = banco.prepare("SELECT iniciada_em, terminada_em, pgid FROM execucao_simulada WHERE id = 1").get();
  assert.ok(row?.iniciada_em && row.terminada_em);
  assert.equal(row.pgid, null);
  banco.close();
});

test("o pi sobe com as ferramentas do navegador, o prompt da persona e o ambiente sem credenciais", async () => {
  writeFileSync(ordem, "");
  const { banco, tarefa } = cenario("Registrar uma necessidade", 1);
  await executarTarefa(banco, tarefa, OPCOES);

  const id = primeira(banco);
  const dir = dirDe(banco, id);
  const { args, link: linkVisto, saida, token, arquivos } = lido(banco, id);
  const prompt = String(args.at(-1));
  assert.deepEqual(args.slice(0, -1), [
    "--mode",
    "json",
    "--session-dir",
    join(dir, "sessao"),
    "--tools",
    "ver_tela,clicar,digitar,tecla,rolar,relatar",
    "-e",
    join(PACOTE, "extensions", "navegador.ts"),
  ]);
  for (const trecho of ["Dona Maria", DESCRICAO, "Registrar uma necessidade", link, "irreversíveis", "`relatar`"]) {
    assert.ok(prompt.includes(trecho), `o prompt não diz ${trecho}`);
  }
  assert.equal(linkVisto, link);
  assert.equal(saida, join(dir, "saida"));
  assert.equal(token, null);
  assert.deepEqual(arquivos, ["saida"]);
  banco.close();
});

test("o anexo vai para a pasta da execução por hard link, com o nome original, e como @arquivo", async () => {
  writeFileSync(ordem, "");
  const { banco, tarefa, usuarios } = cenario("Registrar uma necessidade", 1);
  anexar(banco, usuarios[0]?.id ?? 0, "guia rápido.md", Buffer.from("# Guia\n"));
  await executarTarefa(banco, tarefa, OPCOES);

  const id = primeira(banco);
  const dir = dirDe(banco, id);
  const { args, arquivos } = lido(banco, id);
  assert.ok(args.includes(`@${join(dir, "guia rápido.md")}`));
  assert.ok(String(args.at(-1)).includes("manuais e materiais"));
  assert.deepEqual(arquivos, ["guia rápido.md", "saida"]);
  assert.equal(readFileSync(join(dir, "guia rápido.md"), "utf8"), "# Guia\n");
  assert.equal(statSync(join(dir, "guia rápido.md")).nlink, 2); // o de arquivos/ e o da execução
  banco.close();
});

const PDF = `%PDF-1.1
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 40>>stream
BT /F1 12 Tf 10 50 Td (Ola manual) Tj ET
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R/Size 6>>
%%EOF
`;

test("o PDF vira também <nome>.txt pelo pdftotext, que é o que vai como @arquivo", async () => {
  writeFileSync(ordem, "");
  const { banco, tarefa, usuarios } = cenario("Registrar uma necessidade", 1);
  anexar(banco, usuarios[0]?.id ?? 0, "manual.PDF", Buffer.from(PDF));
  await executarTarefa(banco, tarefa, OPCOES);

  const id = primeira(banco);
  const dir = dirDe(banco, id);
  assert.equal(execucoes(banco)[0]?.status, "concluida");
  const { args, arquivos } = lido(banco, id);
  assert.match(readFileSync(join(dir, "manual.PDF.txt"), "utf8"), /Ola manual/);
  assert.ok(args.includes(`@${join(dir, "manual.PDF.txt")}`));
  assert.ok(!args.includes(`@${join(dir, "manual.PDF")}`));
  assert.deepEqual(arquivos, ["manual.PDF", "manual.PDF.txt", "saida"]);
  banco.close();
});

test("um PDF que o pdftotext não lê falha só a execução dele, com a mensagem, e as seguintes rodam", async () => {
  writeFileSync(ordem, "");
  const { banco, tarefa, usuarios } = cenario("Registrar uma necessidade", 2);
  anexar(banco, usuarios[0]?.id ?? 0, "quebrado.pdf", Buffer.from("isto não é um PDF"));
  await executarTarefa(banco, tarefa, OPCOES);

  const feitas = execucoes(banco);
  assert.deepEqual(
    feitas.map((e) => e.status),
    ["falhou", "falhou"],
  );
  assert.match(
    feitas[0]?.erro ?? "",
    /^o pdftotext não leu o anexo quebrado\.pdf: .+\(confira o PDF do usuário simulado\)$/s,
  );
  assert.equal(readFileSync(ordem, "utf8"), ""); // o pi nem chegou a subir
  banco.close();
});

test("sem relatório válido a execução falha com a mensagem, e a seguinte roda", async () => {
  for (const marca of ["[sem relatório]", "[lixo]"]) {
    writeFileSync(ordem, "");
    const { banco, tarefa } = cenario(`Registrar ${marca}`, 2);
    piFalso.roteirizar([
      { simulacao: { relatorio: marca === "[lixo]" ? "isso não é json" : null, demoraMs: 40, registraArgs: true } },
    ]);
    await executarTarefa(banco, tarefa, OPCOES);
    assert.deepEqual(
      execucoes(banco).map((e) => [e.status, e.erro, e.relatorio]),
      Array.from({ length: 2 }, () => ["falhou", "o agente não entregou o relatório", undefined]),
    );
    assert.equal(readFileSync(ordem, "utf8"), "ini\nfim\n".repeat(2));
    banco.close();
  }
});

test("passado timeoutMin o pi é parado e a execução falha", async () => {
  writeFileSync(ordem, "");
  const { banco, tarefa } = cenario("Registrar [demora]", 1);
  piFalso.roteirizar([{ simulacao: { nuncaTermina: true, registraArgs: true } }]);
  await executarTarefa(banco, tarefa, { ...OPCOES, timeoutMin: 0.001 });
  assert.deepEqual(
    execucoes(banco).map((e) => [e.status, e.erro]),
    [["falhou", "passou do limite de 0.001 min e foi encerrado"]],
  );
  assert.equal(banco.prepare("SELECT pgid FROM execucao_simulada").get()?.pgid, null);
  banco.close();
});

test("executarTarefaComConfiguracao usa o timeoutMin da Configuração e grava o instante do relógio", async () => {
  writeFileSync(ordem, "");
  const { banco, tarefa } = cenario("Registrar [demora]", 1);
  banco.exec("PRAGMA ignore_check_constraints = ON"); // o mínimo da Configuração é 10 min; o teste não espera isso
  banco.prepare("UPDATE configuracao SET timeout_min = 0.001").run();
  piFalso.roteirizar([{ simulacao: { nuncaTermina: true, registraArgs: true } }]);
  await executarTarefaComConfiguracao(banco, tarefa, OPCOES.relogio);
  assert.deepEqual(
    execucoes(banco).map((e) => [e.status, e.erro]),
    [["falhou", "passou do limite de 0.001 min e foi encerrado"]],
  );
  assert.equal(banco.prepare("SELECT terminada_em FROM execucao_simulada").get()?.terminada_em, OPCOES.relogio.agora());
  banco.close();
});

test("link fora do ar: a execução falha com a mensagem do CA-14, sem subir o pi, e as seguintes também", async () => {
  writeFileSync(ordem, "");
  const portaFechada = createServer();
  await new Promise<void>((pronto) => portaFechada.listen(0, "127.0.0.1", pronto));
  const { port } = portaFechada.address() as { port: number };
  await new Promise((pronto) => portaFechada.close(pronto));
  const { banco, tarefa } = cenario("Registrar uma necessidade", 2, ["Dona Maria"], `http://127.0.0.1:${String(port)}`);
  await executarTarefa(banco, tarefa, OPCOES);

  assert.deepEqual(
    execucoes(banco).map((e) => [e.status, e.erro]),
    Array.from({ length: 2 }, () => ["falhou", "Não foi possível abrir o link do produto"]),
  );
  assert.equal(readFileSync(ordem, "utf8"), "");
  banco.close();
});

test("o link vale o do momento do Executar, mesmo que a Configuração mude no meio", async () => {
  writeFileSync(ordem, "");
  const { banco, tarefa } = cenario("Registrar uma necessidade", 2);
  const fim = executarTarefa(banco, tarefa, OPCOES);
  const atual = buscarProjeto(banco, "p");
  assert.ok(atual);
  editarProjeto(banco, { ...atual, link_produto: "http://127.0.0.1:1" });
  await fim;
  assert.deepEqual(
    execucoes(banco).map((e) => e.status),
    ["concluida", "concluida"],
  );
  banco.close();
});

test("sem o binário do pi a execução falha por não ter entregue o relatório", async () => {
  const { banco, tarefa } = cenario("Registrar uma necessidade", 1);
  const original = process.env.FABRIQUINHA_PI;
  process.env.FABRIQUINHA_PI = join(base, "nao-existe");
  try {
    await executarTarefa(banco, tarefa, OPCOES);
  } finally {
    process.env.FABRIQUINHA_PI = original;
  }
  assert.deepEqual(
    execucoes(banco).map((e) => [e.status, e.erro]),
    [["falhou", "o agente não entregou o relatório"]],
  );
  assert.match(readFileSync(join(dirDe(banco, primeira(banco)), "log"), "utf8"), /ENOENT/);
  banco.close();
});
