import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import navegador from "./navegador.ts";

const PAGINA = `<!doctype html><body style="margin:0">
<button id="b" style="position:absolute;left:100px;top:100px;width:200px;height:60px"
  onclick="document.getElementById('r').textContent='clicado'">Enviar</button>
<input id="c" style="position:absolute;left:100px;top:200px;width:300px" onkeydown="if(event.key==='Enter')document.getElementById('r').textContent='enter:'+this.value">
<div id="r" style="position:absolute;left:100px;top:300px"></div>
<div style="position:absolute;top:2000px">fim</div></body>`;

interface Conteudo {
  type: string;
  data?: string;
  text?: string;
  mimeType?: string;
}
interface Ferramenta {
  execute(id: string, p: Record<string, unknown>): Promise<{ content: Conteudo[] }>;
}

/** Carrega a extensão com um pi falso: devolve as ferramentas e dispara o `session_shutdown`. */
function carregar() {
  const ferramentas = new Map<string, Ferramenta>();
  let encerrar = () => Promise.resolve();
  navegador({
    on: (_evento, tratador) => (encerrar = tratador),
    registerTool: (f) => ferramentas.set(f.name, f),
  });
  const usar = (nome: string) => ferramentas.get(nome) ?? assert.fail(nome);
  return { usar, encerrar: () => encerrar(), nomes: [...ferramentas.keys()] };
}

let servidor: Server;
let link: string;
let saida: string;

before(async () => {
  servidor = createServer((_req, res) => res.setHeader("content-type", "text/html").end(PAGINA));
  await new Promise<void>((ok) => servidor.listen(0, "127.0.0.1", ok));
  link = `http://127.0.0.1:${String((servidor.address() as AddressInfo).port)}/`;
  saida = await mkdtemp(join(tmpdir(), "navegador-"));
  process.env.FABRIQUINHA_LINK = link;
  process.env.FABRIQUINHA_SAIDA = saida;
});

after(() => {
  servidor.close();
});

const tela = async (n: ReturnType<typeof carregar>, nome: string, p: Record<string, unknown> = {}) => {
  const { content } = await n.usar(nome).execute("1", p);
  const [imagem, endereco] = content;
  assert.equal(imagem?.type, "image");
  assert.equal(imagem.mimeType, "image/png");
  assert.equal(Buffer.from(String(imagem.data), "base64").subarray(1, 4).toString(), "PNG");
  assert.equal(endereco?.text, `Endereço atual: ${link}`);
  return imagem.data;
};

test("registra as seis ferramentas", () => {
  assert.deepEqual(carregar().nomes, ["ver_tela", "clicar", "digitar", "tecla", "rolar", "relatar"]);
});

test("ver_tela, clicar, digitar, tecla e rolar agem na página e devolvem o print", async () => {
  const n = carregar();
  const inicial = await tela(n, "ver_tela");
  const clicado = await tela(n, "clicar", { x: 150, y: 120 });
  assert.notEqual(clicado, inicial);
  await tela(n, "clicar", { x: 150, y: 210 });
  await tela(n, "digitar", { texto: "oi" });
  const enter = await tela(n, "tecla", { tecla: "Enter" });
  assert.notEqual(enter, clicado);
  const rolada = await tela(n, "rolar", { dy: 1500 });
  assert.notEqual(rolada, enter);
  await n.encerrar();
});

test("relatar grava o relatorio.json", async () => {
  const n = carregar();
  const { content } = await n.usar("relatar").execute("1", { usabilidade: ["botão pequeno"], bugs: [] });
  assert.equal(content[0]?.text, "Relatório gravado.");
  assert.deepEqual(JSON.parse(await readFile(join(saida, "relatorio.json"), "utf8")), {
    usabilidade: ["botão pequeno"],
    bugs: [],
  });
  await n.encerrar();
});

test("página que não carrega volta como erro e a chamada seguinte tenta de novo", async () => {
  const n = carregar();
  process.env.FABRIQUINHA_LINK = "http://127.0.0.1:1/";
  try {
    await assert.rejects(n.usar("ver_tela").execute("1", {}), /net::ERR_/);
    process.env.FABRIQUINHA_LINK = link;
    await tela(n, "ver_tela");
  } finally {
    process.env.FABRIQUINHA_LINK = link;
    await n.encerrar();
  }
});
