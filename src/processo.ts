// Roda um comando externo com `spawn` e argumentos em lista, sem shell: nenhum argumento vira comando.
import { spawn } from "node:child_process";
import { ErroDeRegra } from "./dominio/erros.ts";

export interface Saida {
  codigo: number | null;
  saida: string;
  erro: string;
}

/**
 * Espera o comando terminar e devolve o código de saída, o stdout e o stderr. Não lê stdin, para nunca esperar
 * resposta de quem não está ali. Só lança se o programa nem chega a rodar (ex.: não está instalado).
 */
export function executar(
  comando: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<Saida> {
  return new Promise((resolve, reject) => {
    const filho = spawn(comando, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let saida = "";
    let erro = "";
    filho.stdout.setEncoding("utf8").on("data", (parte: string) => (saida += parte));
    filho.stderr.setEncoding("utf8").on("data", (parte: string) => (erro += parte));
    filho.on("error", (falha) => {
      reject(
        new ErroDeRegra(`não foi possível rodar ${comando}: ${falha.message}`, `instale ${comando} ou confira o PATH`),
      );
    });
    filho.on("close", (codigo) => {
      resolve({ codigo, saida, erro });
    });
  });
}
