// Monta o que o CLI não pode abrir sozinho (o banco da raiz, o serviço, o navegador) e roda `principal` com isso.
import { join } from "node:path";
import { abrir as abrirBanco, raizPadrao } from "../compartilhado/armazenamento/banco.ts";
import { type DepsDoCli } from "../entrega/cli/comando.ts";
import { principal } from "../entrega/cli/cli.ts";
import { relogioDoSistema } from "../compartilhado/nucleo/relogio.ts";
import { PACOTE } from "../harness/pi/pi.ts";
import { condutor } from "../trabalho_agentico/aplicacao/trabalho/condutor.ts";
import { lancarSolto } from "../compartilhado/infra/processo.ts";
import { harnessDoServico, iniciarServico } from "./servico.ts";

/** O processo visto pelo CLI; o ponto de entrada passa o real, os testes passam o seu. */
type ProcessoDoCli = Pick<DepsDoCli, "env" | "stdin" | "stdout" | "stderr" | "parada" | "sair">;

/** O programa que abre uma URL no navegador padrão. */
/** @testes o teste confere o comando de cada plataforma */
export const comandoDoNavegador = (plataforma: NodeJS.Platform): string =>
  plataforma === "darwin" ? "open" : "xdg-open";

/** Roda `fabriquinha <args>` no `processo` e devolve o código de saída (F7 §3.3). */
export function executarFabriquinha(args: readonly string[], processo: ProcessoDoCli): Promise<number> {
  const raiz = raizPadrao(processo.env);
  condutor.montarHarness(harnessDoServico);
  return principal(args, {
    ...processo,
    raiz,
    relogio: relogioDoSistema,
    async comBanco(usar) {
      const banco = abrirBanco(raiz);
      try {
        return await usar(banco);
      } finally {
        banco.close();
      }
    },
    iniciarServico: () => iniciarServico(raiz, join(PACOTE, "bin")),
    abrirNoNavegador: (url) => lancarSolto(comandoDoNavegador(process.platform), [url], processo.env),
  });
}
