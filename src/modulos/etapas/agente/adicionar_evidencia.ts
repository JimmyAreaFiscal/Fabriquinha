import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { AgregadoDemanda, TicketDemanda } from "../../sdlc/nucleo/demanda/agregado_demanda.ts";
import { type EspacoDeTrabalho, espacoDoTicket } from "../../repositorio/nucleo/espaco_de_trabalho.ts";
import { ErroDeRegra } from "../../compartilhado/nucleo/erros.ts";
import { agregadoDaRodada } from "../../sdlc/nucleo/evidencias/evidencia.ts";
import { Endereco } from "../../compartilhado/nucleo/vocabulario_do_sdlc/endereco.ts";
import { raizDo } from "../../compartilhado/armazenamento/banco.ts";
import { carregarDemanda } from "../../sdlc/armazenamento/demandas.ts";
import { projetoExistente } from "../../projeto/armazenamento/projetos.ts";
import { ambienteDoEspaco } from "../../repositorio/aplicacao/espaco/ambiente_do_espaco.ts";
import { submeterEvidencia } from "../../sdlc/aplicacao/evidencias/submeter.ts";
import { gerarAula, type Trecho } from "../encerrar_rodada/documentacao_do_pr/aula.ts";
import type { AnexoEnviado, Origens } from "../../sdlc/aplicacao/evidencias/submissao.ts";
import {
  enderecoDoTicketDoAgente,
  type EscopoDoAgente,
  escopoDoProcessoAberto,
  exigirTicket,
  exigirTicketProprio,
  type LeitorDeJson,
  type ProcessoDoAgente,
  reconferirExecucao,
} from "./escopo.ts";
import { tipoDoAgente } from "./tipo_do_agente.ts";

/**
 * A evidência que o agente submete ao próprio ticket; `dados` é o valor da opção, que `lerJson` lê, e cada anexo chega
 * com os bytes e o SHA-256, e o caminho vale no Ambiente do agente.
 */
interface PedidoDeEvidencia {
  readonly ticket: string;
  readonly tipo: string;
  readonly dados: string | undefined;
  readonly anexos: readonly AnexoEnviado[];
}

/** O ticket do agente, que só recebe evidência aberto ou em execução. */
function exigirTicketAberto(agregado: AgregadoDemanda, agente: EscopoDoAgente): TicketDemanda {
  const ticket = exigirTicket(agregado, agente.ticket_id);
  if (ticket.estado !== "aberto" && ticket.estado !== "em_execucao") {
    throw new ErroDeRegra(
      `o ticket ${enderecoDoTicketDoAgente(agente)} está ${ticket.estado} e não recebe evidência`,
      "siga com o seu ticket",
    );
  }
  return ticket;
}

/** De onde os anexos podem vir: a worktree da rodada do ticket (ou a da demanda) e a saída da execução, da raiz real. */
function origensDosAnexos(banco: DatabaseSync, agente: EscopoDoAgente, espaco: EspacoDeTrabalho): Origens {
  const raiz = realpathSync(raizDo(banco));
  const saida = join(raiz, "execucoes", `E-${agente.ator.trabalho_id}`, "saida");
  return {
    worktree: espaco.pasta,
    saida,
    fora: "da worktree do ticket e do diretório de saída",
    copie: `$FABRIQUINHA_SAIDA (${saida})`,
  };
}

/**
 * Submete a evidência do próprio ticket do agente (sobre `submeterEvidencia`). Valida o ticket, o tipo, o schema e os
 * anexos antes de gravar, e reconfere a execução dentro da transação: o core inverte o caminho declarado de cada anexo
 * para o host e confere que o arquivo ali tem o SHA-256 enviado. A recusa é erro síncrono ao agente, sem Tentativa nem
 * Reprovação (D10-1).
 */
export async function adicionarEvidenciaComAnexosEnviados(
  banco: DatabaseSync,
  processo: ProcessoDoAgente,
  pedido: PedidoDeEvidencia,
  lerJson: LeitorDeJson,
) {
  let anexosEnviados: readonly AnexoEnviado[] | undefined = pedido.anexos;
  const agente = escopoDoProcessoAberto(banco, processo);
  exigirTicketProprio(agente, pedido.ticket, true);
  const { tipo, schema } = tipoDoAgente(pedido.tipo);
  const { demanda_id, ticket_id } = agente;
  const agregadoLido = carregarDemanda(banco, demanda_id);
  const ticket = exigirTicketAberto(agregadoLido, agente);
  if (pedido.dados === undefined) throw new ErroDeRegra("falta --dados", "passe --dados <arquivo.json|->");
  const dados = await lerJson(pedido.dados);
  let anexos = pedido.anexos.map((anexo) => anexo.caminho);
  const espaco = espacoDoTicket(
    agregadoLido,
    ticket,
    projetoExistente(banco, agente.projeto),
    realpathSync(raizDo(banco)),
  );
  const origens = origensDosAnexos(banco, agente, espaco);
  if (tipo === "aula_codigo") {
    if (anexos.length > 0) {
      throw new ErroDeRegra("aula_codigo não aceita anexo do agente", "a Fabriquinha gera o HTML; submeta só --dados");
    }
    // O HTML nasce dos trechos, antes de a submissão ser avaliada; a API devolve o ZodError como 422.
    const { trechos } = z.object({ dados: schema.dados }).parse({ dados }).dados;
    const html = await gerarAula(
      ambienteDoEspaco(espaco),
      agregadoDaRodada(carregarDemanda(banco, demanda_id), ticket.rodada_id),
      origens.worktree,
      trechos as Trecho[],
    );
    mkdirSync(origens.saida, { recursive: true });
    const aula = join(origens.saida, "aula.html");
    writeFileSync(aula, html);
    anexos = [aula];
    // O HTML da aula está no host: não passa pela inversão de caminho dos anexos enviados.
    anexosEnviados = undefined;
  }
  const avaliacao = submeterEvidencia(
    banco,
    { tipo, dono: Endereco.doTicket(demanda_id, ticket_id), produtor: agente.ator, dados, anexos },
    {
      origens,
      enviados: anexosEnviados && { anexos: anexosEnviados, ambiente: ambienteDoEspaco(espaco) },
      conferirAntesDeGravar(agregado) {
        reconferirExecucao(banco, agente);
        exigirTicketAberto(agregado, agente);
      },
    },
  );
  // Erro síncrono ao agente: sem Tentativa (D10-1).
  if (avaliacao.resultado === "recusada") throw new ErroDeRegra(avaliacao.motivo);
  return { ticket: enderecoDoTicketDoAgente(agente), tipo, veredito: avaliacao.veredito };
}
