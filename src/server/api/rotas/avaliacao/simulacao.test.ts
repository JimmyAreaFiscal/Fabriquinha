// Rotas da Simulação (F7 §4.2) chamadas como o servidor as chama, contra um banco de verdade. A leitura do corpo e a
// guarda são do servidor (servidor.test.ts); aqui o corpo já chega como o servidor o entrega (JSON ou `Buffer`).
import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import { after, test } from "node:test";
import { abrirBancoTemporario } from "../../../../../apoio-testes/banco_temporario.ts";
import { createServer } from "node:net";
import { setTimeout as dormir } from "node:timers/promises";
import { editarProjeto, registrarProjeto } from "../../../../modulos/projeto/aplicacao/cadastro.ts";
import { buscarProjeto } from "../../../../modulos/projeto/armazenamento/projetos.ts";
import { relogioDoSistema } from "../../../../modulos/compartilhado/nucleo/relogio.ts";
import { casar } from "../../../web/compartilhado/caminhos.ts";
import { traduzir } from "../../erros.ts";
import type { Rota } from "../../rotas.ts";
import { ROTAS } from "../../servidor.ts";

const { banco, fechar } = abrirBancoTemporario();
after(fechar);
registrarProjeto(banco, {
  nome: "fabriquinha",
  raiz_git: "/repos/fabriquinha",
  branch_base: "main",
  hospedagem: "github",
  chave_sonarqube: "Fabriquinha",
});

/** O corpo 2xx em JSON passa pelo schema do contrato da rota; o 204 não tem corpo. */
function conferirContrato(rota: Rota, valor: unknown): void {
  if (valor === undefined) return;
  assert.ok(rota.resposta, `${rota.metodo} ${rota.caminho} não declara o schema da resposta`);
  rota.resposta.parse(JSON.parse(JSON.stringify(valor)));
}

/** Chama a rota como o servidor: o valor devolvido, ou `[status, mensagem]` do erro traduzido. */
async function chamar(metodo: string, caminho: string, corpo?: unknown): Promise<unknown> {
  const [path, busca = ""] = caminho.split("?");
  for (const rota of ROTAS) {
    const params = rota.metodo === metodo ? casar(rota.caminho, String(path)) : undefined;
    if (!params) continue;
    let valor: unknown;
    try {
      valor = await rota.tratar({
        banco,
        agendador: { proximaBusca: () => new Date() },
        relogio: relogioDoSistema,
        params,
        query: new URLSearchParams(busca),
        corpo,
        cabecalhos: {},
        resposta: undefined as unknown as ServerResponse,
      });
    } catch (erro) {
      return traduzir(erro);
    }
    conferirContrato(rota, valor);
    return valor;
  }
  throw new Error(`${metodo} ${caminho} não existe`);
}

const MARIA = { nome: "Dona Maria", descricao: "Contadora de 60 anos, pouca familiaridade com sistemas web" };
const LISTA = "/api/projetos/fabriquinha/usuarios-simulados";

test("criar e listar Usuários Simulados do projeto (CA-3)", async () => {
  assert.deepEqual(await chamar("GET", LISTA), []);
  const criado = (await chamar("POST", LISTA, MARIA)) as { id: number };
  assert.deepEqual(criado, { id: criado.id, projeto: "fabriquinha", ...MARIA, anexos: [] });
  assert.deepEqual(await chamar("GET", LISTA), [criado]);
});

test("campo inválido dá 422 com o caminho do campo; nome repetido dá 409; projeto inexistente dá 404 (CA-4)", async () => {
  assert.deepEqual(await chamar("POST", LISTA, { nome: "Seu João", descricao: "" }), [
    422,
    "✖ Descrição obrigatória\n  → at descricao",
  ]);
  assert.deepEqual(await chamar("POST", LISTA, MARIA), [
    409,
    "já existe o Usuário Simulado Dona Maria no projeto fabriquinha (escolha outro nome para o novo usuário)",
  ]);
  assert.deepEqual(await chamar("GET", "/api/projetos/fantasma/usuarios-simulados"), [
    404,
    "o projeto fantasma não existe (confira o nome do projeto)",
  ]);
});

