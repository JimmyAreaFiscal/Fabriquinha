// O Ambiente falso dos testes: registra cada comando recebido e o repassa ao host local, para o git, o shell e o pi
// seguirem reais. `espiarProcessosForaDoAmbiente` conta os processos lançados sem passar por um Ambiente.
import { AsyncLocalStorage } from "node:async_hooks";
import type { spawn } from "node:child_process";
import { createRequire, syncBuiltinESMExports } from "node:module";
import type {
  Ambiente,
  ComandoNoAmbiente,
  IdentificadorDoProcesso,
  ProcessoNoAmbiente,
  SaidaDoComando,
} from "../src/infra/ambiente/ambiente.ts";
import { AmbienteHostLocal } from "../src/infra/ambiente/ambiente_host_local.ts";

export interface ComandoRegistrado {
  via: "executar" | "lancar";
  comando: ComandoNoAmbiente;
}

/** Marca o que roda dentro de um Ambiente, para o espião não o contar como chamada direta. */
const dentroDeUmAmbiente = new AsyncLocalStorage<true>();

export class AmbienteFalso implements Ambiente {
  readonly registro: ComandoRegistrado[] = [];
  private readonly hostLocal = new AmbienteHostLocal();
  readonly id = this.hostLocal.id;
  readonly tipo = this.hostLocal.tipo;

  executar(comando: ComandoNoAmbiente): Promise<SaidaDoComando> {
    this.registro.push({ via: "executar", comando });
    return dentroDeUmAmbiente.run(true, () => this.hostLocal.executar(comando));
  }

  lancar(comando: ComandoNoAmbiente): ProcessoNoAmbiente {
    this.registro.push({ via: "lancar", comando });
    return dentroDeUmAmbiente.run(true, () => this.hostLocal.lancar(comando));
  }

  sinalizar(identificador: IdentificadorDoProcesso, sinal: NodeJS.Signals): Promise<void> {
    return this.hostLocal.sinalizar(identificador, sinal);
  }

  caminhoNoAmbiente(caminhoNoHost: string): string {
    return this.hostLocal.caminhoNoAmbiente(caminhoNoHost);
  }

  abrigarProcesso(): void {
    this.hostLocal.abrigarProcesso();
  }
}

export interface ProcessoForaDoAmbiente {
  programa: string;
  argumentos: readonly string[];
  cwd: string | undefined;
}

/**
 * Passa a registrar cada `spawn` que não vem de um `AmbienteFalso`: é o que `infra/processo.ts` faz quando um chamador
 * o usa direto. `parar` devolve o `spawn` original.
 */
export function espiarProcessosForaDoAmbiente(): { chamadas: ProcessoForaDoAmbiente[]; parar(): void } {
  const moduloChildProcess = createRequire(import.meta.url)("node:child_process") as { spawn: typeof spawn };
  const spawnOriginal = moduloChildProcess.spawn;
  const chamadas: ProcessoForaDoAmbiente[] = [];
  moduloChildProcess.spawn = ((programa: string, argumentos: readonly string[], opcoes?: { cwd?: string }) => {
    if (!dentroDeUmAmbiente.getStore()) chamadas.push({ programa, argumentos, cwd: opcoes?.cwd });
    return (spawnOriginal as (...entrada: unknown[]) => unknown)(programa, argumentos, opcoes);
  }) as typeof spawn;
  // Os imports nomeados de `node:child_process` (`import { spawn }`) só enxergam a troca depois disto.
  syncBuiltinESMExports();
  return {
    chamadas,
    parar() {
      moduloChildProcess.spawn = spawnOriginal;
      syncBuiltinESMExports();
    },
  };
}
