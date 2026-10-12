// O serviço de longa duração (F4 §2, §4, §7): a porta como trava de instância única, o reinício que encerra as
// execuções de uma instância anterior, o agendador e o "Executar agora".
import { createServer } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import { FABRIQUINHA } from "../dominio/agregado.ts";
import { ErroDeRegra } from "../dominio/erros.ts";
import { falharTicket, terminarExecucao } from "../dominio/execucao.ts";
import type { Id } from "../dominio/primitivos.ts";
import { abrir } from "../persistencia/banco.ts";
import { comIssue } from "../persistencia/issues.ts";
import {
  autonomaEmAndamento,
  configuracao,
  execucoesEmAndamento,
  ticketElegivel,
  ticketsAutonomosEmExecucao,
} from "../persistencia/servico.ts";
import { sinalNoGrupo } from "../processo.ts";
import { executarAutonomo } from "./autonoma.ts";

const REINICIADO = "serviço reiniciado";

export interface Servico {
  banco: DatabaseSync;
  /** F4 §4: inicia o ticket autônomo já, sem esperar o agendador; recusa com a execução que ocupa o D8. */
  executarAgora(ticket: Id): Promise<void>;
  parar(): Promise<void>;
}

/** A porta do serviço e trava de instância única: `$FABRIQUINHA_PORTA`, padrão 4317 (F4 §10). */
export const portaDoServico = (env: NodeJS.ProcessEnv = process.env): number => Number(env.FABRIQUINHA_PORTA || 4317);

/** O log do serviço é o stderr, que o systemd guarda (F4 §2). */
const noLog = (erro: unknown): void => {
  console.error(`${new Date().toISOString()} fabriquinha:`, erro);
};

/**
 * F4 §7: toda execução em andamento é de uma instância anterior. Mata o grupo do pi, grava C6 com falha e leva a C8 cada
 * ticket autônomo que ficou `em_execucao`: o da execução encerrada agora e também o de quem caiu entre o C6 e a
 * coleta depois do pi (F4 §6.2, passo 6), que já não tem execução em andamento. O interativo continua `em_execucao`.
 */
function recuperar(banco: DatabaseSync): void {
  for (const e of execucoesEmAndamento(banco)) {
    if (e.pgid !== null) sinalNoGrupo(e.pgid, "SIGKILL");
    // ponytail: coletarUso (F6 §3.3) entra depois deste C6 com o ticket 17.
    comIssue(banco, e.issue, "terminarExecucao", FABRIQUINHA, (ag, ctx) =>
      terminarExecucao(ag, { execucao: e.id, resultado: "falha", erro: REINICIADO }, FABRIQUINHA, ctx),
    );
  }
  for (const t of ticketsAutonomosEmExecucao(banco)) {
    comIssue(banco, t.issue, "falharTicket", FABRIQUINHA, (ag) =>
      falharTicket(ag, { ticket: t.id, erro: REINICIADO }, FABRIQUINHA),
    );
  }
}

/**
 * Sobe o serviço: ocupa `127.0.0.1:<portaDoServico>` como trava de instância única antes de tocar no banco (uma
 * segunda instância, mesmo de versão mais nova, sai com erro sem migrar nada), abre o banco, encerra as execuções da
 * instância anterior e liga o agendador. `pacote` é a raiz do pacote P1 `pi-fabriquinha` (F4 §6.1).
 */
export async function iniciarServico(raiz: string, pacote: string): Promise<Servico> {
  const porta = portaDoServico();
  // ponytail: a porta só trava a instância; as rotas e o token do web entram com o F7 (ticket 24).
  const web = createServer((_, resposta) => resposta.writeHead(404).end());
  await new Promise<void>((pronto, falhou) => {
    web.once("error", (erro) => {
      falhou(
        new ErroDeRegra(
          `a Fabriquinha não conseguiu abrir 127.0.0.1:${String(porta)}: ${erro.message}`,
          "se outra Fabriquinha já está rodando, use-a; senão, libere a porta ou troque FABRIQUINHA_PORTA",
        ),
      );
    });
    web.listen(porta, "127.0.0.1", pronto);
  });
  let aberto: DatabaseSync | undefined;
  try {
    aberto = abrir(raiz);
    recuperar(aberto);
  } catch (error_) {
    aberto?.close();
    web.close();
    throw error_;
  }
  const banco = aberto;

  /**
   * C5 e, se ele aceitou, o resto da execução em segundo plano. C5 roda antes do primeiro `await` de
   * `executarAutonomo`: se recusou, a promessa já nasce rejeitada e ganha a corrida contra a promessa já resolvida;
   * se aceitou, ela está pendente e a corrida resolve na hora. Depois do C5, a promessa só rejeita se o banco falhar.
   */
  async function iniciar(ticket: Id): Promise<void> {
    const execucao = executarAutonomo(banco, ticket, { pacote, timeoutMin: configuracao(banco).timeoutMin });
    await Promise.race([execucao, Promise.resolve()]);
    execucao.catch(noLog);
  }

  // ponytail: o relógio bate de minuto em minuto e cada batida relê a configuração; uma mudança vale em até um minuto.
  let minutos = 0;

  /**
   * F4 §4, passos 2 a 4, numa batida do relógio. Síncrono até o C5 (que roda antes do primeiro `await` de
   * `executarAutonomo`), então duas batidas nunca se cruzam; o resto da execução segue em segundo plano. Nunca lança:
   * qualquer erro, inclusive a recusa do C5, vai para o log, e a batida seguinte roda.
   * ponytail: o passo 1, `varrerBase` diário (F6 §4.4), entra com o ticket 18.
   */
  function ciclo(): void {
    try {
      const c = configuracao(banco);
      // Desligado, o contador continua: ligado depois do intervalo, o primeiro ciclo vem na batida seguinte.
      if (++minutos < c.intervaloMin || !c.agendadorAtivo) return;
      minutos = 0;
      if (autonomaEmAndamento(banco)) return;
      const ticket = ticketElegivel(banco);
      if (ticket !== undefined) {
        executarAutonomo(banco, ticket, { pacote, timeoutMin: c.timeoutMin }).catch(noLog);
      }
    } catch (error_) {
      noLog(error_);
    }
  }
  const relogio = setInterval(ciclo, 60_000);

  return {
    banco,
    async executarAgora(ticket) {
      const ocupada = autonomaEmAndamento(banco);
      if (ocupada) {
        throw new ErroDeRegra(
          `já há uma execução autônoma em andamento (D8): E-${String(ocupada.execucao)} de T-${String(ocupada.ticket)}`,
          "espere ela terminar",
        );
      }
      await iniciar(ticket);
    },
    async parar() {
      clearInterval(relogio);
      await new Promise((fechou) => web.close(fechou));
      banco.close();
    },
  };
}
