// Fotos do CLI externo da demanda, gravadas do código de antes da refatoração da I-282: stdout, stderr e código de
// saída byte a byte para demanda registrar, editar, evidencia, enviar, ver e schema. Nenhum valor esperado muda depois.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { after, mock, test } from "node:test";
import { fabricaDeBancosTemporarios } from "../../../apoio-testes/banco_temporario.ts";
import { executarFabriquinha as principal } from "../../composicao/cli.ts";

const novoBancoTemporario = fabricaDeBancosTemporarios();
const base = mkdtempSync(join(tmpdir(), "fabriquinha-fotos-externo-"));
const pasta = mkdtempSync(join(base, "pasta-"));
const cwd = process.cwd();
process.chdir(pasta); // os anexos vêm da pasta do comando
mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-01-01T00:00:00.000Z") }); // os instantes entram na saída
after(() => {
  mock.timers.reset();
  process.chdir(cwd);
  rmSync(base, { recursive: true, force: true });
});

writeFileSync(join(pasta, "desc.md"), "descrição");
writeFileSync(
  join(pasta, "criterios.json"),
  JSON.stringify({ criterios: [{ id: "CA-1", dado: "d", quando: "q", entao: "e" }] }),
);
writeFileSync(
  join(pasta, "desenho.json"),
  JSON.stringify({ resumo: "r", arquivosPrevistos: [{ caminho: "src/a.ts", acao: "criar", motivo: "m" }] }),
);
writeFileSync(join(pasta, "desenho.html"), "<!doctype html><p>x</p>");
writeFileSync(
  join(pasta, "custos.json"),
  JSON.stringify({
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
  }),
);

interface Saida {
  codigo: number;
  out: string;
  err: string;
}

function novaRaiz(): NodeJS.ProcessEnv {
  const { raiz, banco } = novoBancoTemporario();
  banco.exec(`INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube)
    VALUES ('fabriquinha', '/repo/f', 'main', 'github', 'k')`);
  return { FABRIQUINHA_ROOT: raiz, FABRIQUINHA_FERRAMENTA: "claude", FABRIQUINHA_SESSAO: "S1" };
}

async function cli(env: NodeJS.ProcessEnv, args: string[]): Promise<Saida> {
  let out = "";
  let err = "";
  const codigo = await principal(args, {
    env,
    stdin: Readable.from([""]),
    stdout: { write: (t: string) => (out += t) },
    stderr: { write: (t: string) => (err += t) },
    parada: () => Promise.resolve(),
  });
  return { codigo, out, err };
}

/** A saída é igual à gravada: stdout, stderr e código de saída. */
const foto = (s: Saida, esperado: Saida): void => {
  assert.deepEqual(s, esperado);
};

const REGISTRAR = ["demanda", "registrar", "--projeto", "fabriquinha", "--titulo", "T", "--tipo", "funcionalidade"];
const DADOS_DAS_EVIDENCIAS = [
  ["criterios_aceite", "criterios.json"],
  ["desenho_solucao", "desenho.json", "--arquivo", "desenho.html"],
  ["custos_realizados", "custos.json"],
];

async function registrada(): Promise<NodeJS.ProcessEnv> {
  const env = novaRaiz();
  await cli(env, [...REGISTRAR, "--descricao", "desc.md"]);
  return env;
}

async function comAsTresEvidencias(): Promise<NodeJS.ProcessEnv> {
  const env = await registrada();
  for (const [tipo, dados, ...resto] of DADOS_DAS_EVIDENCIAS) {
    await cli(env, ["demanda", "evidencia", "I-1", String(tipo), "--dados", String(dados), ...resto]);
  }
  return env;
}

