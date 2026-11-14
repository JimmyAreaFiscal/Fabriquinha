// As Métricas da tela de Métricas, do Início e do Projeto: as de cada Etapa por mês e as que a tabela mostra por Demanda,
// as do SDLC inteiro por mês, e a soma do Uso em cada nível de agrupamento. Junta as do processo (Ciclo de Vida), a de
// Uso (Sessões) e as do Repositório pela Etapa: cada módulo lê os fatos dele uma vez para o período inteiro, e eles se
// repartem por mês ou por demanda sem ler de novo. O Uso da demanda lê só o Uso.
import { intervalo } from "../../../../shared/nucleo/periodo.ts";
import { encontrado } from "../../../../shared/nucleo/erros.ts";
import { type CustoDoUso, type LinhaDeUso, Uso } from "../../../../modulos/sessoes/publico.ts";
import {
  EtapaTicket,
  type MetricasDoProcesso,
  type ParteDoFato,
  Periodo,
  type Recorte,
  type TipoMetrica,
  type ValorDaMetrica,
  type ValoresPorParte,
} from "../../../../modulos/ciclo_de_vida/publico.ts";
import {
  type DeclaracaoDasEtapas,
  DEFINICAO_DO_USO,
  type ExecucaoDoUso,
  type FatosDeUso,
  lerFatosDeUso,
  type OrigemDasMetricas,
  somarUsos,
  textoDoCusto,
  usoDaEtapa,
  usoPorEtapa,
  valoresDasEtapasQueDeclaram,
  type ValorDoUso,
} from "./metrica_de_uso.ts";
import {
  alteracoesPosterioresDaEtapa,
  bugsNosArquivosRevisadosDaEtapa,
  type CommitDaEtapa,
  DEFINICAO_DAS_ALTERACOES_POSTERIORES,
  DEFINICAO_DOS_BUGS_NOS_ARQUIVOS_REVISADOS,
  lerCommitsDoPeriodo,
} from "./metricas_dos_commits.ts";

interface Soma {
  execucoes: number;
  falhas: number;
  duracaoMs: number;
  tokens: { entrada: number; saida: number; cacheLeitura: number; cacheEscrita: number; total: number };
  custo: CustoDoUso;
  /** O custo como todas as telas o mostram (`textoDoCusto`). */
  textoDoCusto: string;
}

/** @testes o teste exercita direto; a produção a usa só dentro do módulo */
export const NIVEIS = ["execucao", "sessao", "ticket", "rodada", "demanda", "projeto"] as const;
type Nivel = (typeof NIVEIS)[number];

/** Uma execução do período com a demanda, o ticket e a Etapa dela; cada execução vale uma vez, no mês em que começou. */
interface ExecucaoNoPeriodo {
  execucao: string;
  sessao: string;
  ticket: number;
  /** `null` = ticket de demanda, sem rodada. */
  rodada: number | null;
  demanda: string;
  projeto: string;
  titulo: string;
  estado: string;
  etapa: string;
  inicio: string;
  falha: boolean;
  duracaoMs: number;
}

/** As execuções do período, com o cabeçalho da demanda de cada uma, na ordem do início. */
function execucoesNoPeriodo(processo: MetricasDoProcesso, execucoes: readonly ExecucaoDoUso[]): ExecucaoNoPeriodo[] {
  const pedidos = new Map(processo.pedidos.map((pedido) => [pedido.id, pedido]));
  return execucoes.map((execucao) => {
    const { projeto, titulo, estado } = encontrado(
      pedidos.get(execucao.demanda_id),
      `a demanda ${execucao.demanda_id} da execução não está entre os pedidos`,
      "passe os pedidos de todas as demandas do recorte",
    );
    return {
      execucao: execucao.id,
      sessao: execucao.sessao,
      ticket: execucao.ticket_id,
      rodada: execucao.rodadaId,
      demanda: execucao.demanda_id,
      projeto,
      titulo,
      estado,
      etapa: execucao.etapa,
      inicio: execucao.inicio,
      falha: execucao.falha,
      duracaoMs: execucao.duracaoMs,
    };
  });
}

