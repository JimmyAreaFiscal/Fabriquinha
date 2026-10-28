// CLI externo da demanda (CA-1 a CA-19) contra banco real numa raiz temporária.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { after, test } from "node:test";
import { caminhoArquivo } from "../persistencia/arquivos.ts";
import { abrir } from "../persistencia/banco.ts";
import { principal } from "./cli.ts";
import { COMANDOS_DEMANDA_EXTERNA, ErroDeUso } from "./demanda_externa.ts";

const base = mkdtempSync(join(tmpdir(), "fabriquinha-demanda-externa-"));
const pasta = mkdtempSync(join(base, "pasta-"));
const cwd = process.cwd();
process.chdir(pasta); // os anexos vêm da pasta do comando
after(() => {
  process.chdir(cwd);
  rmSync(base, { recursive: true, force: true });
});

const arquivo = (nome: string, conteudo: string | object): string => {
  const caminho = join(pasta, nome);
  writeFileSync(caminho, typeof conteudo === "string" ? conteudo : JSON.stringify(conteudo));
  return caminho;
};

const CRITERIOS = { criterios: [{ id: "CA-1", dado: "d", quando: "q", entao: "e" }] };
const DESENHO = { resumo: "r", arquivosPrevistos: [{ caminho: "src/a.ts", acao: "criar", motivo: "m" }] };
const CUSTOS = {
  sessoes: [
    {
      ferramenta: "claude",
      sessao: "ext",
      linhas: [
        {
          provedor: "a",
          modelo: "m",
          tokens_entrada: 1,
          tokens_saida: 1,
          tokens_cache_leitura: 0,
          tokens_cache_escrita: 0,
        },
      ],
    },
  ],
};
const HTML = "<!doctype html><p>x</p>";
arquivo("desc.md", "descrição");
arquivo("criterios.json", CRITERIOS);
arquivo("desenho.json", DESENHO);
arquivo("custos.json", CUSTOS);
arquivo("desenho.html", HTML);

const novaRaiz = (): NodeJS.ProcessEnv => {
  const raiz = mkdtempSync(join(base, "raiz-"));
  const b = abrir(raiz);
  b.exec(`INSERT INTO projeto (nome, repo, branch_base, hospedagem, testes, sonar_project_key, fitness)
    VALUES ('fabriquinha', '/repo/f', 'main', 'github', '["t"]', 'k', '[{"nome":"f","comando":"c","descricao":"d"}]')`);
  b.close();
  return { FABRIQUINHA_ROOT: raiz, FABRIQUINHA_FERRAMENTA: "claude", FABRIQUINHA_SESSAO: "S1" };
};

async function cli(env: NodeJS.ProcessEnv, args: string[], stdin = "") {
  let out = "";
  let err = "";
  const codigo = await principal(args, {
    env,
    stdin: Readable.from([stdin]),
    stdout: { write: (t: string) => (out += t) },
    stderr: { write: (t: string) => (err += t) },
    parada: () => Promise.resolve(),
  });
  return { codigo, out, err };
}

type Saida = Awaited<ReturnType<typeof cli>>;
interface Visao {
  id: string;
  titulo: string;
  descricao: string;
  fase: string;
  enviada: boolean;
  dependencias: string[];
  avisos: string[];
  evidencias: { tipo: string; arquivos: { nome: string; sha256: string }[] }[];
}
interface Schema {
  dados: { properties: { sessoes: unknown } };
  arquivos: { min: number; max?: number };
}
const ler = (s: Saida): unknown => {
  assert.equal(s.err, "");
  assert.equal(s.codigo, 0);
  assert.match(s.out, /^[^\n]+\n$/);
  return JSON.parse(s.out);
};
const json = (s: Saida) => ler(s) as Visao;
const jsonSchema = (s: Saida) => ler(s) as Schema;
const falha = (s: Saida, codigo: number, mensagem: RegExp) => {
  assert.deepEqual([s.codigo, s.out], [codigo, ""]);
  assert.match(s.err, mensagem);
};

const REGISTRAR = ["demanda", "registrar", "--projeto", "fabriquinha", "--titulo", "T", "--tipo", "funcionalidade"];
const registrar = async (env: NodeJS.ProcessEnv, extra: string[] = []) =>
  json(await cli(env, [...REGISTRAR, "--descricao", "desc.md", ...extra])).id;
const outra = (env: NodeJS.ProcessEnv) => ({ ...env, FABRIQUINHA_SESSAO: "S2" });
const completar = async (env: NodeJS.ProcessEnv, id: string, pular = "") => {
  const evid = [
    ["criterios_aceite", "criterios.json"],
    ["desenho_solucao", "desenho.json", "--arquivo", "desenho.html"],
    ["custos_realizados", "custos.json"],
  ].filter(([tipo]) => tipo !== pular);
  for (const [tipo, dados, ...resto] of evid) {
    json(await cli(env, ["demanda", "evidencia", id, String(tipo), "--dados", String(dados), ...resto]));
  }
};

