// Banco real e migrado numa raiz temporária própria, para o teste que precisa de um banco só seu.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { abrir } from "../src/persistencia/banco.ts";

export interface BancoTemporario {
  raiz: string;
  banco: DatabaseSync;
  /** Fecha o banco e apaga a raiz; pode ser chamada mais de uma vez. */
  fechar: () => void;
}

/** A raiz temporária (`$FABRIQUINHA_ROOT` de mentira) com o banco aberto e migrado dentro dela. */
export function abrirBancoTemporario(): BancoTemporario {
  const raiz = mkdtempSync(join(tmpdir(), "fabriquinha-teste-"));
  const banco = abrir(raiz);
  let fechado = false;
  return {
    raiz,
    banco,
    fechar() {
      if (fechado) return;
      fechado = true;
      banco.close();
      rmSync(raiz, { recursive: true, force: true });
    },
  };
}
