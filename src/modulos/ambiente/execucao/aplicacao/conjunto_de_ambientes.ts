// O conjunto de Ambientes em container como quem roda comandos o vê: cada alocação do conjunto de sandboxes vira o
// `AmbienteContainer` que executa, lança e sinaliza no container alocado. Alocar, liberar e eliminar são dos Sandboxes.
import type { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import type { Instante } from "../../../../shared/nucleo/primitivos.ts";
import { type Relogio, relogioDoSistema } from "../../../../shared/nucleo/relogio.ts";
import {
  type AmbienteGravado,
  ConjuntoDeSandboxes,
  type GeradorDeAmbientes,
  type OcupanteDoAmbiente,
  type ProjetoDoAmbiente,
  type ServicoDoConjunto,
} from "../../sandboxes/publico.ts";
import { AmbienteContainer } from "../infra/container/ambiente_container.ts";

export class ConjuntoDeAmbientes {
  readonly #sandboxes: ConjuntoDeSandboxes;

  /** Sem `servico` o conjunto só elimina containers (a tela de Configuração com `host_local`); `alocar` exige. */
  constructor(
    banco: DatabaseSync,
    gerador: GeradorDeAmbientes,
    relogio: Relogio = relogioDoSistema,
    servico?: ServicoDoConjunto,
  ) {
    this.#sandboxes = new ConjuntoDeSandboxes(banco, gerador, relogio, servico);
  }

  /** O Ambiente do container que o ocupante já tem alocado, ou `undefined`. */
  ambienteAlocadoPara(ocupante: Pick<OcupanteDoAmbiente, "dono">): AmbienteContainer | undefined {
    const alocado = this.#sandboxes.alocacaoDe(ocupante);
    return alocado && this.#comoAmbienteContainer(alocado);
  }

  /** O Ambiente do container `id` do conjunto (alocado ou não), ou `undefined` se ele não está no banco: a recuperação da subida sinaliza por ele. */
  ambientePorId(id: string): AmbienteContainer | undefined {
    const gravado = this.#sandboxes.sandboxPorId(id);
    return gravado && this.#comoAmbienteContainer(gravado);
  }

  /** Aloca um container ao ocupante, que sai levando o `.env` do clone do projeto para os próximos comandos. */
  async alocar(ocupante: OcupanteDoAmbiente, projeto: ProjetoDoAmbiente): Promise<AmbienteContainer> {
    const container = this.#comoAmbienteContainer(await this.#sandboxes.alocar(ocupante, projeto));
    container.levarEnvDoProjeto(projeto.raiz_git);
    return container;
  }

  liberar(ocupante: Pick<OcupanteDoAmbiente, "dono">): Promise<void> {
    return this.#sandboxes.liberar(ocupante);
  }

  eliminar(id: string): Promise<void> {
    return this.#sandboxes.eliminar(id);
  }

  eliminarOciosos(agora: Instante): Promise<void> {
    return this.#sandboxes.eliminarOciosos(agora);
  }

  reconciliarNaSubida(): Promise<void> {
    return this.#sandboxes.reconciliarNaSubida();
  }

  #comoAmbienteContainer({ id, container_id }: Pick<AmbienteGravado, "id" | "container_id">): AmbienteContainer {
    const { raiz, porta_da_api, pacote_do_harness } = this.#sandboxes.servicoObrigatorio();
    return new AmbienteContainer({
      id,
      container_id,
      bin_do_pacote: join(pacote_do_harness, "bin"),
      raiz,
      url_da_api: `http://host.docker.internal:${String(porta_da_api)}`,
    });
  }
}
