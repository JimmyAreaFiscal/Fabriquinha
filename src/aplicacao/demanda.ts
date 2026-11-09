// Métricas da demanda e das rodadas: tokens, custo, etapas e nota (comparacao-sdlc-implementacao.md §8).
import type { DatabaseSync } from "node:sqlite";
import { ErroDeInexistente } from "../nucleo/erros.ts";
import {
  decisoesDaDemanda,
  demandaExiste,
  type DonoDaLinha,
  execucoesDaDemanda,
  linhasExternasDaDemanda,
  rodadasDaDemanda,
  ticketsDaDemanda,
  type UsoDaExecucao,
  usoDaDemanda,
} from "../armazenamento/metricas_demanda.ts";
import { type LinhaDeUso, textoDoCusto, Uso } from "../nucleo/uso.ts";
import { type Conformidade, conformidadeDaRodada } from "./conformidade.ts";

/** Custo ausente não é zero: `trabalhosSemCusto > 0` avisa que `conhecido` soma só o que foi informado. */
type CustoDoUso = ReturnType<Uso["custo"]>;

type CustoExterno = CustoDoUso & { sessoes: number };

interface Contagens {
  execucoes: number;
  falhas: number;
  exigenciasDeAlteracao: number;
  reprovacoes: number;
  modelos: LinhaDeUso[];
  custo: CustoDoUso;
  /** O custo como todas as telas o mostram (`textoDoCusto`). */
  textoDoCusto: string;
}

/** Nota dos PRs de rodada com `soma` e `quantidade`, para o projeto somar sem tirar média de médias. */
interface Nota {
  soma: number;
  quantidade: number;
  media: number | null;
}

interface Escopo extends Contagens {
  nota: Nota;
  etapas: Partial<Record<string, Contagens>>;
}

interface MetricasDaDemanda {
  total: Escopo;
  rodadas: (Escopo & { rodadaId: number; conformidade: Conformidade | null; custoExterno: CustoExterno })[];
  semRodada: Escopo;
  /** Custo das sessões externas de `custos_realizados` (e quantas são), fora do interno. */
  custoExterno: CustoExterno;
}

/** A linha de `uso_modelo_execucao` como Uso; o banco não guarda as chamadas do uso medido, por isso 0. */
export const linhaDeUsoDoBanco = (u: Omit<UsoDaExecucao, keyof DonoDaLinha>): LinhaDeUso => ({
  modelo: `${u.provedor}/${u.modelo}`,
  tokens_entrada: u.entrada,
  tokens_saida: u.saida,
  tokens_cache_leitura: u.cacheLeitura,
  tokens_cache_escrita: u.cacheEscrita,
  custo: u.custo,
  chamadas: 0,
});

// Cada sessão externa é um Trabalho; só o custo é declarado, por isso os tokens vão em 0.
const custoExterno = (linhas: { ferramenta: string; sessao: string; custo: number | null }[]): CustoExterno => {
  const porSessao = Map.groupBy(linhas, (l) => `${l.ferramenta}\0${l.sessao}`);
  const uso = [...porSessao.values()]
    .map((sessao) =>
      Uso.de(
        sessao.map(({ custo }) => ({
          modelo: "externo",
          tokens_entrada: 0,
          tokens_saida: 0,
          tokens_cache_leitura: 0,
          tokens_cache_escrita: 0,
          custo,
          chamadas: 0,
        })),
        1,
      ),
    )
    .reduce((soma, sessao) => soma.somar(sessao), Uso.vazio());
  return { ...uso.custo(), sessoes: porSessao.size };
};

export function metricasDaDemanda(banco: DatabaseSync, demandaId: string): MetricasDaDemanda {
  if (!demandaExiste(banco, demandaId))
    throw new ErroDeInexistente(`a demanda ${demandaId} não existe`, "confira o id da demanda");
  const uso = usoDaDemanda(banco, demandaId);
  const execucoes = execucoesDaDemanda(banco, demandaId);
  const tickets = ticketsDaDemanda(banco, demandaId);
  const decisoes = decisoesDaDemanda(banco, demandaId);
  const externas = linhasExternasDaDemanda(banco, demandaId);

  const contagens = (dono: (l: DonoDaLinha) => boolean): Contagens => {
    // O banco não liga o uso à execução: o recorte todo conta como um Trabalho para o custo desconhecido.
    const u = Uso.de(uso.filter(dono).map(linhaDeUsoDoBanco), 1);
    return {
      execucoes: execucoes.filter(dono).length,
      falhas: execucoes.filter((e) => dono(e) && e.falha).length,
      exigenciasDeAlteracao: tickets.filter(dono).reduce((s, t) => s + t.exigenciasDeAlteracao, 0),
      reprovacoes: decisoes.filter((d) => dono(d) && d.reprovada).length,
      modelos: u.porModelo(),
      custo: u.custo(),
      textoDoCusto: textoDoCusto(u),
    };
  };
  const escopo = (dono: (l: DonoDaLinha) => boolean): Escopo => {
    const notas = decisoes.flatMap((d) =>
      dono(d) && d.etapa === "encerrar_rodada" && !d.reprovada && d.nota !== null ? [d.nota] : [],
    );
    const soma = notas.reduce((s, n) => s + n, 0);
    return {
      ...contagens(dono),
      nota: { soma, quantidade: notas.length, media: notas.length === 0 ? null : soma / notas.length },
      etapas: Object.fromEntries(
        [...new Set(tickets.filter(dono).map((t) => t.etapa))].map((etapa) => [
          etapa,
          contagens((l) => dono(l) && l.etapa === etapa),
        ]),
      ),
    };
  };

  return {
    total: escopo(() => true),
    rodadas: rodadasDaDemanda(banco, demandaId).map((rodadaId) => ({
      rodadaId,
      ...escopo((l) => l.rodadaId === rodadaId),
      conformidade: conformidadeDaRodada(banco, demandaId, rodadaId),
      custoExterno: custoExterno(externas.filter((l) => l.rodadaId === rodadaId)),
    })),
    semRodada: escopo((l) => l.rodadaId === null),
    custoExterno: custoExterno(externas),
  };
}
