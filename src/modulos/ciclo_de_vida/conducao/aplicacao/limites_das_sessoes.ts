// Os limites das sessões dos agentes, que a Condução recebe como dado: o tempo de execução de um agente e a ociosidade da
// conversa com o Auditor. Eles moram na configuração do serviço, que é do Despacho, e o Despacho depende da Condução: o
// Despacho os passa a cada ticket que entrega, e a composição liga aqui a leitura deles para o que não passa pelo Despacho
// (o Gate do PR, que abre a sessão de ajustes, e a mensagem do Auditor pelo chat).
import type { DatabaseSync } from "node:sqlite";
import { encontrado } from "../../../../shared/nucleo/erros.ts";

/** A leitura dos limites que a composição liga, em minutos. */
interface LeituraDosLimitesDasSessoes {
  /** Quanto um agente pode rodar. */
  timeoutMin(banco: DatabaseSync): number;
  /** Quanto a conversa com o Auditor pode ficar ociosa. */
  ociosidadeMin(banco: DatabaseSync): number;
}

let leituraLigada: LeituraDosLimitesDasSessoes | undefined;

/** A composição liga a leitura dos limites da configuração do serviço, uma vez, antes de qualquer condução. */
export const ligarLeituraDosLimitesDasSessoes = (leitura: LeituraDosLimitesDasSessoes): void => {
  leituraLigada = leitura;
};

export const limitesDasSessoes = (): LeituraDosLimitesDasSessoes =>
  encontrado(
    leituraLigada,
    "a leitura dos limites das sessões não foi ligada ao Ciclo de Vida",
    "abra o banco por abrirBancoDaFabriquinha, que liga a configuração do serviço",
  );