test("foto demanda registrar: registra a demanda; sem --titulo é uso inválido; projeto inexistente é recusado", async () => {
  const env = novaRaiz();
  foto(await cli(env, [...REGISTRAR, "--descricao", "desc.md"]), {
    codigo: 0,
    out: '{"id":"I-1","projeto":"fabriquinha","titulo":"T","tipo":"funcionalidade","descricao":"descrição","estado":"entender_e_desenhar","estado_alterado_em":"2026-01-01T00:00:00.000Z","origem_ferramenta":"claude","origem_sessao":"S1","enviada":false,"branch":"fabriquinha/I-1","dependencias":[],"evidencias":[]}\n',
    err: "",
  });
  foto(await cli(env, ["demanda", "registrar", "--projeto", "fabriquinha"]), {
    codigo: 2,
    out: "",
    err: "falta --titulo\n\nUso:\n\nFerramenta externa, demandas (sem FABRIQUINHA_EXECUCAO):\n  fabriquinha demanda registrar --projeto <p> --titulo <t> --tipo <funcionalidade|problema> --descricao <arquivo|-> [--dep I-<m>]... [--ferramenta <f>] [--sessao <s>]\n  fabriquinha demanda editar I-<n> [--titulo <t>] [--tipo <funcionalidade|problema>] [--descricao <arquivo|->] [--ferramenta <f>] [--sessao <s>]\n  fabriquinha demanda evidencia I-<n> <tipo> --dados <arquivo.json|-> [--arquivo <caminho>]... [--ferramenta <f>] [--sessao <s>]\n  fabriquinha demanda enviar I-<n> [--ferramenta <f>] [--sessao <s>]\n  fabriquinha demanda ver I-<n> [--ferramenta <f>] [--sessao <s>]\n  fabriquinha demanda schema <tipo> [--ferramenta <f>] [--sessao <s>]\n\nCom FABRIQUINHA_EXECUCAO, só os comandos do agente; sem ela, só servidor, abrir, demanda e --help.\nIDs aceitam I-12 ou 12; --descricao e --dados leem de um arquivo, ou do stdin com -.\n",
  });
  const projetoInexistente = [...REGISTRAR, "--descricao", "desc.md"];
  projetoInexistente[3] = "nao-existe";
  foto(await cli(env, projetoInexistente), {
    codigo: 1,
    out: "",
    err: "o projeto nao-existe não existe (confira o nome do projeto)\n",
  });
});

test("foto demanda editar: edita pela autora; outra sessão é recusada", async () => {
  const env = await registrada();
  foto(await cli(env, ["demanda", "editar", "I-1", "--titulo", "Novo"]), {
    codigo: 0,
    out: '{"id":"I-1","projeto":"fabriquinha","titulo":"Novo","tipo":"funcionalidade","descricao":"descrição","estado":"entender_e_desenhar","estado_alterado_em":"2026-01-01T00:00:00.000Z","origem_ferramenta":"claude","origem_sessao":"S1","enviada":false,"branch":"fabriquinha/I-1","dependencias":[],"evidencias":[]}\n',
    err: "",
  });
  foto(await cli({ ...env, FABRIQUINHA_SESSAO: "S2" }, ["demanda", "editar", "I-1", "--titulo", "X"]), {
    codigo: 1,
    out: "",
    err: "só a ferramenta claude da sessão S1 pode editar a demanda I-1 (peça a quem registrou a demanda, na mesma sessão)\n",
  });
});

