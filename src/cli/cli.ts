// CLI `fabriquinha` (F7 §3): resolve o agente por `FABRIQUINHA_EXECUCAO`, converte a entrada, chama o comando do F1
// (ou a leitura) e traduz o resultado em uma linha de JSON e o erro em uma linha de texto. Nenhuma regra mora aqui.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { text } from "node:stream/consumers";
import { parseArgs, type ParseArgsOptionsConfig } from "node:util";
import { z, ZodError } from "zod";
import { type Ator, EXTERNO, exigirRegistroExterno, TipoEvidencia } from "../dominio/agregado.ts";
import { ErroDeEscopo, ErroDeRegra, encontrado, mensagem } from "../dominio/erros.ts";
import { adicionarDependencia, cancelarIssue, editarIssue, removerDependencia } from "../dominio/issue.ts";
import { enviarParaAprovacao, registrarDecisaoRevisao } from "../dominio/gates.ts";
import type { Id } from "../dominio/primitivos.ts";
import { adicionarTicketDesenvolvimento, editarTicket, removerTicket } from "../dominio/tickets.ts";
import { jsonSchemaDe } from "../evidencias/schemas.ts";
import { submeter, submeterExterno } from "../evidencias/submissao.ts";
import { iniciarServico } from "../execucao/servico.ts";
import { caminhoArquivo } from "../persistencia/arquivos.ts";
import { abrir as abrirBanco, raizPadrao } from "../persistencia/banco.ts";
import { execucaoDoAgente } from "../persistencia/execucoes.ts";
import {
  agregadoDoTicket,
  agregadoExistente,
  comIssue,
  dependentes,
  issueDoTicket,
  proporIssue,
  registrarIssue,
} from "../persistencia/issues.ts";
import { projeto } from "../persistencia/projetos.ts";
import { COMANDOS_DEMANDA as LEITURAS_DEMANDA, type ComandoDemanda, resolverAgenteDemanda } from "./agente_demanda.ts";
import { COMANDOS_DEMANDA_EXTERNA, type ComandoExterno, ErroDeUso } from "./demanda_externa.ts";
import { COMANDOS_EVIDENCIA_DEMANDA } from "./evidencia_agente_demanda.ts";

const COMANDOS_DEMANDA: readonly ComandoDemanda[] = [...LEITURAS_DEMANDA, ...COMANDOS_EVIDENCIA_DEMANDA];

/** O processo visto pelo CLI; o ponto de entrada passa o real, os testes passam o seu. */
export interface Io {
  readonly env: NodeJS.ProcessEnv;
  readonly stdin: NodeJS.ReadableStream;
  readonly stdout: { write(texto: string): unknown };
  readonly stderr: { write(texto: string): unknown };
  /** Resolve quando o `servidor` deve parar (SIGINT ou SIGTERM). */
  parada(): Promise<unknown>;
}

