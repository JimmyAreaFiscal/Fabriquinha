// Tokens, modelo e custo de cada Etapa, do Uso medido nas execuções e do Uso declarado das sessões externas.
import { type LinhaDeUso, textoDoCusto, Uso, type UsoDaExecucao, usoEmLote } from "../../../../sessoes/publico.ts";
import { CATALOGO_DE_ETAPAS, EtapaTicket } from "../../../etapas/publico.ts";
import { MetricaPorEtapa } from "../calculo_de_metrica.ts";
import { encontrado } from "../../../../../shared/nucleo/erros.ts";
import { type EscopoDosFatos, lerExecucoesDoRecorte, lerUsoDeclaradoDoRecorte } from "../leitura_dos_fatos.ts";

/** O Uso medido como Uso; o banco não guarda as chamadas do uso medido, por isso 0, e o custo ausente é desconhecido. */
const linhaDeUsoMedido = (uso: UsoDaExecucao): LinhaDeUso => ({
  modelo: `${uso.modelo_provedor}/${uso.modelo_nome}`,
  tokens_entrada: uso.tokens_entrada,
  tokens_saida: uso.tokens_saida,
  tokens_cache_leitura: uso.tokens_cache_leitura,
  tokens_cache_escrita: uso.tokens_cache_escrita,
  custo: uso.custo ?? null,
  chamadas: 0,
});

/** O Uso das execuções, cada uma um Trabalho: o custo desconhecido conta uma sessão sem custo por execução. */
export const usoPorExecucao = (usos: readonly UsoDaExecucao[]): Uso =>
  [...Map.groupBy(usos, (uso) => uso.execucao_id).values()]
    .map((daExecucao) => Uso.de(daExecucao.map(linhaDeUsoMedido), 1))
    .reduce((total, daExecucao) => total.somar(daExecucao), Uso.vazio());

/** O Uso declarado, cada sessão externa um Trabalho. */
export const usoDeclaradoDe = (declarado: readonly { linhas: LinhaDeUso[] }[]): Uso =>
  declarado.map((d) => Uso.de(d.linhas, 1)).reduce((total, daSessao) => total.somar(daSessao), Uso.vazio());

// shortcut: o Uso declarado não tem Etapa e conta na Etapa de executor externo (só uma o é); dar Etapa à declaração se houver sessão externa de outra.
const ETAPA_DO_USO_DECLARADO = EtapaTicket.options.find((etapa) => CATALOGO_DE_ETAPAS[etapa].executor === "externo");

const somar = (numeros: number[]) => numeros.reduce((soma, n) => soma + n, 0);

/** As execuções e o Uso medido de cada Etapa, e as sessões externas declaradas com Uso, do recorte. */
interface FatosDeUso {
  execucoesPorEtapa: Map<string, { falha: boolean; duracaoMs: number }[]>;
  usoPorEtapa: Map<string, UsoDaExecucao[]>;
  sessoesExternas: { linhas: LinhaDeUso[] }[];
}

export class MetricaDeUso extends MetricaPorEtapa<
  FatosDeUso,
  {
    execucoes: number;
    falhas: number;
    duracaoMs: number;
    tokens: { entrada: number; saida: number; cacheLeitura: number; cacheEscrita: number; total: number };
    modelos: LinhaDeUso[];
    /** Custo ausente não é zero: `trabalhosSemCusto > 0` avisa que `conhecido` soma só o que foi informado. */
    custo: { conhecido: number; trabalhosSemCusto: number };
    /** O custo como todas as telas o mostram (`textoDoCusto`). */
    textoDoCusto: string;
    /** A parte do custo vinda das sessões externas declaradas, já somada em `custo`. */
    custoExterno: { conhecido: number; trabalhosSemCusto: number; sessoes: number };
  }
> {
  readonly definicao = { tipo: "uso", rotulo: "Uso", fonte: "Uso" } as const;

  /** Cada linha do Uso medido vale uma vez, na execução dela: a retomada não a repete. */
  protected lerFatos(escopo: EscopoDosFatos): FatosDeUso {
    const execucoes = lerExecucoesDoRecorte(escopo);
    const etapaDaExecucao = new Map(execucoes.map((execucao) => [execucao.id, execucao.etapa]));
    const usos = usoEmLote(escopo.banco, { demandas: escopo.demandas, periodo: escopo.periodo });
    return {
      execucoesPorEtapa: Map.groupBy(execucoes, (execucao) => execucao.etapa),
      usoPorEtapa: Map.groupBy(usos, (uso) =>
        encontrado(
          etapaDaExecucao.get(uso.execucao_id),
          `a execução ${uso.execucao_id} do Uso não está no recorte`,
          "leia o Uso e as execuções com o mesmo filtro",
        ),
      ),
      sessoesExternas: lerUsoDeclaradoDoRecorte(escopo).filter((sessao) => sessao.linhas.length > 0),
    };
  }

  formula({ execucoesPorEtapa, usoPorEtapa, sessoesExternas }: FatosDeUso) {
    return (etapa: EtapaTicket) => {
      const execucoes = execucoesPorEtapa.get(etapa) ?? [];
      const sessoesDaEtapa = etapa === ETAPA_DO_USO_DECLARADO ? sessoesExternas : [];
      const usoExterno = usoDeclaradoDe(sessoesDaEtapa);
      const uso = usoPorExecucao(usoPorEtapa.get(etapa) ?? []).somar(usoExterno);
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