test("CA-1 e CA-2: registra I-n não enviada e a seguinte com dependência", async () => {
  const env = novaRaiz();
  const r = json(await cli(env, [...REGISTRAR, "--descricao", "desc.md"]));
  assert.deepEqual([r.id, r.enviada, r.dependencias], ["I-1", false, []]);
  const d = json(await cli(env, [...REGISTRAR, "--descricao", "-", "--dep", "1"], "do stdin"));
  assert.deepEqual([d.id, d.descricao, d.dependencias], ["I-2", "do stdin", ["I-1"]]);
});

test("CA-3: dependência inexistente é recusada e nada é criado", async () => {
  const env = novaRaiz();
  falha(await cli(env, [...REGISTRAR, "--descricao", "desc.md", "--dep", "I-9"]), 1, /I-9/);
  assert.equal(await registrar(env), "I-1");
});

test("CA-4: projeto inexistente é recusado e o número não é consumido", async () => {
  const env = novaRaiz();
  const args = [...REGISTRAR, "--descricao", "desc.md"];
  args[3] = "nao-existe";
  falha(await cli(env, args), 1, /projeto nao-existe não existe/);
  assert.equal(await registrar(env), "I-1");
});

test("CA-5: sem ferramenta ou sessão de origem, código 2 nomeando o que falta", async () => {
  const env = novaRaiz();
  const args = [...REGISTRAR, "--descricao", "desc.md"];
  falha(await cli({ ...env, FABRIQUINHA_FERRAMENTA: "" }, args), 2, /^falta a ferramenta de origem/);
  falha(await cli({ ...env, FABRIQUINHA_SESSAO: "" }, args), 2, /^falta a sessão de origem/);
  falha(await cli({ FABRIQUINHA_ROOT: env.FABRIQUINHA_ROOT }, args), 2, /ferramenta.* e a sessão/);
  assert.equal(
    await registrar({ ...env, FABRIQUINHA_FERRAMENTA: "", FABRIQUINHA_SESSAO: "" }, [
      "--ferramenta",
      "pi",
      "--sessao",
      "x",
    ]),
    "I-1",
  );
});

test("CA-6: sem --titulo, código 2", async () => {
  const env = novaRaiz();
  falha(await cli(env, ["demanda", "registrar", "--projeto", "fabriquinha"]), 2, /^falta --titulo/);
});

test("CA-7, CA-8 e CA-9: editar pela autora, por outra sessão e depois do envio", async () => {
  const env = novaRaiz();
  const id = await registrar(env);
  assert.equal(json(await cli(env, ["demanda", "editar", id, "--titulo", "Novo"])).titulo, "Novo");
  const d = json(await cli(env, ["demanda", "editar", "1", "--descricao", "-"], "outra"));
  assert.equal(d.descricao, "outra");
  falha(
    await cli(outra(env), ["demanda", "editar", id, "--titulo", "X"]),
    1,
    /só a ferramenta claude da sessão S1 pode editar/,
  );
  assert.equal(json(await cli(env, ["demanda", "ver", id])).titulo, "Novo");
  await completar(env, id);
  json(await cli(env, ["demanda", "enviar", id]));
  falha(await cli(env, ["demanda", "editar", id, "--titulo", "X"]), 1, /congelado/);
});

test("CA-10: evidência com anexo guarda o arquivo por SHA-256 e a demanda a lista", async () => {
  const env = novaRaiz();
  const id = await registrar(env);
  const r = json(
    await cli(env, [
      "demanda",
      "evidencia",
      id,
      "desenho_solucao",
      "--dados",
      "desenho.json",
      "--arquivo",
      "desenho.html",
    ]),
  );
  assert.deepEqual(r.avisos, []);
  const [ev] = json(await cli(env, ["demanda", "ver", id])).evidencias;
  assert.ok(ev);
  assert.equal(ev.tipo, "desenho_solucao");
  assert.deepEqual(
    ev.arquivos.map((a: { nome: string }) => a.nome),
    ["desenho.html"],
  );
  const b = abrir(env.FABRIQUINHA_ROOT);
  assert.equal(readFileSync(caminhoArquivo(b, ev.arquivos[0]?.sha256 ?? ""), "utf8"), HTML);
  b.close();
});

test("anexo fora da pasta do comando é recusado", async () => {
  const env = novaRaiz();
  const id = await registrar(env);
  const fora = join(base, "fora.html");
  writeFileSync(fora, HTML);
  falha(
    await cli(env, ["demanda", "evidencia", id, "desenho_solucao", "--dados", "desenho.json", "--arquivo", fora]),
    1,
    /fora da pasta do comando/,
  );
  assert.equal(existsSync(fora), true);
});