test("foto demanda evidencia: grava a evidência com anexo; tipo inválido é recusado", async () => {
  const env = await registrada();
  foto(await cli(env, ["demanda", "evidencia", "I-1", "criterios_aceite", "--dados", "criterios.json"]), {
    codigo: 0,
    out: '{"id":"I-1","projeto":"fabriquinha","titulo":"T","tipo":"funcionalidade","descricao":"descrição","estado":"entender_e_desenhar","estado_alterado_em":"2026-01-01T00:00:00.000Z","origem_ferramenta":"claude","origem_sessao":"S1","enviada":false,"branch":"fabriquinha/I-1","dependencias":[],"evidencias":[{"tipo":"criterios_aceite","em":"2026-01-01T00:00:00.000Z","arquivos":[]}],"avisos":[]}\n',
    err: "",
  });
  foto(
    await cli(env, [
      "demanda",
      "evidencia",
      "I-1",
      "desenho_solucao",
      "--dados",
      "desenho.json",
      "--arquivo",
      "desenho.html",
    ]),
    {
      codigo: 0,
      out: '{"id":"I-1","projeto":"fabriquinha","titulo":"T","tipo":"funcionalidade","descricao":"descrição","estado":"entender_e_desenhar","estado_alterado_em":"2026-01-01T00:00:00.000Z","origem_ferramenta":"claude","origem_sessao":"S1","enviada":false,"branch":"fabriquinha/I-1","dependencias":[],"evidencias":[{"tipo":"criterios_aceite","em":"2026-01-01T00:00:00.000Z","arquivos":[]},{"tipo":"desenho_solucao","em":"2026-01-01T00:00:00.000Z","arquivos":[{"nome":"desenho.html","sha256":"d61d59af2514cd746526521954a6f462d03f3deaea1e665ca5f8ab9d845da6bc"}]}],"avisos":[]}\n',
      err: "",
    },
  );
  foto(await cli(env, ["demanda", "evidencia", "I-1", "nada", "--dados", "criterios.json"]), {
    codigo: 2,
    out: "",
    err: "nada não é evidência da demanda; os tipos são: criterios_aceite, desenho_solucao, custos_realizados, comportamento, prototipo, relatorio_complexidade, relatorio_impactos_arquitetura\n\nUso:\n\nFerramenta externa, demandas (sem FABRIQUINHA_EXECUCAO):\n  fabriquinha demanda registrar --projeto <p> --titulo <t> --tipo <funcionalidade|problema> --descricao <arquivo|-> [--dep I-<m>]... [--ferramenta <f>] [--sessao <s>]\n  fabriquinha demanda editar I-<n> [--titulo <t>] [--tipo <funcionalidade|problema>] [--descricao <arquivo|->] [--ferramenta <f>] [--sessao <s>]\n  fabriquinha demanda evidencia I-<n> <tipo> --dados <arquivo.json|-> [--arquivo <caminho>]... [--ferramenta <f>] [--sessao <s>]\n  fabriquinha demanda enviar I-<n> [--ferramenta <f>] [--sessao <s>]\n  fabriquinha demanda ver I-<n> [--ferramenta <f>] [--sessao <s>]\n  fabriquinha demanda schema <tipo> [--ferramenta <f>] [--sessao <s>]\n\nCom FABRIQUINHA_EXECUCAO, só os comandos do agente; sem ela, só servidor, abrir, demanda e --help.\nIDs aceitam I-12 ou 12; --descricao e --dados leem de um arquivo, ou do stdin com -.\n",
  });
});

test("foto demanda enviar: sem as evidências é recusado; completa, envia", async () => {
  const env = await registrada();
  foto(await cli(env, ["demanda", "enviar", "I-1"]), {
    codigo: 1,
    out: "",
    err: "a demanda I-1 não pode ser enviada: faltam as evidências criterios_aceite, desenho_solucao, custos_realizados (submeta cada uma e envie de novo)\n",
  });
  for (const [tipo, dados, ...resto] of DADOS_DAS_EVIDENCIAS) {
    await cli(env, ["demanda", "evidencia", "I-1", String(tipo), "--dados", String(dados), ...resto]);
  }
  foto(await cli(env, ["demanda", "enviar", "I-1"]), {
    codigo: 0,
    out: '{"id":"I-1","projeto":"fabriquinha","titulo":"T","tipo":"funcionalidade","descricao":"descrição","estado":"gate_demanda","estado_alterado_em":"2026-01-01T00:00:00.000Z","origem_ferramenta":"claude","origem_sessao":"S1","enviada":true,"branch":"fabriquinha/I-1","dependencias":[],"evidencias":[{"tipo":"criterios_aceite","em":"2026-01-01T00:00:00.000Z","arquivos":[]},{"tipo":"desenho_solucao","em":"2026-01-01T00:00:00.000Z","arquivos":[{"nome":"desenho.html","sha256":"d61d59af2514cd746526521954a6f462d03f3deaea1e665ca5f8ab9d845da6bc"}]},{"tipo":"custos_realizados","em":"2026-01-01T00:00:00.000Z","arquivos":[]}]}\n',
    err: "",
  });
});

