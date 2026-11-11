// O contrato da API das Métricas: o filtro de período e o corpo das duas visões (por mês e por demanda).
// São só tipos e schemas: quem monta o valor é a consulta, quem o valida na saída é o teste de rota.
import { z } from "zod";
import { Mes } from "../../compartilhado/nucleo/periodo.ts";
import type { TipoMetrica } from "../../custos/nucleo/metrica.ts";
import { EtapaTicket, Slug } from "../../compartilhado/nucleo/primitivos.ts";

/** Sem `projeto`, todos; sem `ate`, o mês corrente; sem `de`, os 11 meses antes de `ate`. */
export const FiltroDeMetricas = z.object({ projeto: Slug.optional(), de: Mes.optional(), ate: Mes.optional() });
export type FiltroDeMetricas = z.infer<typeof FiltroDeMetricas>;

const Texto = z.string();
const Contagem = z.number().int().nonnegative();
const Numero = z.number();
/** Custo ausente não é zero: `trabalhosSemCusto > 0` avisa que `conhecido` soma só o que foi informado. */
const Custo = z.object({ conhecido: Numero, trabalhosSemCusto: Contagem });

const LinhaDeUso = z.object({
  modelo: Texto,
  tokens_entrada: Contagem,
  tokens_saida: Contagem,
  tokens_cache_leitura: Contagem,
  tokens_cache_escrita: Contagem,
  custo: Numero.nullable(),
  chamadas: Contagem,
});

/** O Uso somado de um grupo, com o custo como todas as telas o mostram (`textoDoCusto`). */
const SomaDeUso = z.object({
  execucoes: Contagem,
  falhas: Contagem,
  duracaoMs: Numero,
  tokens: z.object({
    entrada: Contagem,
    saida: Contagem,
    cacheLeitura: Contagem,
    cacheEscrita: Contagem,
    total: Contagem,
  }),
  custo: Custo,
  textoDoCusto: Texto,
});

/** Uma Métrica de Sucesso com a definição que a tela mostra e o valor que o seu tipo declara. */
const metrica = <const Tipo extends string, Valor extends z.ZodType>(tipo: Tipo, valor: Valor) =>
  z.object({ definicao: z.object({ tipo: z.literal(tipo), rotulo: Texto, fonte: Texto }), valor });

const ValorDaMetrica = z.union([
  metrica(
    "uso",
    SomaDeUso.extend({
      modelos: z.array(LinhaDeUso),
      /** A parte do custo vinda das sessões externas declaradas, já somada em `custo`. */
      custoExterno: Custo.extend({ sessoes: Contagem }),
    }),
  ),
  metrica("aprovacoes_e_reprovacoes", z.object({ aprovacoes: Contagem, reprovacoes: Contagem })),
  metrica(
    "conformidade_com_o_plano",
    z.object({
      /** O Jaccard de todas as rodadas do recorte juntas; `null` sem rodada com plano e commit. */
      percentual: Numero.nullable(),
      comuns: Contagem,
      uniao: Contagem,
      rodadas: z.array(
        z.object({
          demandaId: Texto,
          rodadaId: Contagem,
          percentual: Numero,
          comuns: Contagem,
          uniao: Contagem,
          ausentes: z.array(Texto),
          extras: z.array(Texto),
        }),
      ),
    }),
  ),
  metrica("alteracoes_posteriores", z.object({ adicionadas: Contagem, alteradasPorHumanos: Contagem })),
  metrica("exigencias_de_alteracao", z.object({ reprovacoes: Contagem })),
  metrica("bugs_nos_arquivos_revisados", z.object({ alteradasPorHumanos: Contagem })),
  metrica("nota_humana", z.object({ soma: Numero, quantidade: Contagem, media: Numero.nullable() })),
]);

/** O valor que a Métrica de Sucesso do tipo `Tipo` carrega. */
export type ValorDaMetricaDoTipo<Tipo extends TipoMetrica> = Extract<
  z.infer<typeof ValorDaMetrica>,
  { definicao: { tipo: Tipo } }
>["valor"];

/** As Métricas de um mês, de todos os projetos ou de um. */
export const MetricasDoMes = z.object({
  mes: Mes,
  /** `null` = todos os projetos. */
  projeto: Texto.nullable(),
  /** Todas as Etapas, na ordem do fluxo. */
  etapas: z.array(z.object({ etapa: EtapaTicket, metricas: z.array(ValorDaMetrica) })),
  /** O Uso de todas as Etapas somado. */
  total: SomaDeUso.extend({ modelos: z.array(LinhaDeUso) }),
  /** A soma dos grupos de cada nível, que é sempre o `total`. */
  niveis: z.array(
    z.object({
      nivel: z.enum(["execucao", "sessao", "ticket", "rodada", "demanda", "projeto"]),
      grupos: Contagem,
      total: SomaDeUso,
    }),
  ),
  demandas: z.object({ registradas: Contagem, concluidas: Contagem }),
  tickets: z.object({ criados: Contagem, concluidos: Contagem }),
  prs: z.object({ abertos: Contagem, mergeados: Contagem }),
});

export type MetricasDoMes = z.infer<typeof MetricasDoMes>;

/** Uma entrada por mês do período, do mais antigo ao mais recente. */
export const MetricasDosMeses = z.array(MetricasDoMes);

/** As demandas com execução no período e o Uso somado de todas, que é o rodapé da tabela. */
export const MetricasDasDemandas = z.object({
  demandas: z.array(
    SomaDeUso.extend({
      demanda: Texto,
      projeto: Texto,
      titulo: Texto,
      estado: Texto,
      /** As Reprovações do Gate da demanda e as exigências de alteração das revisões. */
      reprovacoes: Contagem,
      /** O Jaccard do plano × arquivos alterados, de 0 a 100; `null` sem rodada com plano e commit. */
      conformidade: Numero.nullable(),
      /** Média da nota humana dada no período; `null` sem nota. */
      nota: Numero.nullable(),
    }),
  ),
  total: SomaDeUso.extend({ conformidade: Numero.nullable(), nota: Numero.nullable() }),
});
export type MetricasDasDemandas = z.infer<typeof MetricasDasDemandas>;
