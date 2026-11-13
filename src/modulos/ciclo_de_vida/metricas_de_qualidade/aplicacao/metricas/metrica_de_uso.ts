// Tokens, modelo e custo de cada Etapa, do Uso medido nas execuções e do Uso declarado das sessões externas.
import {
  type CustoDoUso,
  type LinhaDeUso,
  linhaDeUsoDaExecucao,
  textoDoCusto,
  Uso,
  type UsoDaExecucao,
} from "../../../../sessoes/publico.ts";
import { CATALOGO_DE_ETAPAS, EtapaTicket } from "../../../etapas/publico.ts";
import { MetricaPorEtapa } from "../calculo_de_metrica.ts";
import { encontrado } from "../../../../../shared/nucleo/erros.ts";
import {
  type EscopoDosFatos,
  lerExecucoesDoRecorte,
  lerUsoDeclaradoDoRecorte,
  lerUsoDoRecorte,
} from "../leitura_dos_fatos.ts";

/** O Uso das execuções, cada uma um Trabalho: o custo desconhecido conta uma sessão sem custo por execução. */
export const usoPorExecucao = (usos: readonly UsoDaExecucao[]): Uso =>
  [...Map.groupBy(usos, (uso) => uso.execucao_id).values()]
    .map((daExecucao) => Uso.de(daExecucao.map(linhaDeUsoDaExecucao), 1))
    .reduce((total, daExecucao) => total.somar(daExecucao), Uso.vazio());

/** O Uso declarado, cada sessão externa um Trabalho. */
export const usoDeclaradoDe = (declarado: readonly { linhas: LinhaDeUso[] }[]): Uso =>
  declarado.map((d) => Uso.de(d.linhas, 1)).reduce((total, daSessao) => total.somar(daSessao), Uso.vazio());

// shortcut: o Uso declarado não tem Etapa e conta na Etapa de executor externo (só uma o é); dar Etapa à declaração se houver sessão externa de outra.
const ETAPA_DO_USO_DECLARADO = EtapaTicket.options.find((etapa) => CATALOGO_DE_ETAPAS[etapa].executor === "externo");

const somar = (numeros: number[]) => numeros.reduce((soma, n) => soma + n, 0);

/** A demanda e o instante de um fato de Uso, que dizem em que parte do recorte ele cai, e a Etapa do ticket dele. */
interface DonoDoUso {
  demanda_id: string;
  em: string;
  etapa: string;
}

/** As execuções e o Uso medido do recorte, cada um com a Etapa, e as sessões externas declaradas com Uso. */
interface FatosDeUso {
  execucoes: (DonoDoUso & { falha: boolean; duracaoMs: number })[];
  /** Cada linha do Uso medido no instante da execução dela. */
  usos: (DonoDoUso & { uso: UsoDaExecucao })[];
  sessoesExternas: { demanda_id: string; em: string; linhas: LinhaDeUso[] }[];
}

export class MetricaDeUso extends MetricaPorEtapa<
  FatosDeUso,
  {
    execucoes: number;
    falhas: number;
    duracaoMs: number;
    tokens: { entrada: number; saida: number; cacheLeitura: number; cacheEscrita: number; total: number };
    modelos: LinhaDeUso[];
    /**
     * Custo ausente não é zero: `trabalhosSemCusto > 0` avisa que `conhecido` soma só o que foi informado ou estimado, e
     * `trabalhosComCustoEstimado > 0`, que parte dele foi estimada pelo catálogo de preços.
     */
    custo: CustoDoUso;
    /** O custo como todas as telas o mostram (`textoDoCusto`). */
    textoDoCusto: string;
    /** A parte do custo vinda das sessões externas declaradas, já somada em `custo`. */
    custoExterno: CustoDoUso & { sessoes: number };
  }
> {
  readonly definicao = { tipo: "uso", rotulo: "Uso", fonte: "Uso" } as const;

  /** Cada linha do Uso medido vale uma vez, na execução dela: a retomada não a repete. */
  protected lerFatos(escopo: EscopoDosFatos): FatosDeUso {
    const execucoes = lerExecucoesDoRecorte(escopo);
    const execucaoPorId = new Map(execucoes.map((execucao) => [execucao.id, execucao]));
    return {
      execucoes,
      usos: lerUsoDoRecorte(escopo).map((uso) => {
        const { demanda_id, em, etapa } = encontrado(
          execucaoPorId.get(uso.execucao_id),
          `a execução ${uso.execucao_id} do Uso não está no recorte`,
          "leia o Uso e as execuções com o mesmo filtro",
        );
        return { demanda_id, em, etapa, uso };
      }),
      sessoesExternas: lerUsoDeclaradoDoRecorte(escopo).filter((sessao) => sessao.linhas.length > 0),
    };
  }

  formula({ execucoes: todasAsExecucoes, usos, sessoesExternas }: FatosDeUso) {
    const execucoesPorEtapa = Map.groupBy(todasAsExecucoes, (execucao) => execucao.etapa);
    const usoPorEtapa = Map.groupBy(usos, (daExecucao) => daExecucao.etapa);
    return (etapa: EtapaTicket) => {
      const execucoes = execucoesPorEtapa.get(etapa) ?? [];
      const sessoesDaEtapa = etapa === ETAPA_DO_USO_DECLARADO ? sessoesExternas : [];
      const usoExterno = usoDeclaradoDe(sessoesDaEtapa);
      const uso = usoPorExecucao((usoPorEtapa.get(etapa) ?? []).map((daExecucao) => daExecucao.uso)).somar(usoExterno);
      const modelos = uso.porModelo();
      const [entrada, saida, cacheLeitura, cacheEscrita] = [
        somar(modelos.map((m) => m.tokens_entrada)),
        somar(modelos.map((m) => m.tokens_saida)),
        somar(modelos.map((m) => m.tokens_cache_leitura)),
        somar(modelos.map((m) => m.tokens_cache_escrita)),
      ];
      return {
        execucoes: execucoes.length,
        falhas: execucoes.filter((e) => e.falha).length,
        duracaoMs: somar(execucoes.map((e) => e.duracaoMs)),
        tokens: { entrada, saida, cacheLeitura, cacheEscrita, total: entrada + saida + cacheLeitura + cacheEscrita },
        modelos,
        custo: uso.custo(),
        textoDoCusto: textoDoCusto(uso),
        custoExterno: { ...usoExterno.custo(), sessoes: sessoesDaEtapa.length },
      };
    };
  }
}