test("foto demanda ver: mostra a demanda com as evidências; demanda inexistente é recusada", async () => {
  const env = await comAsTresEvidencias();
  foto(await cli(env, ["demanda", "ver", "I-1"]), {
    codigo: 0,
    out: '{"id":"I-1","projeto":"fabriquinha","titulo":"T","tipo":"funcionalidade","descricao":"descrição","estado":"entender_e_desenhar","estado_alterado_em":"2026-01-01T00:00:00.000Z","origem_ferramenta":"claude","origem_sessao":"S1","enviada":false,"branch":"fabriquinha/I-1","dependencias":[],"evidencias":[{"tipo":"criterios_aceite","em":"2026-01-01T00:00:00.000Z","arquivos":[]},{"tipo":"desenho_solucao","em":"2026-01-01T00:00:00.000Z","arquivos":[{"nome":"desenho.html","sha256":"d61d59af2514cd746526521954a6f462d03f3deaea1e665ca5f8ab9d845da6bc"}]},{"tipo":"custos_realizados","em":"2026-01-01T00:00:00.000Z","arquivos":[]}]}\n',
    err: "",
  });
  foto(await cli(env, ["demanda", "ver", "I-9"]), {
    codigo: 1,
    out: "",
    err: "a demanda I-9 não existe (confira o id da demanda)\n",
  });
});

test("foto demanda schema: schema do tipo; tipo desconhecido é recusado", async () => {
  const env = novaRaiz();
  foto(await cli(env, ["demanda", "schema", "custos_realizados"]), {
    codigo: 0,
    out: '{"dados":{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"sessoes":{"type":"array","items":{"type":"object","properties":{"ferramenta":{"type":"string","minLength":1},"sessao":{"type":"string","minLength":1},"linhas":{"minItems":1,"type":"array","items":{"type":"object","properties":{"provedor":{"type":"string","minLength":1},"modelo":{"type":"string","minLength":1},"tokens_entrada":{"type":"integer","minimum":0,"maximum":9007199254740991},"tokens_saida":{"type":"integer","minimum":0,"maximum":9007199254740991},"tokens_cache_leitura":{"type":"integer","minimum":0,"maximum":9007199254740991},"tokens_cache_escrita":{"type":"integer","minimum":0,"maximum":9007199254740991},"custo":{"description":"custo em dólares; omita se desconhecido (fica null, nunca 0)","anyOf":[{"type":"number","minimum":0},{"type":"null"}]}},"required":["provedor","modelo","tokens_entrada","tokens_saida","tokens_cache_leitura","tokens_cache_escrita"]}}},"required":["ferramenta","sessao","linhas"]}}},"required":["sessoes"]},"arquivos":{"classes":["video","imagem","html","texto"],"min":0,"max":0}}\n',
    err: "",
  });
  foto(await cli(env, ["demanda", "schema", "nada"]), {
    codigo: 2,
    out: "",
    err: "nada não é evidência da demanda; os tipos são: criterios_aceite, desenho_solucao, custos_realizados, comportamento, prototipo, relatorio_complexidade, relatorio_impactos_arquitetura\n\nUso:\n\nFerramenta externa, demandas (sem FABRIQUINHA_EXECUCAO):\n  fabriquinha demanda registrar --projeto <p> --titulo <t> --tipo <funcionalidade|problema> --descricao <arquivo|-> [--dep I-<m>]... [--ferramenta <f>] [--sessao <s>]\n  fabriquinha demanda editar I-<n> [--titulo <t>] [--tipo <funcionalidade|problema>] [--descricao <arquivo|->] [--ferramenta <f>] [--sessao <s>]\n  fabriquinha demanda evidencia I-<n> <tipo> --dados <arquivo.json|-> [--arquivo <caminho>]... [--ferramenta <f>] [--sessao <s>]\n  fabriquinha demanda enviar I-<n> [--ferramenta <f>] [--sessao <s>]\n  fabriquinha demanda ver I-<n> [--ferramenta <f>] [--sessao <s>]\n  fabriquinha demanda schema <tipo> [--ferramenta <f>] [--sessao <s>]\n\nCom FABRIQUINHA_EXECUCAO, só os comandos do agente; sem ela, só servidor, abrir, demanda e --help.\nIDs aceitam I-12 ou 12; --descricao e --dados leem de um arquivo, ou do stdin com -.\n",
  });
});
