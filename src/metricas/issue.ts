// Métricas do diagrama de uma issue (F6 §2, §5.1 a §5.6, §6.2): leituras sobre fatos já gravados, sem mudar estado.
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { type Agregado, type Decisao, GateDecisao, type NomeComando } from "../dominio/agregado.ts";
import { ErroDeInexistente, ErroDeRegra } from "../dominio/erros.ts";
import { Etapa, type Fase, Id, Instante } from "../dominio/primitivos.ts";
import { raizDo } from "../persistencia/banco.ts";
import { arquivoDaSessao, noLog } from "../persistencia/execucoes.ts";
import { agregado } from "../persistencia/issues.ts";
import {
  bugsEmArquivosRevisados,
  comandosDoAuditor,
  retrabalhoDaIssue,
  type SomaDeUso,
  type UsoDoModelo,
  usoDaIssue,
} from "../persistencia/metricas.ts";

export const Inteiro = z.number().int().nonnegative();
export const Consumo = z.object({
  chamadas: Inteiro,
  tokens: z.object({ input: Inteiro, output: Inteiro, cacheRead: Inteiro, cacheWrite: Inteiro }),
  custo: z.number().nonnegative(), // US$, como o pi calculou
});
export const ConsumoModelo = Consumo.extend({ provedor: z.string(), modelo: z.string() });
export const Nota = z.number().int().min(1).max(5);
const Correcoes = z.object({ devolucoes: Inteiro, ajustesAuditor: Inteiro });

export const MetricasIssue = z.object({
  issue: Id,
  geradoEm: Instante,
  // M1 e apoio; só execuções autônomas e interativas.
  etapas: z.array(
    Consumo.extend({
      etapa: Etapa,
      execucoes: Inteiro,
      falhas: Inteiro,
      duracaoMs: Inteiro,
      reprovacoes: Inteiro,
      modelos: z.array(ConsumoModelo),
    }),
  ),
  // M1 das consultas do Auditor (F4 §6.5), fora das etapas.
  consultas: Consumo.extend({ execucoes: Inteiro, modelos: z.array(ConsumoModelo) }),
  correcoesRegistro: Correcoes, // M2
  correcoesDesenho: Correcoes, // M3
  // 5.5; null antes do desenho concluído.
  desenho: z
    .object({
      arquivosPrevistos: Inteiro,
      ticketsPropostos: Inteiro,
      novasDependencias: Inteiro,
      novosAcoplamentos: Inteiro,
    })
    .nullable(),
  // M4
  retrabalho: z.array(
    z.object({
      ticket: Id,
      linhasAdicionadas: Inteiro,
      linhasAlteradasDepois: Inteiro,
      linhasAlteradasPorHumanos: Inteiro,
    }),
  ),
  exigenciasRevisao: Inteiro, // M5
  bugsEmArquivosRevisados: Inteiro, // M6; 0 antes do merge
  notaPR: Nota.nullable(), // M7; null até o encerramento
  decisoes: z.array(
    z.object({
      gate: GateDecisao,
      aprovado: z.boolean(),
      motivo: z.string().optional(),
      nota: Nota.optional(),
      em: Instante,
    }),
  ),
  execucoesSemSessao: z.array(Id),
});

export type Consumo = z.infer<typeof Consumo>;
export type MetricasIssue = z.infer<typeof MetricasIssue>;

/** A etapa de cada gate, para as reprovações do apoio (F6 §5.6); a decisão `pr` é o C16, do encerramento. */
export const ETAPA_DO_GATE: Readonly<Record<Decisao["gate"], Etapa>> = {
  registro: "registro",
  desenho: "desenho",
  revisao: "revisao",
  pr: "encerramento",
};

/** F6 §5.1: os comandos que contam como ajuste do Auditor, na fase de cada gate. */
const AJUSTES = {
  registro: ["editarIssue", "adicionarDependencia", "removerDependencia"],
  aprovacao_desenho: ["adicionarTicketDesenvolvimento", "editarTicket", "removerTicket"],
} as const satisfies Partial<Record<Fase, readonly NomeComando[]>>;

// Só os campos dos números do desenho (F6 §5.5); o resto da evidência foi validado na submissão (F3).
const SolucaoDesenhada = z.object({ arquivosPrevistos: z.array(z.unknown()) });
const ImpactosArquitetura = z.object({
  novasDependencias: z.array(z.unknown()),
  novosAcoplamentos: z.array(z.unknown()),
});

/** A soma de vários consumos. */
export const somar = (itens: readonly Consumo[]): Consumo =>
  itens.reduce(
    (s, c) => ({
      chamadas: s.chamadas + c.chamadas,
      tokens: {
        input: s.tokens.input + c.tokens.input,
        output: s.tokens.output + c.tokens.output,
        cacheRead: s.tokens.cacheRead + c.tokens.cacheRead,
        cacheWrite: s.tokens.cacheWrite + c.tokens.cacheWrite,
      },
      custo: s.custo + c.custo,
    }),
    { chamadas: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, custo: 0 },
  );

/** O `Consumo` de uma soma de linhas de uso. */
export const consumoDe = ({ chamadas, input, output, cacheRead, cacheWrite, custo }: SomaDeUso): Consumo => ({
  chamadas,
  tokens: { input, output, cacheRead, cacheWrite },
  custo,
});

/** O consumo por modelo e o total, a partir das linhas de uso por modelo. */
export function consumo(linhas: readonly UsoDoModelo[]) {
  const modelos = linhas.map((l) => ({ provedor: l.provedor, modelo: l.modelo, ...consumoDe(l) }));
  return { ...somar(modelos), modelos };
}

