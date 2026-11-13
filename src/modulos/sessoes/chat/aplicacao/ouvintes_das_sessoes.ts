// Quem assina cada sessão: o chat recebe os eventos do agente e o aviso de que o estado dela pode ter mudado. O erro de
// um ouvinte vai ao log da execução, nunca ao processo do agente.
import { mensagem } from "../../../../shared/nucleo/erros.ts";
import { anotar } from "../../../../shared/infra/registro.ts";
import type { EventoDaSessao } from "../nucleo/eventos_da_sessao.ts";

export class OuvintesDasSessoes {
  private readonly ouvintesPorSessao = new Map<string, Set<(evento: EventoDaSessao) => void>>();

  /** Registra o ouvinte e lhe entrega antes `eventosJaEmitidos`; devolve como cancelar a assinatura. */
  assinar(
    sessao: string,
    ouvinte: (evento: EventoDaSessao) => void,
    eventosJaEmitidos: readonly EventoDaSessao[],
  ): () => void {
    const ouvintes = this.ouvintesPorSessao.get(sessao) ?? new Set();
    this.ouvintesPorSessao.set(sessao, ouvintes.add(ouvinte));
    for (const evento of eventosJaEmitidos) ouvinte(evento);
    return () => {
      ouvintes.delete(ouvinte);
      if (ouvintes.size === 0) this.ouvintesPorSessao.delete(sessao);
    };
  }

  /** Entrega o evento a cada ouvinte da sessão; o erro de um ouvinte vai para o `log`. */
  repassar(sessao: string, evento: EventoDaSessao, log: string): void {
    for (const ouvinte of this.ouvintesPorSessao.get(sessao) ?? []) {
      try {
        ouvinte(evento);
      } catch (error_) {
        anotar(log, `um ouvinte da sessão falhou com o evento ${evento.type}: ${mensagem(error_)}`);
      }
    }
  }
}
