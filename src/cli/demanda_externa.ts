// Comandos da ferramenta externa (Claude Code, Codex, pi) sobre a demanda, fora de uma execução de agente
// (comparacao-sdlc-implementacao.md §6 e §9.1): `fabriquinha demanda ...`. Cada comando só converte os argumentos e
// chama `gestao_demandas.ts`; decidir, cancelar e arquivar são do Auditor e não existem aqui.
import { readFileSync, realpathSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { text } from "node:stream/consumers";
import type { ParseArgsOptionsConfig } from "node:util";
import { z } from "zod";
import { ErroDeRegra, mensagem } from "../dominio/erros.ts";
import type { AutorDemanda } from "../dominio/evidencia_demanda.ts";
import { TipoEvidenciaDemanda } from "../dominio/evidencia_demanda.ts";
import { type SchemaEvidencia, schemaDe, schemaDeEtapa } from "../evidencias/schemas.ts";
import { guardarAnexos } from "../evidencias/submissao.ts";
import { editar, enviar, registrar, submeterEvidencia } from "../execucao/gestao_demandas.ts";
import { caminhoArquivo } from "../persistencia/arquivos.ts";
import { carregarDemanda } from "../persistencia/demandas.ts";
import { predecessorasDaDemanda } from "../persistencia/dependencias_demanda.ts";

/** Comando ou opção desconhecida, argumento faltando ou malformado: código 2 e a ajuda do grupo (F7 §3.3). */
export class ErroDeUso extends Error {}

export interface ChamadaExterna {
  readonly banco: DatabaseSync;
  readonly env: NodeJS.ProcessEnv;
  readonly stdin: NodeJS.ReadableStream;
  readonly pos: readonly string[];
  readonly op: Readonly<Record<string, string | string[] | undefined>>;
}

export interface ComandoExterno {
  readonly palavras: readonly string[];
  readonly argumentos: readonly string[];
  readonly opcoesDeUso?: string;
  readonly opcoes?: ParseArgsOptionsConfig;
  rodar(c: ChamadaExterna): unknown;
}

const IDENTIDADE: ParseArgsOptionsConfig = { ferramenta: { type: "string" }, sessao: { type: "string" } };
const USO_IDENTIDADE = "[--ferramenta <f>] [--sessao <s>]";

/** `I-12` ou `12` viram `I-12`. */
function idDe(texto: string): string {
  const achado = /^(?:I-)?([1-9][0-9]*)$/.exec(texto);
  if (!achado) throw new ErroDeUso(`${texto} não é um I-<n>: use I-<n> ou só o número`);
  return `I-${String(achado[1])}`;
}

/** A ferramenta e a sessão de origem: a opção ou, sem ela, `FABRIQUINHA_FERRAMENTA` e `FABRIQUINHA_SESSAO`. */
function autorDe({ op, env }: ChamadaExterna): AutorDemanda {
  const ferramenta = (op.ferramenta as string | undefined) ?? env.FABRIQUINHA_FERRAMENTA;
  const sessao = (op.sessao as string | undefined) ?? env.FABRIQUINHA_SESSAO;
  if (ferramenta && sessao) return { ferramenta, sessao };
  const faltam = [
    ...(ferramenta ? [] : ["a ferramenta de origem (--ferramenta ou FABRIQUINHA_FERRAMENTA)"]),
    ...(sessao ? [] : ["a sessão de origem (--sessao ou FABRIQUINHA_SESSAO)"]),
  ];
  throw new ErroDeUso(`falta ${faltam.join(" e ")}`);
}

const agora = () => ({ agora: new Date().toISOString() });

/** Texto longo de um arquivo, ou do stdin com `-`. */
const ler = (arquivo: string, stdin: NodeJS.ReadableStream): Promise<string> =>
  arquivo === "-" ? text(stdin) : Promise.resolve(readFileSync(arquivo, "utf8"));

/** A demanda com as dependências, as evidências e os anexos (nome e SHA-256) de cada uma. */
function visao(banco: DatabaseSync, id: string) {
  const ag = carregarDemanda(banco, id);
  const anexos = banco.prepare(
    `SELECT a.caminho, a.sha256 FROM arquivo_evidencia a JOIN evidencia_demanda e ON e.id = a.evidencia_id
      WHERE e.demanda_id = ? AND e.tipo = ? ORDER BY a.ordem`,
  );
  return {
    ...ag.demanda,
    dependencias: predecessorasDaDemanda(banco, id).map((p) => p.demanda_id),
    evidencias: ag.evidencias.map((e) => ({
      tipo: e.tipo,
      em: e.em,
      arquivos: anexos.all(id, e.tipo).map((a) => ({ nome: a.caminho, sha256: a.sha256 })),
    })),
  };
}

function tipoDe(texto: string): TipoEvidenciaDemanda {
  const tipo = TipoEvidenciaDemanda.safeParse(texto);
  if (!tipo.success) {
    throw new ErroDeUso(
      `${texto} não é evidência da demanda; os tipos são: ${TipoEvidenciaDemanda.options.join(", ")}`,
    );
  }
  return tipo.data;
}

const schemaDoTipo = (tipo: TipoEvidenciaDemanda): SchemaEvidencia =>
  tipo === "custos_realizados" ? schemaDeEtapa(tipo) : schemaDe(tipo);

export const COMANDOS_DEMANDA_EXTERNA: readonly ComandoExterno[] = [
  {
    palavras: ["demanda", "registrar"],
    argumentos: [],
    opcoesDeUso: `--projeto <p> --titulo <t> --tipo <funcionalidade|problema> --descricao <arquivo|-> [--dep I-<m>]... ${USO_IDENTIDADE}`,
    opcoes: {
      ...IDENTIDADE,
      projeto: { type: "string" },
      titulo: { type: "string" },
      tipo: { type: "string" },
      descricao: { type: "string" },
      dep: { type: "string", multiple: true },
    },
    async rodar(c) {
      const faltando = ["projeto", "titulo", "tipo", "descricao"].find((o) => c.op[o] === undefined);
      if (faltando !== undefined) throw new ErroDeUso(`falta --${faltando}`);
      const autor = autorDe(c);
      const { projeto, titulo, tipo } = c.op;
      const entrada = {
        projeto,
        titulo,
        tipo,
        descricao: await ler(c.op.descricao as string, c.stdin),
        dependencias: ((c.op.dep ?? []) as string[]).map(idDe),
      };
      return visao(c.banco, registrar(c.banco, entrada, autor, agora()).demanda.id);
    },
  },
  {
    palavras: ["demanda", "editar"],
    argumentos: ["I-<n>"],
    opcoesDeUso: `[--titulo <t>] [--tipo <funcionalidade|problema>] [--descricao <arquivo|->] ${USO_IDENTIDADE}`,
    opcoes: { ...IDENTIDADE, titulo: { type: "string" }, tipo: { type: "string" }, descricao: { type: "string" } },
    async rodar(c) {
      const id = idDe(String(c.pos[0]));
      const autor = autorDe(c);
      const arquivo = c.op.descricao as string | undefined;
      const entrada = {
        titulo: c.op.titulo,
        tipo: c.op.tipo,
        descricao: arquivo === undefined ? undefined : await ler(arquivo, c.stdin),
      };
      editar(c.banco, id, entrada, autor);
      return visao(c.banco, id);
    },
  },
  {
    palavras: ["demanda", "evidencia"],
    argumentos: ["I-<n>", "<tipo>"],
    opcoesDeUso: `--dados <arquivo.json|-> [--arquivo <caminho>]... ${USO_IDENTIDADE}`,
    opcoes: { ...IDENTIDADE, dados: { type: "string" }, arquivo: { type: "string", multiple: true } },
    async rodar(c) {
      const id = idDe(String(c.pos[0]));
      const tipo = tipoDe(String(c.pos[1]));
      const autor = autorDe(c);
      const arquivo = c.op.dados as string | undefined;
      if (arquivo === undefined) throw new ErroDeUso("falta --dados");
      let dados: unknown;
      try {
        dados = JSON.parse(await ler(arquivo, c.stdin));
      } catch (error_) {
        throw new ErroDeRegra(`${arquivo} não é um JSON válido: ${mensagem(error_)}`, "corrija o arquivo de dados");
      }
      // A pasta do comando é a única origem dos anexos.
      const pasta = realpathSync(process.cwd());
      const origens = {
        worktree: pasta,
        saida: pasta,
        fora: "da pasta do comando",
        copie: `a pasta do comando (${pasta})`,
      };
      const guardados = guardarAnexos(
        c.banco,
        (c.op.arquivo ?? []) as string[],
        tipo,
        schemaDoTipo(tipo).arquivos,
        origens,
        () => undefined,
      );
      const arquivos = guardados.map((a) => ({
        nome: a.nome,
        mime: a.mime,
        conteudo: readFileSync(caminhoArquivo(c.banco, a.sha256)),
      }));
      const { avisos } = submeterEvidencia(c.banco, id, { tipo, dados, arquivos }, autor, agora());
      return { ...visao(c.banco, id), avisos };
    },
  },
  {
    palavras: ["demanda", "enviar"],
    argumentos: ["I-<n>"],
    opcoesDeUso: USO_IDENTIDADE,
    opcoes: IDENTIDADE,
    rodar(c) {
      const id = idDe(String(c.pos[0]));
      enviar(c.banco, id, autorDe(c), agora());
      return visao(c.banco, id);
    },
  },
  {
    palavras: ["demanda", "ver"],
    argumentos: ["I-<n>"],
    opcoesDeUso: USO_IDENTIDADE,
    opcoes: IDENTIDADE,
    rodar: ({ banco, pos }) => visao(banco, idDe(String(pos[0]))),
  },
  {
    palavras: ["demanda", "schema"],
    argumentos: ["<tipo>"],
    opcoesDeUso: USO_IDENTIDADE,
    opcoes: IDENTIDADE,
    rodar({ pos }) {
      const { dados, arquivos } = schemaDoTipo(tipoDe(String(pos[0])));
      return { dados: z.toJSONSchema(dados, { io: "input" }), arquivos };
    },
  },
];
