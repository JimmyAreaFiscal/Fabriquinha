// Agregado das métricas de todas as demandas do projeto (comparacao-sdlc-implementacao.md §8).
import type { DatabaseSync } from "node:sqlite";
import { ErroDeInexistente } from "../dominio/erros.ts";
import { demandasDoProjeto, projetoExiste } from "../persistencia/metricas_demanda.ts";
import { type Contagens, type Custo, metricasDaDemanda, type Nota, type UsoDoModelo } from "./demanda.ts";

export interface MetricasDoProjeto extends Contagens {
  demandas: number;
  /** Soma e quantidade das notas de todas as demandas; a média nunca é média das médias. */
  nota: Nota;
  /** Cada sessão externa tem uma só dona (`sessao_externa_demanda`), então somar as demandas não conta duas vezes. */
  custoExterno: Custo & { sessoes: number };
}

const somar = (a: number[]) => a.reduce((s, n) => s + n, 0);

function juntarModelos(listas: UsoDoModelo[][]): UsoDoModelo[] {
  const porModelo = new Map<string, UsoDoModelo>();
  for (const m of listas.flat()) {
    const chave = `${m.provedor}\0${m.modelo}`;
    const atual = porModelo.get(chave);
    if (!atual) {
      porModelo.set(chave, { ...m });
      continue;
    }
    atual.entrada += m.entrada;
    atual.saida += m.saida;
    atual.cacheLeitura += m.cacheLeitura;
    atual.cacheEscrita += m.cacheEscrita;
    atual.custo = atual.custo === null || m.custo === null ? null : atual.custo + m.custo;
  }
  return [...porModelo.values()];
}

export function metricasDoProjeto(banco: DatabaseSync, projeto: string): MetricasDoProjeto {
  if (!projetoExiste(banco, projeto))
    throw new ErroDeInexistente(`o projeto ${projeto} não existe`, "confira o nome do projeto");
  const ms = demandasDoProjeto(banco, projeto).map((id) => metricasDaDemanda(banco, id));
  const totais = ms.map((m) => m.total);
  const soma = somar(totais.map((t) => t.nota.soma));
  const quantidade = somar(totais.map((t) => t.nota.quantidade));
  return {
    demandas: ms.length,
    execucoes: somar(totais.map((t) => t.execucoes)),
    falhas: somar(totais.map((t) => t.falhas)),
    devolucoes: somar(totais.map((t) => t.devolucoes)),
    reprovacoes: somar(totais.map((t) => t.reprovacoes)),
    modelos: juntarModelos(totais.map((t) => t.modelos)),
    custo: {
      conhecido: somar(totais.map((t) => t.custo.conhecido)),
      incompleto: totais.some((t) => t.custo.incompleto),
    },
    nota: { soma, quantidade, media: quantidade === 0 ? null : soma / quantidade },
    custoExterno: {
      conhecido: somar(ms.map((m) => m.custoExterno.conhecido)),
      incompleto: ms.some((m) => m.custoExterno.incompleto),
      sessoes: somar(ms.map((m) => m.custoExterno.sessoes)),
    },
  };
}
