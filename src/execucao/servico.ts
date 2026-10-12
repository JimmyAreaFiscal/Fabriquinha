// O serviço de longa duração (F4 §2, §4, §7): a porta como trava de instância única e o web (F7 §4), o reinício que
// encerra as execuções de uma instância anterior, o agendador e o "Executar agora".
import { rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { FABRIQUINHA } from "../dominio/agregado.ts";
import { ErroDeRegra } from "../dominio/erros.ts";
import { falharTicket, terminarExecucao } from "../dominio/execucao.ts";
import type { Id } from "../dominio/primitivos.ts";
import { varrerBase } from "../metricas/retrabalho.ts";
import { depoisDoC6 } from "../metricas/uso.ts";
import { abrir } from "../persistencia/banco.ts";
import { noLog } from "../persistencia/execucoes.ts";
import { comIssue } from "../persistencia/issues.ts";
import { projetosAVarrer } from "../persistencia/retrabalho.ts";
import {
  autonomaEmAndamento,
  configuracao,
  execucoesEmAndamento,
  ocupacaoDoD8,
  ticketElegivel,
  ticketsAutonomosEmExecucao,
} from "../persistencia/servico.ts";
import { sinalNoGrupo } from "../processo.ts";
import { servirWeb } from "../web/servidor.ts";
import { executarAutonomo } from "./autonoma.ts";

const REINICIADO = "serviço reiniciado";

export interface Servico {
  banco: DatabaseSync;
  /** F4 §4: inicia o ticket autônomo já, sem esperar o agendador; recusa com a execução que ocupa o D8. */
  executarAgora(ticket: Id): Promise<void>;
  /** Quando o agendador procura trabalho de novo, se estiver ligado (F7 §4.4, Configuração). */
  proximaBusca(): Date;
  parar(): Promise<void>;
}

/** A porta do serviço e trava de instância única: `$FABRIQUINHA_PORTA`, padrão 4317 (F4 §10). */
export const portaDoServico = (env: NodeJS.ProcessEnv = process.env): number => Number(env.FABRIQUINHA_PORTA || 4317);

/**
 * F4 §7: toda execução em andamento é de uma instância anterior. Mata o grupo do pi, grava C6 com falha e leva a C8 cada
 * ticket autônomo que ficou `em_execucao`: o da execução encerrada agora e também o de quem caiu entre o C6 e a
 * coleta depois do pi (F4 §6.2, passo 6), que já não tem execução em andamento. O interativo continua `em_execucao`.
 */
function recuperar(banco: DatabaseSync): void {
  for (const e of execucoesEmAndamento(banco)) {
    if (e.pgid !== null) sinalNoGrupo(e.pgid, "SIGKILL");
    comIssue(banco, e.issue, "terminarExecucao", FABRIQUINHA, (ag, ctx) =>
      terminarExecucao(ag, { execucao: e.id, resultado: "falha", erro: REINICIADO }, FABRIQUINHA, ctx),
    );
    depoisDoC6(banco, e.id);
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
 * instância anterior e liga o agendador. A porta 0 escolhe uma livre, sem a trava, e o `web.url` leva a escolhida: os
 * testes sobem várias instâncias juntas sem disputar porta.
 */
export async function iniciarServico(raiz: string): Promise<Servico> {
  const pedida = portaDoServico();
  // ponytail: o relógio bate de minuto em minuto e cada batida relê a configuração; uma mudança vale em até um minuto.
  let minutos = 0;
  /** A última batida do relógio (ou a subida): a próxima busca conta a partir dela. */
  let batida = Date.now();
  /** A batida em que `minutos` chega ao intervalo; desligado além dele, o ciclo roda na batida seguinte. */
  const proximaBusca = (): Date => new Date(batida + Math.max(1, configuracao(banco).intervaloMin - minutos) * 60_000);
  // O tratador do web (F7 §4.1) entra depois do banco aberto; antes disso, ninguém tem o link de entrada.
  const web = createServer();
  await new Promise<void>((pronto, falhou) => {
    web.once("error", (erro) => {
      falhou(
        new ErroDeRegra(
          `a Fabriquinha não conseguiu abrir 127.0.0.1:${String(pedida)}: ${erro.message}`,
          "se outra Fabriquinha já está rodando, use-a; senão, libere a porta ou troque FABRIQUINHA_PORTA",
        ),
      );
    });
    web.listen(pedida, "127.0.0.1", pronto);
  });
  const { port: porta } = web.address() as AddressInfo;
  let aberto: DatabaseSync | undefined;
  try {
    aberto = abrir(raiz);
    recuperar(aberto);
    web.on("request", servirWeb({ banco: aberto, porta, agendador: { proximaBusca, executarAgora } }));
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
    const execucao = executarAutonomo(banco, ticket, { timeoutMin: configuracao(banco).timeoutMin });
    await Promise.race([execucao, Promise.resolve()]);
    execucao.catch(noLog);
  }

  /** A varredura do passo 1 em andamento: no máximo uma, e o `parar` a espera antes de fechar o banco. */
  let varredura: Promise<void> | undefined;

  /**
   * F4 §4, passo 1: `varrerBase` em cada projeto sem varredura há 24 horas, um por vez; a falha de um só vai para o log.
   * ponytail: o projeto cuja varredura falha (remoto fora do ar) é tentado de novo a cada ciclo, com uma linha de log
   * em cada; guardar a última tentativa se o log incomodar.
   */
  async function varrerVencidos(): Promise<void> {
    for (const projeto of projetosAVarrer(banco)) await varrerBase(banco, projeto).catch(noLog);
  }

  /**
   * F4 §4, passos 1 a 4, numa batida do relógio. Síncrono até o C5 (que roda antes do primeiro `await` de
   * `executarAutonomo`), então duas batidas nunca se cruzam; o resto da execução segue em segundo plano. Nunca lança:
   * qualquer erro, inclusive a recusa do C5, vai para o log, e a batida seguinte roda. O passo 1 roda em segundo plano:
   * a batida nunca espera o git, e uma varredura só começa quando a anterior terminou.
   */
  function ciclo(): void {
    batida = Date.now();
    try {
      const c = configuracao(banco);
      // Desligado, o contador continua: ligado depois do intervalo, o primeiro ciclo vem na batida seguinte.
      if (++minutos < c.intervaloMin || !c.agendadorAtivo) return;
      minutos = 0;
      varredura ??= varrerVencidos()
        .catch(noLog)
        .finally(() => {
          varredura = undefined;
        });
      if (autonomaEmAndamento(banco)) return;
      const ticket = ticketElegivel(banco);
      if (ticket !== undefined) {
        executarAutonomo(banco, ticket, { timeoutMin: c.timeoutMin }).catch(noLog);
      }
    } catch (error_) {
      noLog(error_);
    }
  }
  const relogio = setInterval(ciclo, 60_000);

  // Declarada como função para o web, ligado antes do `banco` existir, recebê-la; só é chamada depois.
  async function executarAgora(ticket: Id): Promise<void> {
    const ocupada = ocupacaoDoD8(banco);
    if (ocupada) throw new ErroDeRegra(ocupada, "espere ela terminar");
    await iniciar(ticket);
  }

  return {
    banco,
    executarAgora,
    proximaBusca,
    async parar() {
      clearInterval(relogio);
      const fechou = new Promise((pronto) => web.close(pronto));
      // O close só espera: as conexões abertas (um SSE nunca termina) são cortadas aqui.
      web.closeAllConnections();
      await fechou;
      // F7 §3.2: sem o link de entrada, o `abrir` diz que o serviço não está rodando em vez de abrir um link morto.
      rmSync(join(raiz, "web.url"), { force: true });
      await varredura;
      banco.close();
    },
  };
}
