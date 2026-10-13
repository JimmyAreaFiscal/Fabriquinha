// Auditoria do Histórico: o histórico das sessões terminadas de um mês, de todos os projetos, em arquivos para o agente
// ler (índice, uma conversa por sessão e os números de custo e de qualidade que a Fabriquinha já mede), e o pi só de
// leitura que os lê e conversa com o Auditor numa sessão fora do agregado (sem issue, ticket nem execução).
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { ErroDeInexistente, ErroDeRegra, ErroExterno, existe } from "../dominio/erros.ts";
import { intervalo, mesPorExtenso, metricasPorMes } from "../metricas/periodo.ts";
import { type MetricasIssue, metricasDaIssue } from "../metricas/issue.ts";
import { raizDo } from "../persistencia/banco.ts";
import { anotar, arquivoDaSessao, noLog } from "../persistencia/execucoes.ts";
import { sinalNoGrupo } from "../processo.ts";
import { abortar, assinar as assinarSessao, avisar, mandar, rodarPi, situacao } from "./gerente.ts";
import {
  exportarHistorico,
  type Mensagem,
  nomeDoHistorico,
  noHistorico,
  type SessaoDoHistorico,
  texto,
} from "./historico.ts";
import { ambienteDaAuditoria, argumentosDaAuditoria, type EventoPi } from "./pi.ts";
import { type InfoSessao, lerConversa, sessoes } from "./sessoes.ts";

/** As sessões terminadas cujo `desde` cai no mês `AAAA-MM`, de todos os projetos, da mais antiga para a mais recente. */
export async function sessoesDoMes(banco: DatabaseSync, mes: string): Promise<SessaoDoHistorico[]> {
  const { inicio, fim } = intervalo(mes);
  const lista = await sessoes(banco, { escopo: "historico" });
  return noHistorico(
    banco,
    lista.filter((s: InfoSessao) => s.desde >= inicio && s.desde < fim),
  );
}

const cel = (t: string | number): string =>
  String(t)
    .replaceAll("|", String.raw`\|`)
    .replaceAll("\n", " ");
const linha = (...celulas: (string | number)[]): string => `| ${celulas.map(cel).join(" | ")} |`;
const tabela = (cabecalho: string[], linhas: (string | number)[][]): string =>
  [linha(...cabecalho), linha(...cabecalho.map(() => "---")), ...linhas.map((l) => linha(...l))].join("\n");
const usd = (custo: number): string => `US$ ${custo.toFixed(2)}`;
const segundos = (ms: number): string => `${String(Math.round(ms / 1000))} s`;
const soma = (itens: number[]): number => itens.reduce((n, i) => n + i, 0);

/** Os números de qualidade da issue (D3): totais da issue, não cortados pelo mês. */
function qualidadeDaIssue(m: MetricasIssue): number[] {
  const correcoes = (c: MetricasIssue["correcoesRegistro"]) => c.devolucoes + c.ajustesAuditor;
  return [
    soma(m.retrabalho.map((r) => r.linhasAlteradasDepois)),
    soma(m.retrabalho.map((r) => r.linhasAlteradasPorHumanos)),
    correcoes(m.correcoesRegistro),
    correcoes(m.correcoesDesenho),
    m.exigenciasRevisao,
    m.bugsEmArquivosRevisados,
  ];
}

/**
 * Grava em `dir` o que o agente da auditoria lê: `auditoria.json`, `sessoes/<nomeDoHistorico>` de cada sessão de
 * `lista` e o `indice.md` com as sessões, os custos do mês e a qualidade por issue.
 */
