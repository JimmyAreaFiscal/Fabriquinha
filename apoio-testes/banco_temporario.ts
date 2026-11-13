// Banco real e migrado numa raiz temporária própria, para o teste que precisa de um banco só seu.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "node:test";
import type { DatabaseSync } from "node:sqlite";
import { abrirBancoDaFabriquinha } from "../src/server/composicao/banco_da_fabriquinha.ts";

export interface BancoTemporario {
  raiz: string;
  banco: DatabaseSync;
  /** Fecha o banco (se ainda aberto) e apaga a raiz; pode ser chamada mais de uma vez. */
  fechar: () => void;
}

/**
 * A raiz temporária (`$FABRIQUINHA_ROOT` de mentira) com o banco aberto e migrado dentro dela. `raizExistente` é para o
 * teste cuja raiz já nasce em outro lugar (a de um repositório de teste): o banco é aberto nela, e `fechar` a apaga.
 */
export function abrirBancoTemporario(raizExistente?: string): BancoTemporario {
  const raiz = raizExistente ?? mkdtempSync(join(tmpdir(), "fabriquinha-teste-"));
  const banco = abrirBancoDaFabriquinha(raiz);
  let fechado = false;
  return {
    raiz,
    banco,
    fechar() {
      if (fechado) return;
      fechado = true;
      if (banco.isOpen) banco.close(); // o teste pode já ter fechado o banco para reabri-lo
      rmSync(raiz, { recursive: true, force: true });
    },
  };
}

/** Para o arquivo de teste que abre vários bancos: devolve a função que abre cada um e fecha todos quando o arquivo termina. */
export function fabricaDeBancosTemporarios(): (raizExistente?: string) => BancoTemporario {
  const abertos: BancoTemporario[] = [];
  after(() => {
    for (const aberto of abertos) aberto.fechar();
  });
  return (raizExistente) => {
    const novo = abrirBancoTemporario(raizExistente);
    abertos.push(novo);
    return novo;
  };
}