/** O agente da execução, a issue do próprio ticket e o projeto dela, que `projeto ver` mostra. */
interface Agente {
  readonly ator: Ator & { tipo: "agente" };
  readonly issue: Id;
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

/** O JSON de `--dados`, ou `{}` sem a opção. */
async function dadosDe({ op, io }: Chamada): Promise<unknown> {
  const arquivo = opcional(op.dados);
  if (arquivo === undefined) return {};
  try {
    return JSON.parse(await ler(arquivo, io));
  } catch (error_) {
    throw new ErroDeRegra(`${arquivo} não é um JSON válido: ${mensagem(error_)}`, "corrija o arquivo de dados");
  }
}

const OPCOES_EVIDENCIA: ParseArgsOptionsConfig = {
  dados: { type: "string" },
  arquivo: { type: "string", multiple: true },
};

/** O banco da raiz para um comando da IA externa, fechado no fim. */
async function comBanco<T>(io: Io, rodar: (banco: DatabaseSync) => T | Promise<T>): Promise<T> {
  const banco = abrirBanco(raizPadrao(io.env));
  try {
    return await rodar(banco);
  } finally {
    banco.close();
  }
}

/** A descrição de `--descricao`, ou `undefined` para manter a atual. */
const descricao = async ({ op, io }: Chamada): Promise<string | undefined> => {
  const arquivo = opcional(op.descricao);
  return arquivo === undefined ? undefined : ler(arquivo, io);
};

/**
 * As leituras do agente (F7 §3.1): a issue da própria execução, com os tickets e as evidências dela, e as issues de
 * que ela depende ou que dependem dela (o desenho refeito lê a issue nova). Fora disso, ErroDeEscopo, que diz o que ele
 * pode ler.
 */
function exigirAlcance(banco: DatabaseSync, agente: Agente, issue: Id, oQue: string): void {
  const { deps } = agregadoExistente(banco, agente.issue).issue;
  if (issue === agente.issue || deps.includes(issue) || dependentes(banco, agente.issue).some((d) => d.id === issue)) {
    return;
  }
  const sua = `leia a I-${String(agente.issue)}, a do seu ticket`;
  const dependencias = deps.map((d) => `I-${String(d)}`).join(", ");
  throw new ErroDeEscopo(
    `o agente de T-${String(agente.ator.ticket)} não pode ler ${oQue}`,
    deps.length > 0 ? `${sua}, ou as de que ela depende: ${dependencias}` : sua,
  );
}

const TITULO_DESCRICAO: ParseArgsOptionsConfig = { titulo: { type: "string" }, descricao: { type: "string" } };

const COMANDOS: readonly Comando[] = [
  {
    palavras: ["servidor"],
    argumentos: [],
    doAgente: false,
    async rodar({ io }) {
      const servico = await iniciarServico(raizPadrao(io.env));
      // Os sinais passam a ser ouvidos antes da linha, que sai quando o serviço já atende: quem a lê pode mandar o
      // SIGTERM na hora, e sem ouvinte o sinal mataria o processo sem parar o serviço.
      const parou = io.parada();
      io.stdout.write(`${JSON.stringify({ porta: servico.porta })}\n`);
      await parou;
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
      encontrado(projeto(banco, agente.projeto), `o projeto ${agente.projeto} não existe`, "confira a execução"),
  },
  {
    palavras: ["issue", "ver"],
    argumentos: ["I-<n>"],
    doAgente: true,
    rodar({ banco, agente, pos }) {
      const id = numero(pos[0], "I");
      exigirAlcance(banco, agente, id, `a I-${String(id)}`);
      const ag = agregadoExistente(banco, id);
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
    palavras: ["issue", "propor"],
    argumentos: ["I-<n>"],
    opcoesDeUso: "--titulo <t> --arquivos <n> --descricao <arquivo|->",
    opcoes: { ...TITULO_DESCRICAO, arquivos: { type: "string" } },
    doAgente: true,
    async rodar(c) {
      const id = numero(c.pos[0], "I");
      const titulo = opcional(c.op.titulo);
      if (titulo === undefined) throw new ErroDeUso("falta --titulo <t>");
      const arquivos = opcional(c.op.arquivos);
      if (arquivos === undefined) throw new ErroDeUso("falta --arquivos <n>");
      if (!/^\d+$/.test(arquivos)) throw new ErroDeUso(`${arquivos} não é um inteiro maior ou igual a 0`);
      const mensagem = await descricao(c);
      if (mensagem === undefined) throw new ErroDeUso("falta --descricao <arquivo|->");
      return proporIssue(c.banco, id, { titulo, mensagem, arquivos: Number(arquivos) }, c.agente.ator);
    },
  },
  {
    palavras: ["issue", "cancelar"],
    argumentos: ["I-<n>"],
    doAgente: true,
    rodar({ banco, agente: { ator }, pos }) {
      return comIssue(banco, numero(pos[0], "I"), "cancelarIssue", ator, (ag, ctx) => cancelarIssue(ag, ator, ctx))
        .issue;
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
    rodar({ banco, agente, pos }) {
      const id = numero(pos[0], "T");
      const ag = encontrado(
        agregadoDoTicket(banco, id),
        `o ticket T-${String(id)} não existe`,
        "confira o número do ticket",
      );
      exigirAlcance(banco, agente, ag.issue.id, `T-${String(id)}, da I-${String(ag.issue.id)}`);
      return ag.tickets.find((t) => t.id === id);
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
    palavras: ["ticket", "enviar"],
    argumentos: ["T-<n>"],
    doAgente: true,
    rodar({ banco, agente: { ator }, pos }) {
      const id = numero(pos[0], "T");
      return comIssue(banco, issueDoTicket(banco, id), "enviarParaAprovacao", ator, (ag, ctx) =>
        enviarParaAprovacao(ag, { ticket: id }, ator, ctx),
      ).tickets.find((t) => t.id === id);
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
    opcoes: OPCOES_EVIDENCIA,
    doAgente: true,
    async rodar(c) {
      const {
        banco,
        agente: { ator },
        pos,
        op,
      } = c;
      const tipo = tipoDeEvidencia(pos[0]);
      return (await submeter(banco, ator, tipo, await dadosDe(c), (op.arquivo ?? []) as string[])).evidencias.find(
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
    rodar({ banco, agente, pos }) {
      const id = numero(pos[0], "T");
      const tipo = tipoDeEvidencia(pos[1]);
      const ag = agregadoDoTicket(banco, id);
      if (ag) exigirAlcance(banco, agente, ag.issue.id, `T-${String(id)}, da I-${String(ag.issue.id)}`);
      const evidencia = encontrado(
        ag?.evidencias.find((e) => e.ticket === id && e.tipo === tipo),
        `T-${String(id)} não tem evidência ${tipo}`,
        "confira o ticket e o tipo",
      );
      return {
        ...evidencia,
        arquivos: evidencia.arquivos.map((a) => ({ ...a, caminho: caminhoArquivo(banco, a.sha256) })),
      };
    },
  },
  {
    palavras: ["necessidade", "registrar"],
    argumentos: [],
    opcoesDeUso: "--projeto <p> --titulo <t> --tipo <funcionalidade|problema> --descricao <arquivo|-> [--dep I-<m>]...",
    opcoes: {
      ...TITULO_DESCRICAO,
      projeto: { type: "string" },
      tipo: { type: "string" },
      dep: { type: "string", multiple: true },
    },
    doAgente: false,
    async rodar(c) {
      const faltando = ["projeto", "titulo", "tipo", "descricao"].find((o) => c.op[o] === undefined);
      if (faltando !== undefined) throw new ErroDeUso(`falta --${faltando}`);
      const entrada = {
        projeto: c.op.projeto,
        titulo: c.op.titulo,
        tipo: c.op.tipo,
        descricao: await descricao(c),
        deps: ((c.op.dep ?? []) as string[]).map((d) => numero(d, "I")),
      };
      const ag = await comBanco(c.io, (banco) => registrarIssue(banco, entrada, EXTERNO));
      return { ...ag.issue, tickets: ag.tickets };
    },
  },
  {
    palavras: ["necessidade", "editar"],
    argumentos: ["I-<n>"],
    opcoesDeUso: "[--titulo <t>] [--tipo <funcionalidade|problema>] [--descricao <arquivo|->]",
    opcoes: { ...TITULO_DESCRICAO, tipo: { type: "string" } },
    doAgente: false,
    async rodar(c) {
      const id = numero(c.pos[0], "I");
      const entrada = { titulo: opcional(c.op.titulo), tipo: opcional(c.op.tipo), descricao: await descricao(c) };
      return comBanco(
        c.io,
        (banco) => comIssue(banco, id, "editarIssue", EXTERNO, (ag) => editarIssue(ag, entrada, EXTERNO)).issue,
      );
    },
  },
  {
    palavras: ["necessidade", "evidencia"],
    argumentos: ["I-<n>", "<tipo>"],
    opcoesDeUso: "[--dados <arquivo.json|->] [--arquivo <caminho>]...",
    opcoes: OPCOES_EVIDENCIA,
    doAgente: false,
    async rodar(c) {
      const id = numero(c.pos[0], "I");
      const tipo = tipoDeEvidencia(c.pos[1]);
      const dados = await dadosDe(c);
      const arquivos = (c.op.arquivo ?? []) as string[];
      const ag = await comBanco(c.io, (banco) => submeterExterno(banco, id, process.cwd(), tipo, dados, arquivos));
      return ag.evidencias.find(
        (e) => e.tipo === tipo && ag.tickets.some((t) => t.id === e.ticket && t.etapa === "registro"),
      );
    },
  },
  {
    palavras: ["necessidade", "schema"],
    argumentos: ["<tipo>"],
    doAgente: false,
    rodar: ({ pos }) => Promise.resolve(jsonSchemaDe(tipoDeEvidencia(pos[0]))),
  },
  {
    palavras: ["necessidade", "enviar"],
    argumentos: ["I-<n>"],
    doAgente: false,
    rodar({ pos, io }) {
      const id = numero(pos[0], "I");
      return comBanco(io, (banco) => {
        const ag = comIssue(banco, id, "enviarParaAprovacao", EXTERNO, (a, ctx) => {
          const ticket = exigirRegistroExterno(a, `enviar a I-${String(id)} à aprovação`).id;
          return enviarParaAprovacao(a, { ticket }, EXTERNO, ctx);
        });
        return ag.tickets.find((t) => t.etapa === "registro" && t.enviadoEm !== undefined);
      });
    },
  },
  {
    palavras: ["necessidade", "ver"],
    argumentos: ["I-<n>"],
    doAgente: false,
    rodar({ pos, io }) {
      const id = numero(pos[0], "I");
      return comBanco(io, (banco) => {
        const ag = agregadoExistente(banco, id);
        if (!ag.tickets.some((t) => t.etapa === "registro" && t.origem === "externo")) {
          throw new ErroDeEscopo(
            `a IA externa não pode ler a I-${String(id)}`,
            "ela lê só as issues que registrou com fabriquinha necessidade registrar",
          );
        }
        return { ...ag.issue, tickets: ag.tickets, decisoes: ag.decisoes };
      });
    },
  },
];

/** O programa que abre uma URL no navegador padrão. */
export const comandoDoNavegador = (plataforma: NodeJS.Platform): string =>
  plataforma === "darwin" ? "open" : "xdg-open";

/** O que `uso`, `ajuda` e `argumentosDe` leem de um comando, do agente legado ou da demanda. */
type Forma = Pick<ComandoDemanda | ComandoExterno, "palavras" | "argumentos" | "opcoesDeUso" | "opcoes">;

const uso = (c: Forma): string =>
  ["  fabriquinha", ...c.palavras, ...c.argumentos, ...(c.opcoesDeUso ? [c.opcoesDeUso] : [])].join(" ");

/** A ajuda do grupo (`issue`, `ticket`...), ou a inteira se não há grupo conhecido. */
function ajuda(grupo?: string): string {
  const doGrupo = (cs: readonly Forma[]) => cs.filter((c) => c.palavras[0] === grupo);
  const conhecido =
    doGrupo(COMANDOS).length + doGrupo(COMANDOS_DEMANDA).length + doGrupo(COMANDOS_DEMANDA_EXTERNA).length > 0;
  const escolher = <T extends Forma>(cs: readonly T[]) => (conhecido ? doGrupo(cs) : cs);
  const daDemanda = escolher(COMANDOS_DEMANDA);
  const externos = escolher(COMANDOS_DEMANDA_EXTERNA);
  return [
    "Uso:",
    ...escolher(COMANDOS).map(uso),
    ...(daDemanda.length > 0
      ? ["", "Agente de uma execução da demanda (tickets e rodadas pelo endereço, como I-206.T3 e I-206.R2):"]
      : []),
    ...daDemanda.map(uso),
    ...(externos.length > 0 ? ["", "Ferramenta externa, demandas (sem FABRIQUINHA_EXECUCAO):"] : []),
    ...externos.map(uso),
    "",
    "Com FABRIQUINHA_EXECUCAO, só os comandos do agente; sem ela, só servidor, abrir, necessidade, demanda e --help.",
    "IDs aceitam I-12 ou 12; --descricao e --dados leem de um arquivo, ou do stdin com -.",
    "",
  ].join("\n");
}

/** O agente de `FABRIQUINHA_EXECUCAO`, com a execução em andamento (F7 §3.1). */
function resolverAgente(banco: DatabaseSync, valor: string): Agente {
  const execucao = execucaoDoAgente(banco, valor);
  if (!execucao) throw new ErroDeEscopo(`a execução ${valor} não existe`, "confira FABRIQUINHA_EXECUCAO");
  const { ticket, issue, projeto: nome } = execucao;
  if (!execucao.emAndamento) {
    throw new ErroDeEscopo(
      `a execução E-${String(execucao.execucao)} já terminou`,
      "peça ao Auditor uma nova execução",
    );
  }
  return { ator: { tipo: "agente", execucao: execucao.execucao, ticket }, issue, projeto: nome };
}

/** O comando do agente da demanda: o banco e o agente resolvidos de `execucao`, que o `principal` já viu ser da demanda. */
async function rodarDaDemanda(comando: ComandoDemanda, resto: string[], io: Io, execucao: string): Promise<unknown> {
  const chamada = argumentosDe(comando, resto);
  return comBanco(io, (banco) =>
    comando.rodar({
      ...chamada,
      stdin: io.stdin,
      banco,
      agente: encontrado(
        resolverAgenteDemanda(banco, execucao),
        `a execução ${execucao} não existe`,
        "confira FABRIQUINHA_EXECUCAO",
      ),
    }),
  );
}

/** O comando da ferramenta externa: banco, ambiente e stdin do processo. */
async function rodarExterno(comando: ComandoExterno, resto: string[], io: Io): Promise<unknown> {
  const chamada = argumentosDe(comando, resto);
  return comBanco(io, (banco) => comando.rodar({ ...chamada, banco, env: io.env, stdin: io.stdin }));
}

/** O ator decide antes dos argumentos (F7 §3.1): o comando de outro ator é ErroDeEscopo, com ou sem argumento certo. */
async function rodar(comando: Comando, resto: string[], io: Io): Promise<unknown> {
  const execucao = io.env.FABRIQUINHA_EXECUCAO;
  if (!comando.doAgente) {
    if (execucao) {
      throw new ErroDeEscopo(
        `${comando.palavras.join(" ")} não é comando do agente`,
        comando.palavras[0] === "necessidade"
          ? "é da IA de fora da Fabriquinha; siga com o seu ticket"
          : "o serviço já está rodando; siga com o seu ticket",
      );
    }
    return comando.rodar({ ...argumentosDe(comando, resto), io });
  }
  if (!execucao) throw new ErroDeEscopo("este comando é do agente", "o Auditor usa o web");
  const chamada = { ...argumentosDe(comando, resto), io };
  const banco = abrirBanco(raizPadrao(io.env));
  try {
    return await comando.rodar({ ...chamada, banco, agente: resolverAgente(banco, execucao) });
  } finally {
    banco.close();
  }
}

/** Os argumentos de `comando` lidos com `parseArgs` estrito (F7 §3.3). */
function argumentosDe(comando: Forma, resto: string[]): Pick<Chamada, "pos" | "op"> {
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
  (erro instanceof ZodError ? z.prettifyError(erro) : mensagem(erro))
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" ");

/** Roda `fabriquinha <args>` e devolve o código de saída: 0 sucesso, 1 erro, 2 uso inválido (F7 §3.3). */
export async function principal(args: readonly string[], io: Io): Promise<number> {
  const grupo = args[0];
  if (args.includes("--help") || args.includes("-h")) {
    io.stdout.write(ajuda(grupo));
    return 0;
  }
  try {
    // A execução da demanda (execucao_sessao) tem a sua tabela de comandos; qualquer outra segue a legada.
    const execucao = io.env.FABRIQUINHA_EXECUCAO;
    const daDemanda =
      execucao && (await comBanco(io, (banco) => resolverAgenteDemanda(banco, execucao) !== undefined))
        ? execucao
        : undefined;
    const achar = <T extends Forma>(tabela: readonly T[]) =>
      tabela.find((c) => c.palavras.every((p, i) => args[i] === p));
    const externo = execucao ? undefined : achar(COMANDOS_DEMANDA_EXTERNA);
    const comando = externo ?? (daDemanda === undefined ? achar(COMANDOS) : achar(COMANDOS_DEMANDA));
    if (!comando)
      throw new ErroDeUso(grupo === undefined ? "falta o comando" : `comando desconhecido: ${args.join(" ")}`);
    const resto = args.slice(comando.palavras.length);
    const resultado = externo
      ? await rodarExterno(externo, resto, io)
      : daDemanda === undefined
        ? await rodar(comando as Comando, resto, io)
        : await rodarDaDemanda(comando as ComandoDemanda, resto, io, daDemanda);
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