export function prepararAuditoria(banco: DatabaseSync, dir: string, mes: string, lista: SessaoDoHistorico[]): void {
  const projetos: Record<string, number> = {};
  for (const s of lista) projetos[s.projeto] = (projetos[s.projeto] ?? 0) + 1;
  mkdirSync(join(dir, "sessoes"), { recursive: true });
  writeFileSync(join(dir, "auditoria.json"), JSON.stringify({ mes, sessoes: lista.length, projetos }, null, 2) + "\n");
  for (const s of lista) writeFileSync(join(dir, "sessoes", nomeDoHistorico(s)), exportarHistorico(banco, s.sessao));

  const { inicio, fim } = intervalo(mes);
  const custos = existe(metricasPorMes(banco, { de: mes, ate: mes })[0], `sem métricas de ${mes}`, "confira o mês");
  const issues = [...new Set(lista.map((s) => s.issue))].toSorted((a, b) => a - b);
  const qualidade = issues.map((i) => ({ i, n: qualidadeDaIssue(metricasDaIssue(banco, i)) }));
  const total = [0, 1, 2, 3, 4, 5].map((c) => soma(qualidade.map(({ n }) => Number(n[c]))));
  const indice = [
    `# Auditoria de ${mesPorExtenso(mes)}`,
    "",
    `- Intervalo: de ${inicio} (inclusive) a ${fim} (exclusive)`,
    `- Sessões: ${String(lista.length)}`,
    `- Projetos: ${Object.entries(projetos)
      .map(([p, n]) => `${p} (${String(n)})`)
      .join(", ")}`,
    "",
    "## Sessões",
    "",
    tabela(
      ["Terminada", "Projeto", "Issue", "Título", "Ticket", "Etapa", "Modo", "Resultado", "Custo", "Arquivo"],
      lista.map((s) => [
        s.desde,
        s.projeto,
        `I-${String(s.issue)}`,
        s.titulo ?? "(sem título)",
        `T-${String(s.ticket)}`,
        s.etapa,
        s.modo,
        s.resultado,
        usd(s.custo),
        `sessoes/${nomeDoHistorico(s)}`,
      ]),
    ),
    "",
    "## Custos do mês",
    "",
    `Total: ${usd(custos.consumo.custo)} em ${String(custos.consumo.chamadas)} chamadas.`,
    "",
    tabela(
      ["Modelo", "Chamadas", "Custo"],
      custos.modelos.map((m) => [`${m.provedor}/${m.modelo}`, m.chamadas, usd(m.custo)]),
    ),
    "",
    tabela(
      ["Etapa", "Execuções", "Falhas", "Reprovações", "Duração", "Custo"],
      custos.etapas.map((e) => [e.etapa, e.execucoes, e.falhas, e.reprovacoes, segundos(e.duracaoMs), usd(e.custo)]),
    ),
    "",
    "## Qualidade",
    "",
    "Totais de cada issue com sessão no mês (não cortados pela data). Correções do Auditor = devoluções + ajustes.",
    "",
    tabela(
      [
        "Issue",
        "Linhas alteradas depois",
        "Linhas alteradas por humanos",
        "Correções do registro",
        "Correções do desenho",
        "Exigências da revisão",
        "Bugs em arquivos revisados",
      ],
      [...qualidade.map(({ i, n }) => [`I-${String(i)}`, ...n]), ["Total", ...total]],
    ),
    "",
  ].join("\n");
  writeFileSync(join(dir, "indice.md"), indice);
}

export interface OpcoesDaAuditoria {
  /** Minutos sem mensagem até o pi parar (F4 §3, §6.6); a próxima mensagem o retoma na mesma sessão. */
  ociosidadeMin: number;
}

export type EstadoDaAuditoria = "rodando" | "conversa";

/** O agente da auditoria vivo ou subindo/parando por sessão: no máximo um pi por sessão. */
const tarefas = new Map<string, Promise<string | undefined>>();

const dirDaAuditoria = (raiz: string, sessao: string): string => join(raiz, "auditorias", sessao);

/** A pasta da auditoria `sessao`; recusa a que não existe. */
function pastaExistente(raiz: string, sessao: string): string {
  const dir = dirDaAuditoria(raiz, sessao);
  if (!existsSync(join(dir, "auditoria.json"))) {
    throw new ErroDeInexistente(`a auditoria ${sessao} não existe`, "confira o endereço da auditoria");
  }
  return dir;
}

/** O `indice.md` da auditoria `sessao`. */
export const indiceDaAuditoria = (banco: DatabaseSync, sessao: string): string =>
  readFileSync(join(pastaExistente(raizDo(banco), sessao), "indice.md"), "utf8");