test("CA-11: custos depois do envio, sem custo informado", async () => {
  const env = novaRaiz();
  const id = await registrar(env);
  await completar(env, id);
  json(await cli(env, ["demanda", "enviar", id]));
  const r = json(
    await cli(env, ["demanda", "evidencia", id, "custos_realizados", "--dados", "-"], JSON.stringify(CUSTOS)),
  );
  assert.equal(r.evidencias.filter((e: { tipo: string }) => e.tipo === "custos_realizados").length, 1);
  const b = abrir(env.FABRIQUINHA_ROOT);
  const linha = b.prepare("SELECT dados FROM evidencia_demanda WHERE tipo = 'custos_realizados'").get();
  assert.equal(
    (JSON.parse(String(linha?.dados)) as { sessoes: { linhas: { custo: null }[] }[] }).sessoes[0]?.linhas[0]?.custo,
    null,
  );
  b.close();
});

test("evidência: tipo inválido, sem --dados e JSON inválido", async () => {
  const env = novaRaiz();
  const id = await registrar(env);
  falha(await cli(env, ["demanda", "evidencia", id, "foo", "--dados", "x"]), 2, /foo não é evidência da demanda/);
  falha(await cli(env, ["demanda", "evidencia", id, "criterios_aceite"]), 2, /^falta --dados/);
  falha(
    await cli(env, ["demanda", "evidencia", id, "criterios_aceite", "--dados", "-"], "{"),
    1,
    /não é um JSON válido/,
  );
  falha(await cli(env, ["demanda", "ver", "abc"]), 2, /abc não é um I-<n>/);
});

test("CA-12: schema do tipo com as regras de arquivo", async () => {
  const env = novaRaiz(); // sem FABRIQUINHA_ROOT, o CLI abriria o banco de ~/fabriquinha
  const s = jsonSchema(await cli(env, ["demanda", "schema", "custos_realizados"]));
  assert.ok(s.dados.properties.sessoes);
  assert.equal(s.arquivos.max, 0);
  assert.ok(jsonSchema(await cli(env, ["demanda", "schema", "desenho_solucao"])).arquivos.min >= 1);
});

test("CA-13: enviar sem desenho_solucao lista o que falta e não envia", async () => {
  const env = novaRaiz();
  const id = await registrar(env);
  await completar(env, id, "desenho_solucao");
  falha(await cli(env, ["demanda", "enviar", id]), 1, /desenho_solucao.*submeta/);
  assert.equal(json(await cli(env, ["demanda", "ver", id])).enviada, false);
});

test("CA-14 e CA-16: enviar com as três evidências e ver", async () => {
  const env = novaRaiz();
  const id = await registrar(env);
  await completar(env, id);
  const e = json(await cli(env, ["demanda", "enviar", id]));
  assert.equal(e.enviada, true);
  assert.equal(e.fase, "aprovacao_demanda");
  const v = json(await cli({ FABRIQUINHA_ROOT: env.FABRIQUINHA_ROOT }, ["demanda", "ver", id]));
  assert.deepEqual(v.evidencias.map((x: { tipo: string }) => x.tipo).sort(), [
    "criterios_aceite",
    "custos_realizados",
    "desenho_solucao",
  ]);
});

test("CA-15: outra sessão não envia", async () => {
  const env = novaRaiz();
  const id = await registrar(env);
  await completar(env, id);
  falha(await cli(outra(env), ["demanda", "enviar", id]), 1, /só a ferramenta claude da sessão S1 pode enviar/);
  assert.equal(json(await cli(env, ["demanda", "ver", id])).enviada, false);
});

test("CA-17: decidir, cancelar e arquivar não existem", async () => {
  const env = novaRaiz();
  const id = await registrar(env);
  for (const c of ["decidir", "cancelar", "arquivar"]) {
    falha(await cli(env, ["demanda", c, id]), 2, /^comando desconhecido: demanda /);
  }
  assert.equal(json(await cli(env, ["demanda", "ver", id])).fase, "registro");
});

test("com FABRIQUINHA_EXECUCAO a tabela externa não vale", async () => {
  const env = { ...novaRaiz(), FABRIQUINHA_EXECUCAO: "E-1" };
  falha(await cli(env, ["demanda", "ver", "I-1"]), 2, /comando desconhecido/);
});

test("a ajuda lista a seção externa", async () => {
  const { out } = await cli({}, ["demanda", "--help"]);
  assert.match(out, /Ferramenta externa, demandas/);
  assert.match(out, /fabriquinha demanda registrar/);
});

test("CA-19: a skill traz um exemplo de cada comando e cada comando citado existe", () => {
  const skill = readFileSync(join(cwd, "pacote-pi", "skills", "demanda-externa", "SKILL.md"), "utf8");
  const citados = [...skill.matchAll(/^fabriquinha demanda (\S+)/gm)].map((m) => m[1]);
  const existentes = COMANDOS_DEMANDA_EXTERNA.map((c) => c.palavras[1]);
  assert.deepEqual(existentes.sort(), ["editar", "enviar", "evidencia", "registrar", "schema", "ver"]);
  for (const c of citados) assert.ok(existentes.includes(c), c);
  for (const c of existentes) assert.ok(citados.includes(c), c);
  assert.ok(skill.trimEnd().split("\n").length <= 100);
  assert.ok(new ErroDeUso("x") instanceof Error);
});
