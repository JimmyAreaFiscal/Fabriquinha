// A submissão de uma Evidência (F3 §5): o Avaliador aceita ou recusa com o contexto recebido e os anexos são guardados
// por SHA-256. Quem submete grava a evidência aceita e os anexos guardados na sua transação; a recusa não grava nada.
import type { DatabaseSync } from "node:sqlite";
import { ErroDeRegra } from "../../../../shared/nucleo/erros.ts";
import type { Avaliacao, AvaliadorDeEvidencia, SubmissaoDeEvidencia } from "../nucleo/avaliacao.ts";
import { schemaDoTipo } from "../nucleo/formatos.ts";
import type { ContextoDaAvaliacao } from "../nucleo/schemas.ts";
import {
  type AnexosEnviados,
  type ArquivoEvidencia,
  guardarAnexos,
  guardarAnexosEnviados,
  type Origens,
} from "./guarda_dos_anexos.ts";

/** De onde vêm os anexos da submissão. */
export interface OrigemDosAnexos {
  /** De onde os anexos podem vir. */
  origens: Origens;
  /** Os anexos que o agente enviou de dentro do Ambiente; sem eles, `anexos` são caminhos que o host abre. */
  enviados?: AnexosEnviados;
}

/** A evidência aceita, com os anexos já guardados por conteúdo, ou a submissão recusada, com o motivo. */
type SubmissaoAvaliada =
  | (Extract<Avaliacao, { resultado: "aceita" }> & { anexosGuardados: ArquivoEvidencia[] })
  | Extract<Avaliacao, { resultado: "recusada" }>;

/**
 * Avalia a submissão contra o contexto e guarda os anexos da aceita. Os anexos são guardados fora da transação de quem
 * grava: se ela falhar, sobra só arquivo sem referência (F2 §5.2).
 */
export function avaliarEGuardarAnexos<Contexto extends ContextoDaAvaliacao>(
  banco: DatabaseSync,
  avaliador: AvaliadorDeEvidencia<Contexto>,
  contexto: Contexto,
  submissao: SubmissaoDeEvidencia,
  { origens, enviados }: OrigemDosAnexos,
): SubmissaoAvaliada {
  const avaliacao = avaliador.avaliar(contexto, submissao);
  if (avaliacao.resultado === "recusada") return avaliacao;
  const { tipo, anexos } = submissao;
  try {
    const regra = schemaDoTipo(tipo).arquivos;
    const anexosGuardados = enviados
      ? guardarAnexosEnviados(banco, enviados, tipo, regra, origens)
      : guardarAnexos(banco, anexos, tipo, regra, origens);
    return { ...avaliacao, anexosGuardados };
  } catch (erro) {
    if (erro instanceof ErroDeRegra) return { resultado: "recusada", motivo: erro.message };
    throw erro;
  }
}