test("anexar com corpo binário aparece na lista com o tamanho (CA-5) e remover o tira (CA-6)", async () => {
  const [{ id }] = (await chamar("GET", LISTA)) as [{ id: number }];
  const conteudo = Buffer.from("%PDF-1.4 manual");
  const anexo = (await chamar("POST", `/api/usuarios-simulados/${String(id)}/anexos?nome=manual.pdf`, conteudo)) as {
    nome: string;
    bytes: number;
  };
  assert.deepEqual([anexo.nome, anexo.bytes], ["manual.pdf", conteudo.length]);
  const [maria] = (await chamar("GET", LISTA)) as [{ anexos: unknown[] }];
  assert.deepEqual(maria.anexos, [anexo]);

  assert.equal(await chamar("DELETE", `/api/usuarios-simulados/${String(id)}/anexos/manual.pdf`), undefined);
  assert.deepEqual(((await chamar("GET", LISTA)) as [{ anexos: unknown[] }])[0].anexos, []);
  assert.deepEqual(await chamar("DELETE", `/api/usuarios-simulados/${String(id)}/anexos/manual.pdf`), [
    404,
    `o Usuário Simulado ${String(id)} não tem o anexo manual.pdf (confira o nome do anexo)`,
  ]);
});

test("o nome do anexo vem codificado na URL e é conferido; corpo que não é binário dá 422", async () => {
  const [{ id }] = (await chamar("GET", LISTA)) as [{ id: number }];
  const caminho = `/api/usuarios-simulados/${String(id)}/anexos`;
  const acentuado = (await chamar(
    "POST",
    `${caminho}?nome=${encodeURIComponent("guia rápido.md")}`,
    Buffer.from("#"),
  )) as {
    nome: string;
  };
  assert.equal(acentuado.nome, "guia rápido.md");
  assert.equal(await chamar("DELETE", `${caminho}/${encodeURIComponent("guia rápido.md")}`), undefined);

  const formato = [422, "✖ formato não suportado: envie PDF, texto ou imagem\n  → at nome"];
  assert.deepEqual(await chamar("POST", `${caminho}?nome=planilha.xlsx`, Buffer.from("x")), formato);
  assert.equal(((await chamar("POST", caminho, Buffer.from("x"))) as [number])[0], 422); // sem ?nome=
  const [status, mensagem] = (await chamar("POST", `${caminho}?nome=a.txt`, { nome: "a.txt" })) as [number, string];
  assert.deepEqual(
    [status, mensagem],
    [422, "envie o arquivo como corpo binário (Content-Type: application/octet-stream)"],
  );
  assert.equal(((await chamar("POST", `${caminho}?nome=a.txt`)) as [number])[0], 422);
  assert.equal(
    ((await chamar("POST", "/api/usuarios-simulados/abc/anexos?nome=a.txt", Buffer.from("x"))) as [number])[0],
    422,
  );
  assert.equal(
    ((await chamar("POST", "/api/usuarios-simulados/999/anexos?nome=a.txt", Buffer.from("x"))) as [number])[0],
    404,
  );
});

const TAREFAS = "/api/projetos/fabriquinha/tarefas";

test("criar e listar Tarefas alocadas a Usuários Simulados do projeto (CA-7)", async () => {
  assert.deepEqual(await chamar("GET", TAREFAS), []);
  const [{ id }] = (await chamar("GET", LISTA)) as [{ id: number }];
  const criada = (await chamar("POST", TAREFAS, { texto: "Registrar uma necessidade", n: 3, usuarios: [id] })) as {
    id: number;
  };
  assert.deepEqual(criada, {
    id: criada.id,
    projeto: "fabriquinha",
    texto: "Registrar uma necessidade",
    n: 3,
    criadaEm: (criada as unknown as { criadaEm: string }).criadaEm,
    usuarios: [{ id, nome: "Dona Maria" }],
    execucoes: [],
  });
  assert.deepEqual(await chamar("GET", TAREFAS), [criada]);
});

