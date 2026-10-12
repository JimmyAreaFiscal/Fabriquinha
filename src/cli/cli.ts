// CLI `fabriquinha` (F7 §3): resolve o agente por `FABRIQUINHA_EXECUCAO`, converte a entrada, chama o comando do F1
// (ou a leitura) e traduz o resultado em uma linha de JSON e o erro em uma linha de texto. Nenhuma regra mora aqui.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { text } from "node:stream/consumers";
import { fileURLToPath } from "node:url";
import { parseArgs, type ParseArgsOptionsConfig } from "node:util";
import { z, ZodError } from "zod";
import { type Ator, TipoEvidencia } from "../dominio/agregado.ts";
import { ErroDeEscopo, ErroDeRegra, existe, mensagem } from "../dominio/erros.ts";
import { adicionarDependencia, editarIssue, removerDependencia } from "../dominio/issue.ts";
import { registrarDecisaoRevisao } from "../dominio/gates.ts";
import type { Id } from "../dominio/primitivos.ts";
import { adicionarTicketDesenvolvimento, editarTicket, removerTicket } from "../dominio/tickets.ts";
import { jsonSchemaDe } from "../evidencias/schemas.ts";
import { submeter } from "../evidencias/submissao.ts";
import { iniciarServico, portaDoServico } from "../execucao/servico.ts";
import { caminhoArquivo } from "../persistencia/arquivos.ts";
import { abrir as abrirBanco, raizPadrao } from "../persistencia/banco.ts";
import { execucaoDoAgente } from "../persistencia/execucoes.ts";
import { agregado, agregadoDoTicket, comIssue } from "../persistencia/issues.ts";
import { projeto } from "../persistencia/projetos.ts";

/** O processo visto pelo CLI; o ponto de entrada passa o real, os testes passam o seu. */
export interface Io {
  readonly env: NodeJS.ProcessEnv;
  readonly stdin: NodeJS.ReadableStream;
  readonly stdout: { write(texto: string): unknown };
  readonly stderr: { write(texto: string): unknown };
  /** Resolve quando o `servidor` deve parar (SIGINT ou SIGTERM). */
  parada(): Promise<unknown>;
}

/** A raiz do pacote P1 `pi-fabriquinha`, versionado junto com a Fabriquinha (F4 §6.1). */
const PACOTE = fileURLToPath(new URL("../../pacote-pi", import.meta.url));

/** Comando ou opção desconhecida, argumento faltando ou malformado: código 2 e a ajuda do grupo (F7 §3.3). */
class ErroDeUso extends Error {}

/** O agente da execução e o projeto do próprio ticket, que `projeto ver` mostra. */
interface Agente {
  readonly ator: Ator & { tipo: "agente" };
  readonly projeto: string;
}

interface Chamada {
  /** Os posicionais, já conferidos contra `argumentos`: nenhum comando lê além dos que declara. */
  readonly pos: readonly [string, string];
  readonly op: Readonly<Record<string, string | string[] | undefined>>;
  readonly io: Io;
}

interface ChamadaDoAgente extends Chamada {
  readonly banco: DatabaseSync;
  readonly agente: Agente;
}

type Comando = {
  /** As palavras do comando, ex.: `["issue", "dep", "add"]`; a primeira é o grupo. */
  readonly palavras: readonly string[];
  /** Os argumentos posicionais, na ordem, com o nome que a ajuda mostra. */
  readonly argumentos: readonly string[];
  /** O resto da linha de uso, depois dos argumentos. */
  readonly opcoesDeUso?: string;
  readonly opcoes?: ParseArgsOptionsConfig;
} & (
  | { readonly doAgente: false; rodar(c: Chamada): Promise<unknown> }
  | { readonly doAgente: true; rodar(c: ChamadaDoAgente): unknown }
);