const CHAVE_DO_NIVEL: Record<Nivel, (e: ExecucaoNoPeriodo) => string> = {
  execucao: (e) => e.execucao,
  sessao: (e) => e.sessao,
  ticket: (e) => `${e.demanda}\0${String(e.ticket)}`,
  rodada: (e) => `${e.demanda}\0${String(e.rodada)}`,
  demanda: (e) => e.demanda,
  projeto: (e) => e.projeto,
};

/** Uma Etapa com os valores das Métricas que o catálogo declara para ela. */
/** @testes o teste exercita direto; a produção o usa só dentro do módulo */
export interface MetricasDaEtapa {
  etapa: EtapaTicket;
  metricas: ValorDaMetrica[];
}

/** @testes o teste de rota tipa o corpo da resposta com ele */
export interface MetricasDoMes {
  mes: string;
  /** `null` = todos os projetos. */
  projeto: string | null;
  /** Todas as Etapas, na ordem do fluxo. */
  etapas: MetricasDaEtapa[];
  /** O Uso de todas as Etapas somado. */
  total: Soma & { modelos: LinhaDeUso[] };
  /** A soma dos grupos de cada nível, que é sempre o `total`. */
  niveis: { nivel: Nivel; grupos: number; total: Soma }[];
  demandas: { registradas: number; concluidas: number };
  tickets: { criados: number; concluidos: number };
  prs: { abertos: number; mergeados: number };
}

interface MetricasDaDemandaNoPeriodo extends Soma {
  demanda: string;
  projeto: string;
  titulo: string;
  estado: string;
  /** As Reprovações do Gate da demanda e as exigências de alteração das revisões. */
  reprovacoes: number;
  /** O Jaccard do plano × arquivos alterados, de 0 a 100; `null` sem rodada com plano e commit. */
  conformidade: number | null;
  /** Média da nota humana dada no período; `null` sem nota. */
  nota: number | null;
}

/** As demandas do período e o Uso somado de todas, que é o que o rodapé da tabela mostra. */
/** @testes o teste de rota tipa o corpo da resposta com ele */
export interface MetricasPorDemanda {
  demandas: MetricasDaDemandaNoPeriodo[];
  total: Soma & { conformidade: number | null; nota: number | null };
}

const soma = (ns: number[]) => ns.reduce((s, n) => s + n, 0);

/** O valor da Métrica de `tipo` em cada Etapa que a declara. */
function valoresDe<Valor>(etapas: readonly MetricasDaEtapa[], tipo: TipoMetrica): Valor[] {
  return etapas.flatMap((e) => e.metricas.filter((m) => m.definicao.tipo === tipo).map((m) => m.valor as Valor));
}

/** O valor da Métrica do SDLC de `tipo`; o registro sempre a calcula. */
const valorDoSdlc = (metricas: readonly ValorDaMetrica[], tipo: string): unknown =>
  metricas.find((m) => m.definicao.tipo === tipo)?.valor;

/** O Uso de todas as Etapas somado: o que o total do mês, da demanda e do rodapé mostram. */
const somarUsoDasEtapas = (etapas: readonly MetricasDaEtapa[]): Soma => somarUso(valoresDe<ValorDoUso>(etapas, "uso"));