/** O agente trabalha (ou o pi sobe ou para); parado, espera a próxima pergunta do Auditor. */
export const estadoDaAuditoria = (sessao: string): EstadoDaAuditoria =>
  (situacao(sessao)?.ocupado ?? tarefas.has(sessao)) ? "rodando" : "conversa";

/** `prompt.md`: o mês e os caminhos antes do texto fixo da auditoria. */
function promptDaAuditoria(dir: string, mes: string): string {
  const fixo = readFileSync(new URL("auditoria.md", import.meta.url), "utf8");
  return [
    `# Auditoria de ${mesPorExtenso(mes)} (${mes})`,
    "",
    `Pasta da auditoria, o seu diretório de trabalho: ${dir}`,
    `- Índice: ${join(dir, "indice.md")}`,
    `- Sessões: ${join(dir, "sessoes")}/`,
    "",
    fixo,
  ].join("\n");
}

/**
 * Lança o pi da auditoria na pasta dela, em modo consulta (ociosidade), com `prompt` como mensagem. Resolve com o
 * motivo da falha, ou `undefined`, quando o pi para. O pgid fica em `<pasta>/pgid` enquanto o pi vive, para o
 * reinício do serviço matá-lo (`recuperarAuditorias`).
 */
function subir(raiz: string, sessao: string, prompt: string, ociosidadeMin: number): Promise<string | undefined> {
  const dir = dirDaAuditoria(raiz, sessao);
  const log = join(dir, "log");
  const pgid = join(dir, "pgid");
  const args = argumentosDaAuditoria(raiz, sessao);
  anotar(log, `pi ${args.join(" ")}`);
  const tarefa = rodarPi({
    execucao: { id: sessao, sessaoPi: sessao, modo: "consulta" },
    args,
    cwd: dir,
    env: ambienteDaAuditoria(raiz, dir),
    log,
    prompt,
    limiteMin: ociosidadeMin,
    aoLancar: (grupo) => {
      writeFileSync(pgid, String(grupo));
    },
  })
    .then((falha) => {
      rmSync(pgid, { force: true });
      anotar(log, falha === undefined ? "o pi da auditoria parou" : `o pi da auditoria parou com falha: ${falha}`);
      return falha;
    })
    .finally(() => {
      tarefas.delete(sessao);
      avisar(sessao, log);
    });
  tarefas.set(sessao, tarefa);
  tarefa.catch(noLog);
  return tarefa;
}

/**
 * Prepara a pasta `<raiz>/auditorias/<sessão>/` com o histórico do mês `lista` e sobe o pi com o `prompt.md`; resolve
 * com a sessão no primeiro `agent_start`. Se o pi termina antes (CA-10) ou a preparação falha, não sobra pasta nem
 * JSONL da sessão, e o erro vai ao Auditor.
 */
export async function iniciarAuditoria(
  banco: DatabaseSync,
  mes: string,
  lista: SessaoDoHistorico[],
  { ociosidadeMin }: OpcoesDaAuditoria,
): Promise<string> {
  const raiz = raizDo(banco);
  const sessao = randomUUID();
  const dir = dirDaAuditoria(raiz, sessao);
  mkdirSync(join(dir, "vazio"), { recursive: true });
  try {
    prepararAuditoria(banco, dir, mes, lista);
    const prompt = promptDaAuditoria(dir, mes);
    writeFileSync(join(dir, "prompt.md"), prompt);
    const comeco = Promise.withResolvers<true>();
    const desassinar = assinarSessao(sessao, (evento) => {
      if (evento.type === "agent_start") comeco.resolve(true);
    });
    const resultado = await Promise.race([comeco.promise, subir(raiz, sessao, prompt, ociosidadeMin)]).finally(
      desassinar,
    );
    // ponytail: sem `agent_start`, o `rodarPi` só resolve com `undefined` se alguém encerra a sessão; vira texto da falha.
    if (resultado !== true) {
      throw new ErroExterno(
        `o agente da auditoria não subiu: ${String(resultado)}`,
        `confira o pi e o log em ${join(dir, "log")}`,
      );
    }
    return sessao;
  } catch (error_) {
    const jsonl = arquivoDaSessao(raiz, sessao);
    if (jsonl) rmSync(jsonl);
    rmSync(dir, { recursive: true, force: true });
    throw error_;
  }
}

