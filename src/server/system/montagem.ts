// O serviço de longa duração (F4 §2, §4, §7): a porta como trava de instância única e o web (F7 §4), o reinício que
// encerra as execuções de uma instância anterior, o agendador e o "Executar agora" da demanda.
import { rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { ErroDeRegra, existe, mensagem } from "../../shared/nucleo/erros.ts";
import { relogioDoSistema } from "../../shared/nucleo/relogio.ts";
import { abrirBancoDaFabriquinha, demandasDoCicloDeVida, montarDemandasDoBanco } from "./banco_da_fabriquinha.ts";
import { garantirPacoteDoAgente } from "./pacote_do_agente.ts";
import { noLog } from "../../shared/infra/registro.ts";
import { servirWeb } from "./api/servidor.ts";
import { type CicloDeVida, montarCicloDeVida, type MotivoDeRecusa } from "../../modulos/ciclo_de_vida/publico.ts";
import { montarSessoesDeAgente, type SessoesDeAgente } from "../../modulos/sessoes/publico.ts";
import { montarRepositorio, type RepositorioDoProjeto } from "../../modulos/repositorio/publico.ts";
import type { AmbientesDoServico } from "./api/rotas.ts";
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
  let repositorioMontado: RepositorioDoProjeto | undefined;
  let cicloMontado: CicloDeVida | undefined;
  let sessoesDaSubida: SessoesDeAgente | undefined;
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
    const bancoAberto = aberto;
    const gestaoDosAmbientes = ambientesMontados.gestao;
    const demandasDoBanco = montarDemandasDoBanco(aberto);
    // F4 §4, passo 1: o Repositório varre em segundo plano, a cada intervalo do agendador ligado, a base dos projetos sem
    // varredura há 24 horas; o `parar` a espera antes de fechar o banco.
    // ponytail: o projeto cuja varredura falha (remoto fora do ar) é tentado de novo a cada intervalo, com uma linha de
    // log em cada; guardar a última tentativa se o log incomodar.
    repositorioMontado = montarRepositorio({
      banco: aberto,
      ambientes: gestaoDosAmbientes,
      varredura: {
        projetos: () => demandasDoBanco.projetos(),
        cadencia: () => existe(cicloMontado, "o Ciclo de Vida ainda não subiu", "espere a subida").configuracao(),
        relogio,
        registrarErro: noLogDoServico,
      },
    });
    // A subida: as Sessões matam os processos da instância anterior, o Ciclo de Vida falha os tickets que ficaram sem
    // processo e liga o agendador. O catálogo de preços com que Sessões estima o custo que o harness não informa é lido
    // do harness a cada subida, em segundo plano; a falha só vai ao log, e o catálogo fica como estava.
    cicloMontado = await montarCicloDeVida({
      banco: aberto,
      demandas: demandasDoCicloDeVida,
      ambientes: gestaoDosAmbientes,
      repositorio: repositorioMontado,
      relogio,
      registrarErro: noLogDoServico,
      subirSessoes: async (subida) =>
        (sessoesDaSubida = await montarSessoesDeAgente({
          banco: bancoAberto,
          ambientes: gestaoDosAmbientes,
          urlDaApi: `http://127.0.0.1:${String(porta)}`,
          catalogo: { relogio, registrarErro: noLogDoServico },
          subida,
        })),
    });
    web.on(
      "request",
      servirWeb({
        banco: aberto,
        raiz,
        porta,
        cicloDeVida: cicloMontado,
        ambientes: ambientesMontados,
        demandas: demandasDoBanco,
        repositorio: repositorioMontado,
        relogio,
        registrarErro: noLogDoServico,
      }),
    );
  } catch (error_) {
    await cicloMontado?.parar();
    await repositorioMontado?.parar();
    await ambientesMontados?.gestao.parar();
    aberto?.close();
    web.close();
    throw error_;
  }
  const banco = aberto;
  const ambientes = ambientesMontados.gestao;
  const repositorio = repositorioMontado;
  const cicloDeVida = cicloMontado;
  // As Sessões da subida: o `parar` delas espera a gravação do catálogo de preços.
  const sessoes = existe(sessoesDaSubida, "a subida não montou as Sessões", "confira a montagem");

  // Síncrono até a reserva: a recusa do Despacho volta como motivo, o erro de regra vira rejeição e a etapa segue em segundo plano.
  function executarAgoraDaDemanda(ref: { demanda_id: string; ticket_id: number }): Promise<MotivoDeRecusa | undefined> {
    try {
      return Promise.resolve(cicloDeVida.executarAgora(ref));
    } catch (error_) {
      const erro = error_ as Error; // os comandos e a persistência só lançam Error (F1 §7)
      return Promise.reject(erro);
    }
  }

  return {
    banco,
    porta,
    executarAgora: executarAgoraDaDemanda,
    proximaBusca: () => new Date(cicloDeVida.proximaBusca()),
    async parar() {
      // Antes de qualquer `await`: a condução que falhar daqui em diante falha como "serviço reiniciado", e o condutor
      // que acordar depois não lança pi novo.
      const paradaDoCiclo = cicloDeVida.parar();
      const paradaDasSessoes = sessoes.parar();
      const fechou = new Promise((pronto) => web.close(pronto));
      // O close só espera: as conexões abertas (um SSE nunca termina) são cortadas aqui.
      web.closeAllConnections();
      await fechou;
      // F7 §3.2: sem o link de entrada, o `abrir` diz que o serviço não está rodando em vez de abrir um link morto.
      rmSync(join(raiz, "web.url"), { force: true });
      await repositorio.parar();
      await ambientes.parar();
      await paradaDoCiclo;
      await paradaDasSessoes;
      banco.close();
    },
  };
}
