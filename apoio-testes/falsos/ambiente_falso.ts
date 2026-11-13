// O apoio de teste do Ambiente: o Ambiente falso, que registra cada comando recebido e o repassa ao host local, para o
// git, o shell e o pi seguirem reais; a gestão de Ambientes que só usa um Ambiente, ligada aos módulos que a pedem; e os
// adapters e o SQL do inventário com que os testes de fora do módulo montam cenário. `espiarProcessosForaDoAmbiente`
// conta os processos lançados sem passar por um Ambiente.
import { AsyncLocalStorage } from "node:async_hooks";
import type { spawn } from "node:child_process";
import { createRequire, syncBuiltinESMExports } from "node:module";
import type { TestContext } from "node:test";
import {
  type Ambiente,
  type ComandoNoAmbiente,
  type GestaoDeAmbientes,
  type IdentificadorDoProcesso,
  type MontagemDaGestaoDeAmbientes,
  montarGestaoDeAmbientes,
  type ProcessoNoAmbiente,
  type SaidaDoComando,
} from "../../src/modulos/ambiente/publico.ts";
import { noLog } from "../../src/shared/infra/registro.ts";
import { AmbienteHostLocal } from "../../src/modulos/ambiente/execucao/infra/host_local/ambiente_host_local.ts";
import { condutor } from "../../src/modulos/ciclo_de_vida/publico.ts";
import { ligarGestaoDeAmbientes } from "../../src/modulos/repositorio/publico.ts";

export { AmbienteHostLocal };
export { AmbienteContainer } from "../../src/modulos/ambiente/execucao/infra/container/ambiente_container.ts";
export {
  inserirAmbienteAlocado,
  liberarAmbiente,
  listarAmbientes,
} from "../../src/modulos/ambiente/sandboxes/armazenamento/ambientes.ts";

/** A gestão que roda tudo em `ambiente`: aloca e devolve sempre ele, não tem conjunto e não limpa nem elimina nada. */
export const gestaoQueSoUsa = (ambiente: Ambiente): GestaoDeAmbientes => ({
  listar: () => Promise.resolve([]),
  alocar: () => Promise.resolve(ambiente),
  ambienteDo: () => ambiente,
  limpar: () => Promise.resolve(),
  deletar: () => Promise.resolve(),
  parar: () => Promise.resolve(),
});

/** A gestão dos testes, sem montagem: o host local, como a do serviço no `host_local`. */
const GESTAO_DOS_TESTES = gestaoQueSoUsa(new AmbienteHostLocal());

/**
 * Liga `gestao` aos módulos que pedem Ambiente (o Repositório e as Sessões do condutor), como a composição faz; sem ela,
 * a gestão dos testes. O harness dos testes liga a dos testes antes de cada arquivo.
 */
export function ligarGestaoDeAmbientesNosModulos(gestao: GestaoDeAmbientes = GESTAO_DOS_TESTES): void {
  ligarGestaoDeAmbientes(gestao);
  condutor.montarAmbientes(gestao);
}

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
  readonly processosMorremComOServico = this.hostLocal.processosMorremComOServico;
  readonly isolaAsVariaveisDoServico = this.hostLocal.isolaAsVariaveisDoServico;
  readonly escreveEmTodoOGitDoClone = this.hostLocal.escreveEmTodoOGitDoClone;

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

/**
 * Monta a gestão de Ambientes de verdade (com a conferência da subida, se a Configuração for `container`) e a liga aos
 * módulos até o fim do teste, que a para e volta à gestão dos testes.
 */
export async function ligarGestaoDeAmbientesDoTeste(
  t: TestContext,
  montagem: Omit<MontagemDaGestaoDeAmbientes, "registrarErro">,
): Promise<GestaoDeAmbientes> {
  const gestao = await montarGestaoDeAmbientes({ ...montagem, registrarErro: noLog });
  ligarGestaoDeAmbientesNosModulos(gestao);
  t.after(async () => {
    ligarGestaoDeAmbientesNosModulos();
    await gestao.parar();
  });
  return gestao;
}