/** `I-12` ou `12` para o tipo de `prefixo`; outro prefixo é uso inválido (F7 §3.3). */
function numero(texto: string, prefixo: "I" | "T"): Id {
  const achado = new RegExp(`^(?:${prefixo}-)?([1-9][0-9]*)$`).exec(texto);
  if (!achado) throw new ErroDeUso(`${texto} não é um ${prefixo}-<n>: use ${prefixo}-<n> ou só o número`);
  return Number(achado[1]);
}

function tipoDeEvidencia(texto: string): TipoEvidencia {
  const tipo = TipoEvidencia.safeParse(texto);
  if (!tipo.success) {
    throw new ErroDeUso(`${texto} não é um tipo de evidência; os tipos são: ${TipoEvidencia.options.join(", ")}`);
  }
  return tipo.data;
}

/** Texto longo de um arquivo, ou do stdin com `-` (F7 §3.3). */
const ler = (arquivo: string, io: Io): Promise<string> =>
  arquivo === "-" ? text(io.stdin) : Promise.resolve(readFileSync(arquivo, "utf8"));

const opcional = (valor: string | string[] | undefined) => valor as string | undefined;

/** A descrição de `--descricao`, ou `undefined` para manter a atual. */
const descricao = async ({ op, io }: Chamada): Promise<string | undefined> => {
  const arquivo = opcional(op.descricao);
  return arquivo === undefined ? undefined : ler(arquivo, io);
};

/** A issue do ticket `id`, para aplicar o comando do F1 ao agregado dela. */
const issueDoTicket = (banco: DatabaseSync, id: Id): Id =>
  existe(agregadoDoTicket(banco, id), `o ticket T-${String(id)} não existe`, "confira o número do ticket").issue.id;

const TITULO_DESCRICAO: ParseArgsOptionsConfig = { titulo: { type: "string" }, descricao: { type: "string" } };