/**
 * F6 §5.5: os números objetivos do último desenho concluído, ou `null` antes dele. Evidência faltando ou malformada
 * também dá `null`, com um aviso no log do serviço: métrica nunca é gate (F6 §1).
 */
function desenho(ag: Agregado): MetricasIssue["desenho"] {
  const ticket = ag.tickets.findLast((t) => t.etapa === "desenho" && t.status === "concluido");
  if (!ticket) return null;
  const dados = (tipo: string) => ag.evidencias.find((e) => e.ticket === ticket.id && e.tipo === tipo)?.dados;
  const solucao = SolucaoDesenhada.safeParse(dados("desenho_solucao"));
  const impactos = ImpactosArquitetura.safeParse(dados("relatorio_impactos_arquitetura"));
  if (!solucao.success || !impactos.success) {
    noLog(`I-${String(ag.issue.id)}: evidências do desenho de T-${String(ticket.id)} faltando ou malformadas`);
    return null;
  }
  return {
    arquivosPrevistos: solucao.data.arquivosPrevistos.length,
    ticketsPropostos: ag.tickets.filter((t) => t.etapa === "desenvolvimento" && t.origemTicket === ticket.id).length,
    novasDependencias: impactos.data.novasDependencias.length,
    novosAcoplamentos: impactos.data.novosAcoplamentos.length,
  };
}

/**
 * A sessão do pi da execução não tem arquivo (F6 §3.3) ou tem mais de um: nos dois casos a coleta não contou o uso
 * dela, e o relatório avisa.
 */
function semSessao(raiz: string, sessao: string): boolean {
  try {
    return arquivoDaSessao(raiz, sessao) === undefined;
  } catch (error_) {
    if (error_ instanceof ErroDeRegra) return true;
    throw error_;
  }
}

/**
 * F6 §6.2: as métricas do diagrama da issue (M1 a M7) e o apoio por etapa, com os valores atuais. Usada pelo web e
 * pelo relatório de produtividade.
 * ponytail: lê o agregado e as demais tabelas em snapshots separados; o relatório é uma fotografia, e uma escrita
 * entre as leituras só desloca um número para o próximo.
 */
export function metricasDaIssue(banco: DatabaseSync, issue: Id): MetricasIssue {
  const ag = agregado(banco, issue);
  if (!ag) throw new ErroDeInexistente(`a issue I-${String(issue)} não existe`, "confira o número da issue");
  const uso = Map.groupBy(usoDaIssue(banco, issue), (l) => l.etapa);
  const etapaDoTicket = new Map(ag.tickets.map((t) => [t.id, t.etapa]));
  const comandos = comandosDoAuditor(banco, issue);
  const devolucoes = (gate: Decisao["gate"]) => ag.decisoes.filter((d) => d.gate === gate && !d.aprovado).length;
  const ajustes = (fase: keyof typeof AJUSTES) =>
    comandos
      .filter((c) => c.fase === fase && (AJUSTES[fase] as readonly string[]).includes(c.nome))
      .reduce((n, c) => n + c.n, 0);
  const revisoes = new Set(ag.tickets.filter((t) => t.etapa === "revisao").map((t) => t.id));
  const consultas = ag.execucoes.filter((e) => e.modo === "consulta");
  const raiz = raizDo(banco);

  return MetricasIssue.parse({
    issue,
    geradoEm: new Date().toISOString(),
    etapas: Etapa.options
      .filter((etapa) => ag.tickets.some((t) => t.etapa === etapa))
      .map((etapa) => {
        const execucoes = ag.execucoes.filter((e) => e.modo !== "consulta" && etapaDoTicket.get(e.ticket) === etapa);
        return {
          etapa,
          ...consumo(uso.get(etapa) ?? []),
          execucoes: execucoes.length,
          falhas: execucoes.filter((e) => e.resultado === "falha").length,
          duracaoMs: execucoes.reduce(
            // Um relógio que volta não deixa a duração negativa.
            (ms, e) =>
              ms +
              (e.terminadaEm === undefined ? 0 : Math.max(0, Date.parse(e.terminadaEm) - Date.parse(e.iniciadaEm))),
            0,
          ),
          reprovacoes: ag.decisoes.filter((d) => !d.aprovado && ETAPA_DO_GATE[d.gate] === etapa).length,
        };
      }),
    consultas: { ...consumo(uso.get(null) ?? []), execucoes: consultas.length },
    correcoesRegistro: { devolucoes: devolucoes("registro"), ajustesAuditor: ajustes("registro") },
    correcoesDesenho: { devolucoes: devolucoes("desenho"), ajustesAuditor: ajustes("aprovacao_desenho") },
    desenho: desenho(ag),
    retrabalho: retrabalhoDaIssue(banco, issue),
    exigenciasRevisao: ag.tickets.filter(
      (t) => t.etapa === "desenvolvimento" && t.origemTicket !== undefined && revisoes.has(t.origemTicket),
    ).length,
    bugsEmArquivosRevisados: bugsEmArquivosRevisados(banco, issue),
    notaPR: ag.decisoes.find((d) => d.gate === "pr" && d.aprovado)?.nota ?? null,
    decisoes: ag.decisoes.map(({ id, issue: _, ticket, por, ...d }) => d),
    execucoesSemSessao: ag.execucoes
      .filter((e) => e.terminadaEm !== undefined && semSessao(raiz, e.sessaoPi))
      .map((e) => e.id),
  });
}
