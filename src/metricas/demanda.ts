// Métricas da demanda e das rodadas: tokens, custo, etapas e nota (comparacao-sdlc-implementacao.md §8).
import type { DatabaseSync } from "node:sqlite";
import { ErroDeInexistente } from "../dominio/erros.ts";
import {
  custosExternosDaDemanda,
  decisoesDaDemanda,
  demandaExiste,
  type DonoDaLinha,
  execucoesDaDemanda,
  rodadasDaDemanda,
  ticketsDaDemanda,
  type UsoDaExecucao,
  usoDaDemanda,
} from "../persistencia/metricas_demanda.ts";
import { type Conformidade, conformidadeDaRodada } from "./conformidade.ts";

/** Custo ausente não é zero: `incompleto` avisa que `conhecido` soma só o que foi informado. */
export interface Custo {
  conhecido: number;
  incompleto: boolean;
}

export interface UsoDoModelo {
  provedor: string;
  modelo: string;
  entrada: number;
  saida: number;
  cacheLeitura: number;
  cacheEscrita: number;
  /** `null` = desconhecido (alguma execução do modelo sem custo), nunca 0. */
  custo: number | null;
}

export interface Contagens {
  execucoes: number;
  falhas: number;
  devolucoes: number;
  reprovacoes: number;
  modelos: UsoDoModelo[];
  custo: Custo;
}

/** Nota dos PRs de rodada com `soma` e `quantidade`, para o projeto somar sem tirar média de médias. */
export interface Nota {
  soma: number;
  quantidade: number;
  media: number | null;
}

export interface Escopo extends Contagens {
  nota: Nota;
  etapas: Partial<Record<string, Contagens>>;
}

export interface MetricasDaDemanda {
  total: Escopo;
  rodadas: (Escopo & { rodadaId: number; conformidade: Conformidade | null })[];
  semRodada: Escopo;
  /** Custo das sessões externas de `custos_realizados`, fora do interno. */
  custoExterno: Custo;
}

export const somarCustos = (custos: (number | null)[]): Custo => ({
  conhecido: custos.reduce<number>((s, c) => s + (c ?? 0), 0),
  incompleto: custos.includes(null),
});

function agruparModelos(uso: UsoDaExecucao[]): UsoDoModelo[] {
  const porModelo = new Map<string, UsoDoModelo>();
  for (const { provedor, modelo, entrada, saida, cacheLeitura, cacheEscrita, custo } of uso) {
    const m = porModelo.get(`${provedor}\0${modelo}`);
    if (!m) {
      porModelo.set(`${provedor}\0${modelo}`, { provedor, modelo, entrada, saida, cacheLeitura, cacheEscrita, custo });
      continue;
    }
    m.entrada += entrada;
    m.saida += saida;
    m.cacheLeitura += cacheLeitura;
    m.cacheEscrita += cacheEscrita;
    m.custo = m.custo === null || custo === null ? null : m.custo + custo;
  }
  return [...porModelo.values()];
}

export function metricasDaDemanda(banco: DatabaseSync, demandaId: string): MetricasDaDemanda {
  if (!demandaExiste(banco, demandaId))
    throw new ErroDeInexistente(`a demanda ${demandaId} não existe`, "confira o id da demanda");
  const uso = usoDaDemanda(banco, demandaId);
  const execucoes = execucoesDaDemanda(banco, demandaId);
  const tickets = ticketsDaDemanda(banco, demandaId);
  const decisoes = decisoesDaDemanda(banco, demandaId);

  const contagens = (dono: (l: DonoDaLinha) => boolean): Contagens => {
    const u = uso.filter(dono);
    return {
      execucoes: execucoes.filter(dono).length,
      falhas: execucoes.filter((e) => dono(e) && e.falha).length,
      devolucoes: tickets.filter(dono).reduce((s, t) => s + t.devolucoes, 0),
      reprovacoes: decisoes.filter((d) => dono(d) && d.recusada).length,
      modelos: agruparModelos(u),
      custo: somarCustos(u.map((x) => x.custo)),
    };
  };
  const escopo = (dono: (l: DonoDaLinha) => boolean): Escopo => {
    const notas = decisoes.flatMap((d) =>
      dono(d) && d.etapa === "encerrar_rodada" && !d.recusada && d.nota !== null ? [d.nota] : [],
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
    })),
    semRodada: escopo((l) => l.rodadaId === null),
    custoExterno: somarCustos(custosExternosDaDemanda(banco, demandaId)),
  };
}