const COMANDOS: readonly Comando[] = [
  {
    palavras: ["servidor"],
    argumentos: [],
    doAgente: false,
    async rodar({ io }) {
      const servico = await iniciarServico(raizPadrao(io.env), PACOTE);
      // A linha sai quando o serviço já atende, e `parada` passa a ouvir os sinais no mesmo tick.
      io.stdout.write(`${JSON.stringify({ porta: portaDoServico() })}\n`);
      await io.parada();
      await servico.parar();
    },
  },
  {
    palavras: ["abrir"],
    argumentos: [],
    doAgente: false,
    async rodar({ io }) {
      const arquivo = join(raizPadrao(io.env), "web.url");
      if (!existsSync(arquivo)) {
        throw new ErroDeRegra(`o serviço não está rodando: falta ${arquivo}`, "suba-o com fabriquinha servidor");
      }
      const url = readFileSync(arquivo, "utf8").trim();
      const navegador = spawn(comandoDoNavegador(process.platform), [url], {
        env: io.env,
        detached: true,
        stdio: "ignore",
      });
      try {
        await once(navegador, "spawn");
      } catch (error_) {
        throw new ErroDeRegra(
          `a Fabriquinha não conseguiu abrir o navegador: ${mensagem(error_)}`,
          `abra ${url} no navegador`,
        );
      }
      navegador.unref();
      return { url };
    },
  },
  {
    palavras: ["projeto", "ver"],
    argumentos: [],
    doAgente: true,
    rodar: ({ banco, agente }) =>
      existe(projeto(banco, agente.projeto), `o projeto ${agente.projeto} não existe`, "confira a execução"),
  },
  {
    palavras: ["issue", "ver"],
    argumentos: ["I-<n>"],
    doAgente: true,
    rodar({ banco, pos }) {
      const id = numero(pos[0], "I");
      const ag = existe(agregado(banco, id), `a issue I-${String(id)} não existe`, "confira o número da issue");
      return { ...ag.issue, tickets: ag.tickets };
    },
  },
  {
    palavras: ["issue", "editar"],
    argumentos: ["I-<n>"],
    opcoesDeUso: "[--titulo <t>] [--tipo <funcionalidade|problema>] [--descricao <arquivo|->]",
    opcoes: { ...TITULO_DESCRICAO, tipo: { type: "string" } },
    doAgente: true,
    async rodar(c) {
      const id = numero(c.pos[0], "I");
      const entrada = { titulo: opcional(c.op.titulo), tipo: opcional(c.op.tipo), descricao: await descricao(c) };
      const { ator } = c.agente;
      return comIssue(c.banco, id, "editarIssue", ator, (ag) => editarIssue(ag, entrada, ator)).issue;
    },
  },
  {
    palavras: ["issue", "dep", "add"],
    argumentos: ["I-<n>", "I-<m>"],
    doAgente: true,
    rodar({ banco, agente: { ator }, pos }) {
      const [id, dep] = pos.map((p) => numero(p, "I")) as [Id, Id];
      return comIssue(banco, id, "adicionarDependencia", ator, (ag, ctx) => adicionarDependencia(ag, dep, ator, ctx))
        .issue;
    },
  },
  {
    palavras: ["issue", "dep", "rm"],
    argumentos: ["I-<n>", "I-<m>"],
    doAgente: true,
    rodar({ banco, agente: { ator }, pos }) {
      const [id, dep] = pos.map((p) => numero(p, "I")) as [Id, Id];
      return comIssue(banco, id, "removerDependencia", ator, (ag) => removerDependencia(ag, dep, ator)).issue;
    },
  },
  {
    palavras: ["ticket", "ver"],
    argumentos: ["T-<n>"],
    doAgente: true,
    rodar({ banco, pos }) {
      const id = numero(pos[0], "T");
      return existe(
        agregadoDoTicket(banco, id),
        `o ticket T-${String(id)} não existe`,
        "confira o número do ticket",
      ).tickets.find((t) => t.id === id);
    },
  },
  {
    palavras: ["ticket", "criar"],
    argumentos: ["I-<n>"],
    opcoesDeUso: "--titulo <t> [--descricao <arquivo|->]",
    opcoes: TITULO_DESCRICAO,
    doAgente: true,
    async rodar(c) {
      const id = numero(c.pos[0], "I");
      const titulo = opcional(c.op.titulo);
      if (titulo === undefined) throw new ErroDeUso("falta --titulo <t>");
      const entrada = { titulo, descricao: await descricao(c) };
      const { ator } = c.agente;
      const depois = comIssue(c.banco, id, "adicionarTicketDesenvolvimento", ator, (ag, ctx) =>
        adicionarTicketDesenvolvimento(ag, entrada, ator, ctx),
      );
      return depois.tickets.at(-1);
    },
  },
  {
    palavras: ["ticket", "editar"],
    argumentos: ["T-<n>"],
    opcoesDeUso: "[--titulo <t>] [--descricao <arquivo|->]",
    opcoes: TITULO_DESCRICAO,
    doAgente: true,
    async rodar(c) {
      const id = numero(c.pos[0], "T");
      const entrada = { ticket: id, titulo: opcional(c.op.titulo), descricao: await descricao(c) };
      const { ator } = c.agente;
      return comIssue(c.banco, issueDoTicket(c.banco, id), "editarTicket", ator, (ag) =>
        editarTicket(ag, entrada, ator),
      ).tickets.find((t) => t.id === id);
    },
  },
  {
    palavras: ["ticket", "remover"],
    argumentos: ["T-<n>"],
    doAgente: true,
    rodar({ banco, agente: { ator }, pos }) {
      const id = numero(pos[0], "T");
      comIssue(banco, issueDoTicket(banco, id), "removerTicket", ator, (ag) => removerTicket(ag, { ticket: id }, ator));
      return { removido: id };
    },
  },
  {
    palavras: ["revisao", "decidir"],
    argumentos: ["T-<n>", "aprovar|reprovar"],
    opcoesDeUso: "[--motivo <texto>]",
    opcoes: { motivo: { type: "string" } },
    doAgente: true,
    rodar({ banco, agente: { ator }, pos, op }) {
      const id = numero(pos[0], "T");
      const veredito = ({ aprovar: true, reprovar: false } as Record<string, boolean | undefined>)[pos[1]];
      if (veredito === undefined) throw new ErroDeUso(`${pos[1]} não é aprovar nem reprovar`);
      const entrada = { ticket: id, aprovado: veredito, motivo: opcional(op.motivo) };
      return comIssue(banco, issueDoTicket(banco, id), "registrarDecisaoRevisao", ator, (ag, ctx) =>
        registrarDecisaoRevisao(ag, entrada, ator, ctx),
      ).decisoes.find((d) => d.gate === "revisao" && d.ticket === id);
    },
  },
  {
    palavras: ["evidencia", "add"],
    argumentos: ["<tipo>"],
    opcoesDeUso: "[--dados <arquivo.json|->] [--arquivo <caminho>]...",
    opcoes: { dados: { type: "string" }, arquivo: { type: "string", multiple: true } },
    doAgente: true,
    async rodar({ banco, agente: { ator }, pos, op, io }) {
      const tipo = tipoDeEvidencia(pos[0]);
      const arquivo = opcional(op.dados);
      let dados: unknown = {};
      if (arquivo !== undefined) {
        try {
          dados = JSON.parse(await ler(arquivo, io));
        } catch (error_) {
          throw new ErroDeRegra(`${arquivo} não é um JSON válido: ${mensagem(error_)}`, "corrija o arquivo de dados");
        }
      }
      return submeter(banco, ator, tipo, dados, (op.arquivo ?? []) as string[]).evidencias.find(
        (e) => e.ticket === ator.ticket && e.tipo === tipo,
      );
    },
  },
  {
    palavras: ["evidencia", "schema"],
    argumentos: ["<tipo>"],
    doAgente: true,
    rodar: ({ pos }) => jsonSchemaDe(tipoDeEvidencia(pos[0])),
  },
  {
    palavras: ["evidencia", "ver"],
    argumentos: ["T-<n>", "<tipo>"],
    doAgente: true,
    rodar({ banco, pos }) {
      const id = numero(pos[0], "T");
      const tipo = tipoDeEvidencia(pos[1]);
      const evidencia = existe(
        agregadoDoTicket(banco, id)?.evidencias.find((e) => e.ticket === id && e.tipo === tipo),
        `T-${String(id)} não tem evidência ${tipo}`,
        "confira o ticket e o tipo",
      );
      return {
        ...evidencia,
        arquivos: evidencia.arquivos.map((a) => ({ ...a, caminho: caminhoArquivo(banco, a.sha256) })),
      };
    },
  },
];

