// O serviço de longa duração (F4 §2, §4, §7): a porta como trava de instância única e o web (F7 §4), o reinício que
// encerra as execuções de uma instância anterior, o agendador e o "Executar agora" da demanda.
import { rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { ErroDeRegra, mensagem } from "../../shared/nucleo/erros.ts";
import { relogioDoSistema } from "../../shared/nucleo/relogio.ts";
import { abrirBancoDaFabriquinha, montarDemandasDoBanco } from "./banco_da_fabriquinha.ts";
import { garantirPacoteDoAgente } from "./pacote_do_agente.ts";
import { noLog } from "../../shared/infra/registro.ts";
import { servirWeb } from "../api/servidor.ts";
import { configuracao, despachoDasEtapas, type MotivoDeRecusa } from "../../modulos/ciclo_de_vida/publico.ts";
import type { SessoesDeAgente } from "../../modulos/sessoes/publico.ts";
import { despacharAgora, despacharTrabalho } from "../fluxos/ciclo_do_servico/despacho_do_trabalho.ts";
import { recuperarAposReinicio } from "../fluxos/ciclo_do_servico/recuperacao_apos_reinicio.ts";
import { ligarGestaoDeAmbientes, montarRepositorio } from "../../modulos/repositorio/publico.ts";
import type { AmbientesDoServico } from "../api/rotas.ts";
import { montarAmbientesDoServico } from "./ambientes_do_servico.ts";

/** @testes tipo que o teste usa para montar a entrada */
export interface Servico {
  banco: DatabaseSync;
  /** A porta em que o serviço escuta: a pedida, ou a que ele escolheu na porta 0. */
  porta: number;
  /** O "Executar agora" do ticket de uma demanda: mesma seleção e limite do ciclo; o Despacho que recusa devolve o motivo. */
  executarAgora(ref: { demanda_id: string; ticket_id: number }): Promise<MotivoDeRecusa | undefined>;
  /** Quando o agendador procura trabalho de novo, se estiver ligado (F7 §4.4, Configuração). */
  proximaBusca(): Date;
  parar(): Promise<void>;
}

/** A porta do serviço e trava de instância única: `$FABRIQUINHA_PORTA`, padrão 4317 (F4 §10). */
/** @testes o teste confere a leitura da porta do ambiente */
export const portaDoServico = (env: NodeJS.ProcessEnv = process.env): number => Number(env.FABRIQUINHA_PORTA || 4317);

/**
 * Sobe o serviço: ocupa `127.0.0.1:<portaDoServico>` como trava de instância única antes de tocar no banco (uma
 * segunda instância, mesmo de versão mais nova, sai com erro sem migrar nada), abre o banco, encerra as execuções da
 * instância anterior e liga o agendador. A porta 0 escolhe uma livre, sem a trava, e o `web.url` leva a escolhida: os
 * testes sobem várias instâncias juntas sem disputar porta. Antes da porta, garante o CLI do agente em
 * `pastaDoPacote` (a pasta bin do pacote-pi): sem ele os agentes rodam sem poder submeter evidências, então a falha
 * em gerá-lo impede a subida.
 */
export async function iniciarServico(raiz: string, pastaDoPacote: string): Promise<Servico> {
  const pedida = portaDoServico();
  await garantirPacoteDoAgente(join(pastaDoPacote, "fabriquinha")).catch((erro: unknown) => {
    throw new ErroDeRegra(`não foi possível gerar o CLI do agente (pacote-pi/bin/fabriquinha): ${mensagem(erro)}`);
  });
  const relogio = relogioDoSistema;
  const noLogDoServico = (erro: unknown): void => {
    noLog(erro, relogio);
  };
  // ponytail: o relógio bate de minuto em minuto e cada batida relê a configuração; uma mudança vale em até um minuto.
  let minutos = 0;
  /** A última batida do relógio (ou a subida): a próxima busca conta a partir dela. */
  let batida = Date.parse(relogio.agora());
  /**
   * Uma etapa despachada terminou depois do último ciclo: o trabalho que ela liberou (a revisão depois da
   * implementação, o encerramento depois da revisão...) é buscado na batida seguinte, sem esperar o intervalo inteiro.
   * ponytail: no máximo um ciclo por batida, o mesmo ritmo do intervaloMin 1; disparar no próprio fim da etapa se o
   * minuto de espera pesar.
   */
  let etapaTerminou = false;
  /** A batida em que `minutos` chega ao intervalo; desligado além dele, o ciclo roda na batida seguinte. */
  const proximaBusca = (): Date =>
    new Date(batida + Math.max(1, etapaTerminou ? 1 : configuracao(banco).intervaloMin - minutos) * 60_000);
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
  let ambientesMontados: AmbientesDoServico | undefined;
  let sessoesMontadas: SessoesDeAgente | undefined;
  try {
    aberto = abrirBancoDaFabriquinha(raiz);
    // A montagem confere as sandboxes com o docker antes da recuperação, que mata os processos da instância anterior.
    ambientesMontados = await montarAmbientesDoServico({
      banco: aberto,
      raiz,
      porta,
      registrarErro: noLogDoServico,
      relogio,
    });
    ligarGestaoDeAmbientes(ambientesMontados.gestao);
    // O catálogo de preços com que Sessões estima o custo que o harness não informa: lido do harness a cada subida, em
    // segundo plano; a falha só vai ao log, e o catálogo fica como estava.
    sessoesMontadas = await recuperarAposReinicio(aberto, {
      ambientes: ambientesMontados.gestao,
      urlDaApi: `http://127.0.0.1:${String(porta)}`,
      catalogo: { relogio, registrarErro: noLogDoServico },
    });
    web.on(
      "request",
      servirWeb({
        banco: aberto,
        raiz,
        porta,
        agendador: { proximaBusca, executarAgora: executarAgoraDaDemanda },
        ambientes: ambientesMontados,
        demandas: montarDemandasDoBanco(aberto),
        relogio,
        registrarErro: noLogDoServico,
      }),
    );
  } catch (error_) {
    await ambientesMontados?.gestao.parar();
    aberto?.close();
    web.close();
    throw error_;
  }
  const banco = aberto;
  const ambientes = ambientesMontados.gestao;
  const demandas = montarDemandasDoBanco(banco);
  const sessoes = sessoesMontadas;
  // As conduções das Etapas, com o fluxo que conclui o pedido junto do encerramento do processo.
  const despachoDoServico = despachoDasEtapas();
  // F4 §4, passo 1: o Repositório varre em segundo plano, de minuto em minuto com o agendador ligado, a base dos projetos
  // sem varredura há 24 horas; o `parar` a espera antes de fechar o banco.
  // ponytail: o projeto cuja varredura falha (remoto fora do ar) é tentado de novo a cada minuto, com uma linha de log
  // em cada; guardar a última tentativa se o log incomodar.
  const repositorio = montarRepositorio({
    banco,
    varredura: {
      projetos: () => demandas.projetos(),
      // A configuração que não se lê é a mesma que a batida do agendador lê e já leva ao log: sem ela, a varredura espera.
      ligada: () => {
        try {
          return configuracao(banco).agendadorAtivo;
        } catch {
          return false;
        }
      },
      relogio,
      registrarErro: noLogDoServico,
    },
  });

  /**
   * F4 §4, passos 2 a 4, numa batida do relógio (o passo 1 é a varredura do Repositório). Nunca lança: qualquer erro
   * vai para o log, e a batida seguinte roda.
   */
  function ciclo(): void {
    batida = Date.parse(relogio.agora());
    try {
      const c = configuracao(banco);
      // Desligado, o contador continua: ligado depois do intervalo, o primeiro ciclo vem na batida seguinte.
      if ((++minutos < c.intervaloMin && !etapaTerminou) || !c.agendadorAtivo) return;
      minutos = 0;
      etapaTerminou = false;
      // As etapas nunca rejeitam (`cicloDoDespacho`).
      for (const fim of despacharTrabalho(banco, demandas, c, despachoDoServico, relogio))
        void fim.then(() => {
          etapaTerminou = true;
        });
    } catch (error_) {
      noLogDoServico(error_);
    }
  }
  const intervaloDoCiclo = setInterval(ciclo, 60_000);

  // Síncrono até a reserva: a recusa do Despacho volta como motivo, o erro de regra vira rejeição e a etapa segue em segundo plano.
  function executarAgoraDaDemanda(ref: { demanda_id: string; ticket_id: number }): Promise<MotivoDeRecusa | undefined> {
    try {
      const aceitoOuRecusa = despacharAgora(banco, demandas, ref, configuracao(banco), despachoDoServico, relogio);
      return Promise.resolve(aceitoOuRecusa instanceof Promise ? undefined : aceitoOuRecusa);
    } catch (error_) {
      const erro = error_ as Error; // os comandos e a persistência só lançam Error (F1 §7)
      return Promise.reject(erro);
    }
  }

  return {
    banco,
    porta,
    executarAgora: executarAgoraDaDemanda,
    proximaBusca,
    async parar() {
      // Antes de qualquer `await`: o condutor que acordar depois não lança pi novo.
      const paradaDasSessoes = sessoes.parar();
      clearInterval(intervaloDoCiclo);
      const fechou = new Promise((pronto) => web.close(pronto));
      // O close só espera: as conexões abertas (um SSE nunca termina) são cortadas aqui.
      web.closeAllConnections();
      await fechou;
      // F7 §3.2: sem o link de entrada, o `abrir` diz que o serviço não está rodando em vez de abrir um link morto.
      rmSync(join(raiz, "web.url"), { force: true });
      await repositorio.parar();
      await ambientes.parar();
      await paradaDasSessoes;
      banco.close();
    },
  };
}
