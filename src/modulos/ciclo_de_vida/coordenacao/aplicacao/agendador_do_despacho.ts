// O agendador do Despacho (F4 §4, passos 2 a 4): a batida do relógio de minuto em minuto, que relê a configuração do
// serviço e, a cada `intervaloMin` batidas com o agendador ligado, roda um ciclo do Despacho; a etapa despachada que
// termina antecipa a busca seguinte para a próxima batida. Só a montagem do serviço liga a batida, e o `parar` a desliga;
// sem ela, a próxima busca conta da montagem.
import type { DatabaseSync } from "node:sqlite";
import type { Instante } from "../../../../shared/nucleo/primitivos.ts";
import { instanteDepois, type Relogio } from "../../../../shared/nucleo/relogio.ts";
import { configuracao } from "../../despacho/publico.ts";

/** O ciclo do Despacho que a batida roda: devolve as etapas em segundo plano, que nunca rejeitam. */
type CicloDoAgendador = () => Promise<void>[];

interface AgendadorDoDespacho {
  /** Quando o agendador procura trabalho de novo, se estiver ligado (F7 §4.4, Configuração). */
  proximaBusca(): Instante;
  parar(): void;
}

/**
 * Liga a batida. Nunca lança: qualquer erro do ciclo vai a `registrarErro`, e a batida seguinte roda.
 * ponytail: o relógio bate de minuto em minuto e cada batida relê a configuração; uma mudança vale em até um minuto.
 */
export function ligarAgendadorDoDespacho(
  banco: DatabaseSync,
  rodarCiclo: CicloDoAgendador,
  relogio: Relogio,
  registrarErro: (erro: unknown) => void,
  comBatida: boolean,
): AgendadorDoDespacho {
  let minutos = 0;
  /** A última batida do relógio (ou a subida): a próxima busca conta a partir dela. */
  let batida = relogio.agora();
  /**
   * Uma etapa despachada terminou depois do último ciclo: o trabalho que ela liberou (a revisão depois da
   * implementação, o encerramento depois da revisão...) é buscado na batida seguinte, sem esperar o intervalo inteiro.
   * ponytail: no máximo um ciclo por batida, o mesmo ritmo do intervaloMin 1; disparar no próprio fim da etapa se o
   * minuto de espera pesar.
   */
  let etapaTerminou = false;
  function baterORelogio(): void {
    batida = relogio.agora();
    try {
      const c = configuracao(banco);
      // Desligado, o contador continua: ligado depois do intervalo, o primeiro ciclo vem na batida seguinte.
      if ((++minutos < c.intervaloMin && !etapaTerminou) || !c.agendadorAtivo) return;
      minutos = 0;
      etapaTerminou = false;
      for (const fim of rodarCiclo())
        void fim.then(() => {
          etapaTerminou = true;
        });
    } catch (erro) {
      registrarErro(erro);
    }
  }
  const intervaloDaBatida = comBatida ? setInterval(baterORelogio, 60_000) : undefined;
  return {
    // A batida em que `minutos` chega ao intervalo; desligado além dele, o ciclo roda na batida seguinte.
    proximaBusca: () =>
      instanteDepois(batida, Math.max(1, etapaTerminou ? 1 : configuracao(banco).intervaloMin - minutos) * 60_000),
    parar: () => {
      clearInterval(intervaloDaBatida);
    },
  };
}
