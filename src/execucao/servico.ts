// O serviço de longa duração (F4 §2, §4, §7): a porta como trava de instância única e o web (F7 §4), o reinício que
// encerra as execuções de uma instância anterior, o agendador e o "Executar agora" da demanda.
import { rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { ErroDeRegra } from "../dominio/erros.ts";
import { varrerBase } from "../metricas/retrabalho.ts";
import { abrir, raizDo } from "../persistencia/banco.ts";
import { noLog } from "../persistencia/execucoes.ts";
import { projetosAVarrer } from "../persistencia/retrabalho.ts";
import { configuracao } from "../persistencia/servico.ts";
import { falharPendentes } from "../persistencia/simulacao.ts";
import { sinalNoGrupo } from "../processo.ts";
import { servirWeb } from "../web/servidor.ts";
import { recuperarAuditorias } from "./auditoria.ts";
import { despacharDemandas, executarAgoraDemanda } from "./despacho_demanda.ts";
import { aguardarCondutores, marcarParada, recuperarExecucoesDemanda } from "./execucao_demanda.ts";

const REINICIADO = "serviço reiniciado";
/** Quanto o `parar` espera os condutores em curso antes de fechar o banco. */
const LIMITE_PARADA_MS = 10_000;

export interface Servico {
  banco: DatabaseSync;
  /** A porta em que o serviço escuta: a pedida, ou a que ele escolheu na porta 0. */
  porta: number;
  /** O "Executar agora" do ticket de uma demanda: mesma elegibilidade e limite do ciclo; recusa com o motivo. */
  executarAgoraDemanda(ref: { demanda_id: string; ticket_id: number }): Promise<void>;
  /** Quando o agendador procura trabalho de novo, se estiver ligado (F7 §4.4, Configuração). */
  proximaBusca(): Date;
  parar(): Promise<void>;
}

/** A porta do serviço e trava de instância única: `$FABRIQUINHA_PORTA`, padrão 4317 (F4 §10). */
export const portaDoServico = (env: NodeJS.ProcessEnv = process.env): number => Number(env.FABRIQUINHA_PORTA || 4317);

/**
 * F4 §7: toda execução em andamento é de uma instância anterior. Mata o grupo do pi de cada avaliação, que não tem
 * execução; as execuções simuladas pendentes (F8 §4) falham com o pi delas morto; e as execuções das sessões das
 * demandas se encerram com falha (`recuperarExecucoesDemanda`).
 */
function recuperar(banco: DatabaseSync): void {
  recuperarAuditorias(raizDo(banco));
  for (const pgid of falharPendentes(banco, REINICIADO)) sinalNoGrupo(pgid, "SIGKILL");
  recuperarExecucoesDemanda(banco);
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
    web.on(
      "request",
      servirWeb({
        banco: aberto,
        porta,
        agendador: { proximaBusca, executarAgoraDemanda: executarAgoraDaDemanda },
      }),
    );
  } catch (error_) {
    aberto?.close();
    web.close();
    throw error_;
  }
  const banco = aberto;

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
   * F4 §4, passos 1 a 4, numa batida do relógio. Nunca lança:
   * qualquer erro vai para o log, e a batida seguinte roda. O passo 1 roda em segundo plano:
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
      void despacharDemandas(banco, c);
    } catch (error_) {
      noLog(error_);
    }
  }
  const relogio = setInterval(ciclo, 60_000);

  // Síncrono até a reserva: a recusa vira rejeição e a etapa segue em segundo plano.
  function executarAgoraDaDemanda(ref: { demanda_id: string; ticket_id: number }): Promise<void> {
    try {
      void executarAgoraDemanda(banco, ref, configuracao(banco));
      return Promise.resolve();
    } catch (error_) {
      const erro = error_ as Error; // os comandos e a persistência só lançam Error (F1 §7)
      return Promise.reject(erro);
    }
  }

  return {
    banco,
    porta,
    executarAgoraDemanda: executarAgoraDaDemanda,
    proximaBusca,
    async parar() {
      marcarParada();
      clearInterval(relogio);
      const fechou = new Promise((pronto) => web.close(pronto));
      // O close só espera: as conexões abertas (um SSE nunca termina) são cortadas aqui.
      web.closeAllConnections();
      await fechou;
      // F7 §3.2: sem o link de entrada, o `abrir` diz que o serviço não está rodando em vez de abrir um link morto.
      rmSync(join(raiz, "web.url"), { force: true });
      await varredura;
      await aguardarCondutores(LIMITE_PARADA_MS);
      banco.close();
    },
  };
}