/** O Uso das Etapas somado. */
function somarUso(usos: readonly ValorDoUso[]): Soma {
  const tokens = (campo: keyof LinhaDeUso & `tokens_${string}`) =>
    soma(usos.flatMap((u) => u.modelos.map((m) => m[campo])));
  const [entrada, saida, cacheLeitura, cacheEscrita] = [
    tokens("tokens_entrada"),
    tokens("tokens_saida"),
    tokens("tokens_cache_leitura"),
    tokens("tokens_cache_escrita"),
  ];
  const custo = {
    conhecido: soma(usos.map((u) => u.custo.conhecido)),
    trabalhosSemCusto: soma(usos.map((u) => u.custo.trabalhosSemCusto)),
    trabalhosComCustoEstimado: soma(usos.map((u) => u.custo.trabalhosComCustoEstimado)),
  };
  return {
    execucoes: soma(usos.map((u) => u.execucoes)),
    falhas: soma(usos.map((u) => u.falhas)),
    duracaoMs: soma(usos.map((u) => u.duracaoMs)),
    tokens: { entrada, saida, cacheLeitura, cacheEscrita, total: entrada + saida + cacheLeitura + cacheEscrita },
    custo,
    textoDoCusto: textoDoCusto(custo),
  };
}

/** O Uso das Etapas por modelo. */
const somarModelos = (usos: readonly ValorDoUso[]): LinhaDeUso[] =>
  Uso.de(
    usos.flatMap((u) => u.modelos),
    0,
  ).porModelo();

/** O Uso de todas as Etapas por modelo. */
const somarModelosDasEtapas = (etapas: readonly MetricasDaEtapa[]): LinhaDeUso[] =>
  somarModelos(valoresDe<ValorDoUso>(etapas, "uso"));

/** O Uso das execuções, cada uma um Trabalho: cada linha do Uso medido pertence a uma só execução. */
const usoDe = (execs: ExecucaoNoPeriodo[], uso: ReadonlyMap<string, Uso>): Uso =>
  somarUsos(execs.map((e) => uso.get(e.execucao) ?? Uso.vazio()));

function resumir(execs: ExecucaoNoPeriodo[], doUso: Uso): Soma {
  const tokens = (campo: keyof LinhaDeUso & `tokens_${string}`) =>
    doUso.porModelo().reduce((n, linha) => n + linha[campo], 0);
  const [entrada, saida, cacheLeitura, cacheEscrita] = [
    tokens("tokens_entrada"),
    tokens("tokens_saida"),
    tokens("tokens_cache_leitura"),
    tokens("tokens_cache_escrita"),
  ];
  const custo = doUso.custo();
  return {
    execucoes: execs.length,
    falhas: execs.filter((e) => e.falha).length,
    duracaoMs: soma(execs.map((e) => e.duracaoMs)),
    tokens: { entrada, saida, cacheLeitura, cacheEscrita, total: entrada + saida + cacheLeitura + cacheEscrita },
    custo,
    textoDoCusto: textoDoCusto(custo),
  };
}

// O Uso declarado é da demanda, sem execução: entra no total de cada nível sem criar grupo.
const porNivel = (execs: ExecucaoNoPeriodo[], nivel: Nivel, uso: ReadonlyMap<string, Uso>, declarado: Uso) => {
  const grupos = [...Map.groupBy(execs, CHAVE_DO_NIVEL[nivel]).values()];
  const usoDosGrupos = grupos.map((g) => usoDe(g, uso)).reduce((total, g) => total.somar(g), declarado);
  return { nivel, grupos: grupos.length, total: resumir(grupos.flat(), usoDosGrupos) };
};

/** O Uso da demanda inteira: o que o cabeçalho dela mostra. Só a Métrica de Uso é calculada. */
export function usoDaDemanda(origem: OrigemDasMetricas, demandaId: string): Soma & { modelos: LinhaDeUso[] } {
  const usos = [...usoPorEtapa(origem, { demandaId }).values()];
  return { ...somarUso(usos), modelos: somarModelos(usos) };
}

const mesesEntre = (de: string, ate: string): number => {
  const indice = (mes: string) => Number(mes.slice(0, 4)) * 12 + Number(mes.slice(5)) - 1;
  return indice(ate) - indice(de) + 1;
};

/**
 * Todas as Etapas, cada uma com os valores das Métricas que o catálogo declara para ela, na ordem dele, no recorte e em
 * cada parte: as do processo vêm do Ciclo de Vida, e a de Uso e as do Repositório, dos fatos já lidos.
 */
