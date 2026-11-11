// Tokens, modelo e custo de cada Etapa, do Uso medido nas execuções e do Uso declarado das sessões externas.
import type { DatabaseSync } from "node:sqlite";
import {
  type DonoDaLinha,
  execucoesDoRecorte,
  type UsoDaExecucao,
  usoDeclaradoDoRecorte,
  usoDoRecorte,
} from "../../armazenamento/metricas_demanda.ts";
import type { Recorte } from "../../nucleo/metrica.ts";
import type { EtapaTicket } from "../../../compartilhado/nucleo/primitivos.ts";
import { type LinhaDeUso, textoDoCusto, Uso } from "../../nucleo/uso.ts";
import { CalculoDeMetrica } from "./calculo_de_metrica.ts";

/** A linha de `uso_modelo_execucao` como Uso; o banco não guarda as chamadas do uso medido, por isso 0. */
const linhaDeUsoDoBanco = (u: Omit<UsoDaExecucao, keyof DonoDaLinha>): LinhaDeUso => ({
  modelo: `${u.provedor}/${u.modelo}`,
  tokens_entrada: u.entrada,
  tokens_saida: u.saida,
  tokens_cache_leitura: u.cacheLeitura,
  tokens_cache_escrita: u.cacheEscrita,
  custo: u.custo,
  chamadas: 0,
});

/** O Uso das execuções, cada uma um Trabalho: o custo desconhecido conta uma sessão sem custo por execução. */
export const usoPorExecucao = (uso: Omit<UsoDaExecucao, keyof DonoDaLinha>[]): Uso =>
  [...Map.groupBy(uso, (u) => u.execucao).values()]
    .map((daExecucao) => Uso.de(daExecucao.map(linhaDeUsoDoBanco), 1))
    .reduce((total, daExecucao) => total.somar(daExecucao), Uso.vazio());

/** O Uso declarado, cada sessão externa um Trabalho. */
export const usoDeclaradoDe = (declarado: { linhas: LinhaDeUso[] }[]): Uso =>
  declarado.map((d) => Uso.de(d.linhas, 1)).reduce((total, daSessao) => total.somar(daSessao), Uso.vazio());

// shortcut: o Uso declarado não tem Etapa e conta em entender_e_desenhar, a de executor externo; dar Etapa à declaração se houver sessão externa de outra.
const ETAPA_DO_USO_DECLARADO: EtapaTicket = "entender_e_desenhar";

const somar = (numeros: number[]) => numeros.reduce((soma, n) => soma + n, 0);

export class MetricaDeUso extends CalculoDeMetrica<{
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
}> {
  readonly definicao = { tipo: "uso", rotulo: "Uso", fonte: "Uso" } as const;

  protected medir(banco: DatabaseSync, recorte: Recorte) {
    const execucoesPorEtapa = Map.groupBy(execucoesDoRecorte(banco, recorte), (e) => e.etapa);
    const usoPorEtapa = Map.groupBy(usoDoRecorte(banco, recorte), (u) => u.etapa);
    const sessoesExternas = usoDeclaradoDoRecorte(banco, recorte).filter((sessao) => sessao.linhas.length > 0);
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