export interface Auditoria {
  /** O mês `AAAA-MM` auditado e ele por extenso. */
  mes: string;
  rotulo: string;
  /** Quantas sessões o agente recebeu e quantas por projeto. */
  sessoes: number;
  projetos: Record<string, number>;
  estado: EstadoDaAuditoria;
  /** O que já aconteceu, do JSONL da sessão do pi; o `prompt.md` vai marcado com `fabriquinha: true`. */
  conversa: unknown[];
  /** Os eventos ao vivo, com `{ type: "estado", estado }` quando o estado muda. Devolve a função que cancela. */
  assinar(ouvinte: (evento: EventoPi) => void): () => void;
}

/** A auditoria `sessao`: o que o agente recebeu, o estado e a conversa até agora. */
export function abrirAuditoria(banco: DatabaseSync, sessao: string): Auditoria {
  const raiz = raizDo(banco);
  const dir = pastaExistente(raiz, sessao);
  const { mes, sessoes, projetos } = JSON.parse(readFileSync(join(dir, "auditoria.json"), "utf8")) as Pick<
    Auditoria,
    "mes" | "sessoes" | "projetos"
  >;
  const prompt = readFileSync(join(dir, "prompt.md"), "utf8");
  const ehPrompt = (mensagem: unknown): boolean => {
    const m = mensagem as Partial<Mensagem> | undefined;
    return m?.role === "user" && texto(m as Mensagem) === prompt;
  };
  const conversa = lerConversa(raiz, sessao) as { message?: unknown }[];
  const primeira = conversa.findIndex((e) => (e.message as { role?: string } | undefined)?.role === "user");
  return {
    mes,
    rotulo: mesPorExtenso(mes),
    sessoes,
    projetos,
    estado: estadoDaAuditoria(sessao),
    conversa: conversa.map((e, i) => (i === primeira && ehPrompt(e.message) ? { ...e, fabriquinha: true } : e)),
    assinar: (ouvinte) =>
      assinarSessao(sessao, (evento) => {
        if (evento.type === "estado") ouvinte({ type: "estado", estado: estadoDaAuditoria(sessao) });
        else
          ouvinte(
            evento.type === "message_end" && ehPrompt(evento.message) ? { ...evento, fabriquinha: true } : evento,
          );
      }),
  };
}

/**
 * A pergunta do Auditor: `prompt` ao pi vivo e ocioso, ou, com o pi parado (ociosidade ou reinício), um pi novo na mesma
 * sessão e na mesma pasta, que lê o mesmo histórico (CA-8). Recusa com o agente trabalhando e com o pi ainda parando.
 */
export function enviarNaAuditoria(
  banco: DatabaseSync,
  sessao: string,
  mensagem: string,
  { ociosidadeMin }: OpcoesDaAuditoria,
): void {
  const raiz = raizDo(banco);
  pastaExistente(raiz, sessao);
  const viva = situacao(sessao);
  if (viva?.ocupado) {
    throw new ErroDeRegra("o agente da auditoria está trabalhando", "espere a resposta, ou use Abortar");
  }
  if (viva) mandar(sessao, { type: "prompt", message: mensagem });
  else if (tarefas.has(sessao)) {
    throw new ErroDeRegra("o agente da auditoria ainda está parando", "tente de novo em alguns segundos");
  } else void subir(raiz, sessao, mensagem, ociosidadeMin);
}

/** Manda `abort` ao agente da auditoria que trabalha. */
export function abortarAuditoria(sessao: string): void {
  abortar(sessao);
}

/**
 * Na subida do serviço, mata o grupo de cada pi de auditoria que a instância anterior deixou (F4 §7): o `pgid` fica em
 * `auditorias/<sessão>/pgid` enquanto o pi vive.
 */
export function recuperarAuditorias(raiz: string): void {
  const dir = join(raiz, "auditorias");
  for (const nome of existsSync(dir) ? readdirSync(dir) : []) {
    const pgid = join(dir, nome, "pgid");
    if (!existsSync(pgid)) continue;
    sinalNoGrupo(Number(readFileSync(pgid, "utf8")), "SIGKILL");
    rmSync(pgid);
  }
}