test("Tarefa inválida dá 422 com o caminho do campo (CA-8 e CA-9); usuário alheio dá 409; projeto inexistente, 404", async () => {
  const [{ id }] = (await chamar("GET", LISTA)) as [{ id: number }];
  assert.deepEqual(await chamar("POST", TAREFAS, { texto: "t", n: 0, usuarios: [id] }), [
    422,
    "✖ N deve ser um inteiro maior que zero\n  → at n",
  ]);
  assert.deepEqual(await chamar("POST", TAREFAS, { texto: "t", n: 1, usuarios: [] }), [
    422,
    "✖ Aloque ao menos um usuário simulado\n  → at usuarios",
  ]);
  assert.deepEqual(await chamar("POST", TAREFAS, { texto: "", n: 21, usuarios: [id] }), [
    422,
    "✖ Tarefa obrigatória\n  → at texto\n✖ N passa de 20\n  → at n",
  ]);
  assert.deepEqual(await chamar("POST", TAREFAS, { texto: "t", n: 1, usuarios: [999] }), [
    409,
    "o Usuário Simulado 999 não é do projeto fabriquinha (aloque só usuários simulados do projeto)",
  ]);
  assert.deepEqual(await chamar("GET", "/api/projetos/fantasma/tarefas"), [
    404,
    "o projeto fantasma não existe (confira o nome do projeto)",
  ]);
  assert.equal(((await chamar("GET", TAREFAS)) as unknown[]).length, 1);
});

/** Uma porta onde ninguém escuta: a conexão é rejeitada. */
async function portaFechada(): Promise<number> {
  const servidor = createServer();
  await new Promise<void>((pronto) => servidor.listen(0, "127.0.0.1", pronto));
  const { port } = servidor.address() as { port: number };
  await new Promise((pronto) => servidor.close(pronto));
  return port;
}

type ComExecucoes = { id: number; execucoes: { status: string; erro?: string }[] }[];

test("Executar sem link do produto dá 409 com a mensagem do CA-10, e Tarefa inexistente ou ID inválido dão 404 e 422", async () => {
  const [{ id }] = (await chamar("GET", TAREFAS)) as [{ id: number }];
  assert.deepEqual(await chamar("POST", `/api/tarefas/${String(id)}/executar`), [
    409,
    "Informe o link do produto na Configuração do projeto",
  ]);
  assert.deepEqual(((await chamar("GET", TAREFAS)) as ComExecucoes)[0]?.execucoes, []);
  assert.deepEqual(await chamar("POST", "/api/tarefas/999/executar"), [
    404,
    "a Tarefa 999 não existe (confira a Tarefa na página Simulação)",
  ]);
  assert.equal(((await chamar("POST", "/api/tarefas/abc/executar")) as [number])[0], 422);
});

test("Executar responde 204 com as execuções na fila, recusa uma segunda com 409 e termina falhou com o link fora do ar (CA-14)", async () => {
  const atual = buscarProjeto(banco, "fabriquinha");
  assert.ok(atual);
  editarProjeto(banco, { ...atual, link_produto: `http://127.0.0.1:${String(await portaFechada())}` });
  const [{ id }] = (await chamar("GET", TAREFAS)) as [{ id: number }];

  assert.equal(await chamar("POST", `/api/tarefas/${String(id)}/executar`), undefined);
  const logo = ((await chamar("GET", TAREFAS)) as ComExecucoes)[0]?.execucoes;
  assert.equal(logo?.length, 3);
  assert.ok(logo.every((e) => e.status === "na_fila" || e.status === "em_andamento"));
  assert.deepEqual(await chamar("POST", `/api/tarefas/${String(id)}/executar`), [
    409,
    "a Tarefa já está em execução (espere ela terminar para executar de novo)",
  ]);

  let execucoes = logo;
  while (execucoes.some((e) => e.status === "na_fila" || e.status === "em_andamento")) {
    await dormir(20);
    execucoes = ((await chamar("GET", TAREFAS)) as ComExecucoes)[0]?.execucoes ?? [];
  }
  assert.deepEqual(
    execucoes.map((e) => [e.status, e.erro]),
    Array.from({ length: 3 }, () => ["falhou", "Não foi possível abrir o link do produto"]),
  );
});
