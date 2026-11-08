// O Ambiente que é o próprio host do serviço: embrulha `infra/processo.ts` e o spawn do pi.
import { spawn } from "node:child_process";
import { ErroDeRegra } from "../../nucleo/erros.ts";
import { executar, executarNoShell, sinalNoGrupo } from "../processo.ts";
import type {
  Ambiente,
  ComandoNoAmbiente,
  IdentificadorDoProcesso,
  ProcessoNoAmbiente,
  SaidaDoComando,
} from "./ambiente.ts";

const ID_DO_HOST_LOCAL = "host_local";

/** @testes o consumidor de produção é ligado pelo ticket seguinte */
export class AmbienteHostLocal implements Ambiente {
  readonly id = ID_DO_HOST_LOCAL;
  readonly tipo = "host_local";

  async executar(comando: ComandoNoAmbiente): Promise<SaidaDoComando> {
    const { programa, argumentos, cwd, env, limiteMs, ultimosBytes = Infinity } = comando;
    const inicio = performance.now();
    if (comando.noShell) {
      const r = await executarNoShell(programa, cwd, { env, limiteMs, limiteLog: ultimosBytes });
      return { codigo: r.codigo, saida: r.log, erro: "", limiteEstourado: r.estourou, duracaoMs: r.duracaoMs };
    }
    const r = await executar(programa, argumentos, { env, cwd, limiteMs, ultimos: ultimosBytes });
    return { ...r, duracaoMs: Math.round(performance.now() - inicio) };
  }

  lancar({ programa, argumentos, cwd, env }: ComandoNoAmbiente): ProcessoNoAmbiente {
    const filho = spawn(programa, argumentos, { cwd, env, detached: true, stdio: ["pipe", "pipe", "pipe"] });
    return {
      identificador: { ambiente_id: this.id, grupo_processo: Number(filho.pid) },
      stdin: filho.stdin,
      stdout: filho.stdout,
      stderr: filho.stderr,
      saiu: new Promise((resolve) => filho.on("close", resolve)),
      aoFalhar(ouvinte) {
        filho.on("error", ouvinte);
        filho.stdin.on("error", ouvinte);
      },
    };
  }

  sinalizar({ ambiente_id, grupo_processo }: IdentificadorDoProcesso, sinal: NodeJS.Signals): Promise<void> {
    if (ambiente_id !== this.id) {
      return Promise.reject(
        new ErroDeRegra(
          `o processo é do ambiente ${ambiente_id}, não do ${this.id}`,
          "sinalize pelo ambiente que lançou o processo",
        ),
      );
    }
    sinalNoGrupo(grupo_processo, sinal);
    return Promise.resolve();
  }

  caminhoNoAmbiente(caminhoNoHost: string): string {
    return caminhoNoHost;
  }
}