function metricasDasEtapasPorParte(
  porEtapaNoCatalogo: DeclaracaoDasEtapas,
  processo: MetricasDoProcesso,
  fatosDeUso: FatosDeUso,
  commits: readonly CommitDaEtapa[],
  parteDoFato: ParteDoFato,
): ValoresPorParte<Map<EtapaTicket, ValorDaMetrica[]>> {
  const doProcesso = processo.porEtapa(parteDoFato);
  const usoDaParte = repartir(fatosDeUso, parteDoFato);
  const commitsDaParte = repartir({ commits }, parteDoFato);
  const porEtapa = (
    metricasDoProcesso: Map<EtapaTicket, ValorDaMetrica[]>,
    usoDaParte: FatosDeUso,
    { commits: commitsDaParte }: { commits: readonly CommitDaEtapa[] },
  ) => {
    const formulas: Partial<
      Record<TipoMetrica, { definicao: ValorDaMetrica["definicao"]; valor: (etapa: EtapaTicket) => unknown }>
    > = {
      uso: { definicao: DEFINICAO_DO_USO, valor: usoDaEtapa(usoDaParte, porEtapaNoCatalogo) },
      alteracoes_posteriores: {
        definicao: DEFINICAO_DAS_ALTERACOES_POSTERIORES,
        valor: alteracoesPosterioresDaEtapa(commitsDaParte),
      },
      bugs_nos_arquivos_revisados: {
        definicao: DEFINICAO_DOS_BUGS_NOS_ARQUIVOS_REVISADOS,
        valor: bugsNosArquivosRevisadosDaEtapa(commitsDaParte, porEtapaNoCatalogo),
      },
    };
    return new Map(
      EtapaTicket.options.map((etapa) => [
        etapa,
        porEtapaNoCatalogo[etapa].metricas.map((tipo): ValorDaMetrica => {
          const formula = formulas[tipo];
          if (formula) return { definicao: formula.definicao, valor: formula.valor(etapa) };
          return encontrado(
            metricasDoProcesso.get(etapa)?.find((metrica) => metrica.definicao.tipo === tipo),
            `a Métrica ${tipo} de ${etapa} não foi calculada`,
            "registre a Métrica no Ciclo de Vida, em Sessões ou no Repositório",
          );
        }),
      ]),
    );
  };
  return {
    doRecorte: () => porEtapa(doProcesso.doRecorte(), fatosDeUso, { commits }),
    daParte: (parte) => porEtapa(doProcesso.daParte(parte), usoDaParte(parte), commitsDaParte(parte)),
  };
}

/** Todas as Etapas com os valores das Métricas que o catálogo declara para cada uma, no recorte. */
/** @testes os testes pedem um recorte só; a produção junta as Etapas por mês */
export function metricasDasEtapas(origem: OrigemDasMetricas, recorte: Recorte): Map<EtapaTicket, ValorDaMetrica[]> {
  const processo = origem.cicloDeVida.metricas(origem, recorte);
  return metricasDasEtapasPorParte(
    origem.cicloDeVida.etapas().porEtapa,
    processo,
    lerFatosDeUso(origem.banco, processo),
    lerCommitsDoPeriodo(origem.banco, processo),
    DEMANDA_DO_FATO,
  ).doRecorte();
}

/** A parte de cada fato é a demanda dele. */
const DEMANDA_DO_FATO: ParteDoFato = (fato) => fato.demanda_id;

/** Os fatos de cada parte, com as mesmas listas e na mesma ordem em que foram lidos. */
function repartir<Fatos extends { readonly [Lista in keyof Fatos]: readonly { demanda_id: string; em: string }[] }>(
  fatos: Fatos,
  parteDoFato: ParteDoFato,
): (parte: string) => Fatos {
  const listas = Object.entries<readonly { demanda_id: string; em: string }[]>(fatos).map(
    ([lista, fatosDaLista]) => [lista, Map.groupBy(fatosDaLista, parteDoFato)] as const,
  );
  return (parte) =>
    Object.fromEntries(listas.map(([lista, porParte]) => [lista, porParte.get(parte) ?? []])) as unknown as Fatos;
}