/** O programa que abre uma URL no navegador padrão. */
export const comandoDoNavegador = (plataforma: NodeJS.Platform): string =>
  plataforma === "darwin" ? "open" : "xdg-open";

const uso = (c: Comando): string =>
  ["  fabriquinha", ...c.palavras, ...c.argumentos, ...(c.opcoesDeUso ? [c.opcoesDeUso] : [])].join(" ");

/** A ajuda do grupo (`issue`, `ticket`...), ou a inteira se não há grupo conhecido. */
function ajuda(grupo?: string): string {
  const doGrupo = COMANDOS.filter((c) => c.palavras[0] === grupo);
  const comandos = doGrupo.length > 0 ? doGrupo : COMANDOS;
  return [
    "Uso:",
    ...comandos.map(uso),
    "",
    "Com FABRIQUINHA_EXECUCAO, só os comandos do agente; sem ela, só servidor, abrir e --help.",
    "IDs aceitam I-12 ou 12; --descricao e --dados leem de um arquivo, ou do stdin com -.",
    "",
  ].join("\n");
}

/** O agente de `FABRIQUINHA_EXECUCAO`, com a execução em andamento (F7 §3.1). */
function resolverAgente(banco: DatabaseSync, valor: string): Agente {
  const execucao = execucaoDoAgente(banco, valor);
  if (!execucao) throw new ErroDeEscopo(`a execução ${valor} não existe`, "confira FABRIQUINHA_EXECUCAO");
  const { ticket, projeto: nome } = execucao;
  if (!execucao.emAndamento) {
    throw new ErroDeEscopo(
      `a execução E-${String(execucao.execucao)} já terminou`,
      "peça ao Auditor uma nova execução",
    );
  }
  return { ator: { tipo: "agente", execucao: execucao.execucao, ticket }, projeto: nome };
}

