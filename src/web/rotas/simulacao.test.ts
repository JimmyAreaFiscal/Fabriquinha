// Rotas da Simulação (F7 §4.2) chamadas como o servidor as chama, contra um banco de verdade. A leitura do corpo e a
// guarda são do servidor (servidor.test.ts); aqui o corpo já chega como o servidor o entrega (JSON ou `Buffer`).
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { abrir } from "../../persistencia/banco.ts";
import { registrarProjeto } from "../../persistencia/projetos.ts";
import { casar } from "../cliente/caminhos.ts";
import { traduzir } from "../erros.ts";
import { ROTAS } from "../servidor.ts";

const base = mkdtempSync(join(tmpdir(), "fabriquinha-rotas-simulacao-"));
after(() => {
  rmSync(base, { recursive: true, force: true });
});

const banco = abrir(base);
registrarProjeto(banco, {
  nome: "fabriquinha",
  repo: "/repos/fabriquinha",
  branchBase: "main",
  hospedagem: "github",
  testes: ["npm test"],
  sonar: { projectKey: "Fabriquinha" },
  fitness: [{ nome: "f", comando: "true", descricao: "d" }],
});

/** Chama a rota como o servidor: o valor devolvido, ou `[status, mensagem]` do erro traduzido. */
async function chamar(metodo: string, caminho: string, corpo?: unknown): Promise<unknown> {
  const [path, busca = ""] = caminho.split("?");
  for (const rota of ROTAS) {
    const params = rota.metodo === metodo ? casar(rota.caminho, String(path)) : undefined;
    if (!params) continue;
    try {
      return await rota.tratar({
        banco,
        agendador: { proximaBusca: () => new Date(), executarAgora: () => Promise.resolve() },
        params,
        query: new URLSearchParams(busca),
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