/** As Métricas de cada Etapa e as do SDLC de cada mês de `de` a `ate`, de um projeto ou de todos. */
export function metricasDosMeses(origem: OrigemDasMetricas, filtro: Periodo): MetricasDoMes[] {
  const { projeto = null, de, ate } = Periodo.parse(filtro);
  const meses = Array.from({ length: mesesEntre(de, ate) }, (_, i) => intervalo(de, i));
  const processo = origem.cicloDeVida.metricas(origem, {
    inicio: intervalo(de).inicio,
    fim: intervalo(ate).fim,
    projeto,
  });
  // Os fatos vêm do período do recorte, que os meses cobrem sem buraco.
  const mesDoInstante = (instante: string) =>
    encontrado(
      meses.find((m) => instante >= m.inicio && instante < m.fim),
      `o instante ${instante} está fora do período`,
      "leia os fatos com o período do recorte",
    ).mes;
  const mesDoFato: ParteDoFato = (fato) => mesDoInstante(fato.em);
  const fatosDeUso = lerFatosDeUso(origem.banco, processo);
  const execucoes = Map.groupBy(execucoesNoPeriodo(processo, fatosDeUso.execucoes), (e) => mesDoInstante(e.inicio));
  const uso = new Map(fatosDeUso.usos.map((daExecucao) => [daExecucao.execucao, daExecucao.uso]));
  const declarado = Map.groupBy(fatosDeUso.declarados, mesDoFato);
  const etapasPorMes = metricasDasEtapasPorParte(
    origem.cicloDeVida.etapas().porEtapa,
    processo,
    fatosDeUso,
    lerCommitsDoPeriodo(origem.banco, processo),
    mesDoFato,
  );
  const doSdlcPorMes = processo.doSdlc(mesDoFato);

  return meses.map(({ mes }) => {
    const execs = execucoes.get(mes) ?? [];
    const usoDeclaradoDoMes = somarUsos((declarado.get(mes) ?? []).map((d) => d.uso));
    const etapas = [...etapasPorMes.daParte(mes)].map(([etapa, metricas]) => ({ etapa, metricas }));
    const doSdlc = doSdlcPorMes.daParte(mes);
    return {
      mes,
      projeto,
      etapas,
      total: { ...somarUsoDasEtapas(etapas), modelos: somarModelosDasEtapas(etapas) },
      niveis: NIVEIS.map((nivel) => porNivel(execs, nivel, uso, usoDeclaradoDoMes)),
      demandas: valorDoSdlc(doSdlc, "demandas") as MetricasDoMes["demandas"],
      tickets: valorDoSdlc(doSdlc, "tickets") as MetricasDoMes["tickets"],
      prs: valorDoSdlc(doSdlc, "prs") as MetricasDoMes["prs"],
    };
  });
}

/** O valor da Métrica de `tipo` em cada Etapa que a declara, na ordem do fluxo. */
const valoresDoTipo = <Valor>(porEtapa: Map<EtapaTicket, ValorDaMetrica[]>, tipo: TipoMetrica): Valor[] =>
  valoresDe<Valor>(
    [...porEtapa].map(([etapa, metricas]) => ({ etapa, metricas })),
    tipo,
  );

/**
 * As Métricas que a tabela por demanda mostra, cada fonte lida uma vez para o período inteiro, e o que a tabela tira de
 * cada uma: o Uso somado, as Reprovações do Gate da demanda com as exigências de alteração (os demais Gates e as
 * Tentativas), a conformidade com o plano e a média da nota humana.
 */