async function rodar(comando: Comando, chamada: Chamada): Promise<unknown> {
  const execucao = chamada.io.env.FABRIQUINHA_EXECUCAO;
  if (!comando.doAgente) {
    if (execucao) {
      throw new ErroDeEscopo(
        `${comando.palavras.join(" ")} não é comando do agente`,
        "o serviço já está rodando; siga com o seu ticket",
      );
    }
    return comando.rodar(chamada);
  }
  if (!execucao) throw new ErroDeEscopo("este comando é do agente", "o Auditor usa o web");
  const banco = abrirBanco(raizPadrao(chamada.io.env));
  try {
    return await comando.rodar({ ...chamada, banco, agente: resolverAgente(banco, execucao) });
  } finally {
    banco.close();
  }
}

/** Os argumentos de `comando` lidos com `parseArgs` estrito (F7 §3.3). */
function argumentosDe(comando: Comando, resto: string[]): Pick<Chamada, "pos" | "op"> {
  let lidos;
  try {
    lidos = parseArgs({ args: resto, options: comando.opcoes ?? {}, strict: true, allowPositionals: true });
  } catch (error_) {
    throw new ErroDeUso(mensagem(error_));
  }
  const { positionals: pos, values: op } = lidos;
  const faltando = comando.argumentos[pos.length];
  if (faltando !== undefined) throw new ErroDeUso(`falta ${faltando}`);
  if (pos.length > comando.argumentos.length) throw new ErroDeUso(`argumento a mais: ${String(pos.at(-1))}`);
  return { pos: pos as unknown as Chamada["pos"], op: op as Chamada["op"] };
}

/** Uma linha só: o `ZodError` vem pelo `z.prettifyError`, com o caminho de cada campo (F3 §5). */
const umaLinha = (erro: unknown): string =>
  (erro instanceof ZodError ? z.prettifyError(erro) : mensagem(erro)).replaceAll(/\s*\n\s*/g, " ");

/** Roda `fabriquinha <args>` e devolve o código de saída: 0 sucesso, 1 erro, 2 uso inválido (F7 §3.3). */
export async function principal(args: readonly string[], io: Io): Promise<number> {
  const grupo = args[0];
  if (args.includes("--help") || args.includes("-h")) {
    io.stdout.write(ajuda(grupo));
    return 0;
  }
  try {
    const comando = COMANDOS.find((c) => c.palavras.every((p, i) => args[i] === p));
    if (!comando)
      throw new ErroDeUso(grupo === undefined ? "falta o comando" : `comando desconhecido: ${args.join(" ")}`);
    const resultado = await rodar(comando, { ...argumentosDe(comando, args.slice(comando.palavras.length)), io });
    if (resultado !== undefined) io.stdout.write(`${JSON.stringify(resultado)}\n`);
    return 0;
  } catch (error_) {
    if (error_ instanceof ErroDeUso) {
      io.stderr.write(`${error_.message}\n\n${ajuda(grupo)}`);
      return 2;
    }
    io.stderr.write(`${umaLinha(error_)}\n`);
    return 1;
  }
}