function metricasDaTabelaPorDemanda(
  porEtapaNoCatalogo: DeclaracaoDasEtapas,
  processo: MetricasDoProcesso,
  fatosDeUso: FatosDeUso,
) {
  const usoDaDemanda = repartir(fatosDeUso, DEMANDA_DO_FATO);
  const usoDasEtapas = (fatos: FatosDeUso) => [
    ...valoresDasEtapasQueDeclaram(
      porEtapaNoCatalogo,
      DEFINICAO_DO_USO.tipo,
      usoDaEtapa(fatos, porEtapaNoCatalogo),
    ).values(),
  ];
  const doProcesso = processo.porEtapa(DEMANDA_DO_FATO);
  const conformidadeDe = (porEtapa: Map<EtapaTicket, ValorDaMetrica[]>) =>
    valoresDoTipo<{ percentual: number | null }>(porEtapa, "conformidade_com_o_plano")[0]?.percentual ?? null;
  const notaDe = (porEtapa: Map<EtapaTicket, ValorDaMetrica[]>) =>
    valoresDoTipo<{ media: number | null }>(porEtapa, "nota_humana")[0]?.media ?? null;
  const reprovacoesDe = (porEtapa: Map<EtapaTicket, ValorDaMetrica[]>, tipo: TipoMetrica) =>
    soma(valoresDoTipo<{ reprovacoes: number }>(porEtapa, tipo).map((v) => v.reprovacoes));
  return {
    daDemanda: (demanda: string) => {
      const daDemanda = doProcesso.daParte(demanda);
      return {
        ...somarUso(usoDasEtapas(usoDaDemanda(demanda))),
        reprovacoes:
          reprovacoesDe(daDemanda, "aprovacoes_e_reprovacoes") + reprovacoesDe(daDemanda, "exigencias_de_alteracao"),
        conformidade: conformidadeDe(daDemanda),
        nota: notaDe(daDemanda),
      };
    },
    doPeriodo: () => {
      const doPeriodo = doProcesso.doRecorte();
      return {
        ...somarUso(usoDasEtapas(fatosDeUso)),
        conformidade: conformidadeDe(doPeriodo),
        nota: notaDe(doPeriodo),
      };
    },
  };
}

/** Uma linha por demanda com execução iniciada ou Uso declarado no período; `estado` é a atual e o resto só conta o período. */
export function metricasDasDemandasDoPeriodo(origem: OrigemDasMetricas, filtro: Periodo): MetricasPorDemanda {
  const { projeto = null, de, ate } = Periodo.parse(filtro);
  const processo = origem.cicloDeVida.metricas(origem, {
    inicio: intervalo(de).inicio,
    fim: intervalo(ate).fim,
    projeto,
  });
  const pedidos = new Map(processo.pedidos.map((pedido) => [pedido.id, pedido]));
  const fatosDeUso = lerFatosDeUso(origem.banco, processo);
  // A demanda só com Uso declarado no período também é linha, com 0 execuções: a soma das linhas é o rodapé.
  const comFatoNoPeriodo = new Set([
    ...fatosDeUso.declarados.map((declarado) => declarado.demanda_id),
    ...fatosDeUso.execucoes.map((execucao) => execucao.demanda_id),
  ]);
  const tabela = metricasDaTabelaPorDemanda(origem.cicloDeVida.etapas().porEtapa, processo, fatosDeUso);
  const demandas = [...comFatoNoPeriodo]
    .map((id) => {
      const {
        projeto: doPedido,
        titulo,
        estado,
      } = encontrado(
        pedidos.get(id),
        `a demanda ${id} não está entre os pedidos`,
        "passe os pedidos de todas as demandas do recorte",
      );
      return { demanda: id, projeto: doPedido, titulo, estado, ...tabela.daDemanda(id) };
    })
    .toSorted((a, b) => a.demanda.localeCompare(b.demanda, "pt-BR", { numeric: true }));
  return { demandas, total: tabela.doPeriodo() };
}
