// O caminho único de uma Evidência (F3 §5): o Avaliador aceita ou recusa, os anexos são guardados por SHA-256 e a
// evidência entra com eles na transação de `comDemanda`. Quem fecha a Etapa decide o que fazer com a recusa.
import type { DatabaseSync } from "node:sqlite";
import type { AgregadoDemanda } from "../../nucleo/agregado_demanda.ts";
import {
  type Avaliacao,
  AvaliadorDeEvidencia,
  schemaDoTipo,
  type SubmissaoDeEvidencia,
} from "../../nucleo/evidencia.ts";
import { ErroDeRegra } from "../../nucleo/erros.ts";
import { type EntradaEvidenciaDemanda, submeterEvidenciaDemanda } from "../../nucleo/evidencia_demanda.ts";
import { CATALOGO_ETAPAS } from "../../nucleo/evidencia_etapa.ts";
import { submeterPlano, validarPlano } from "../../nucleo/transicoes_demanda.ts";
import { carregarDemanda, comDemanda } from "../../armazenamento/demandas.ts";
import { gravarAnexos } from "../../armazenamento/evidencia_demanda.ts";
import { guardarAnexos, type Origens } from "../evidencias/submissao.ts";

const AVALIADOR = new AvaliadorDeEvidencia(CATALOGO_ETAPAS, validarPlano);

interface ContextoDaSubmissao {
  /** De onde os anexos podem vir. */
  origens: Origens;
  /** Dentro da transação, antes de gravar: o que só quem submete sabe conferir, como a execução ainda estar aberta. */
  conferirAntesDeGravar?: (ag: AgregadoDemanda) => void;
}

/**
 * Avalia a submissão, guarda os anexos e grava a evidência com eles; devolve a Avaliação, e a recusa não grava nada.
 * Não abre Tentativa: isso é de quem fecha a Etapa.
 */
export function submeterEvidencia(
  banco: DatabaseSync,
  submissao: SubmissaoDeEvidencia,
  contexto: ContextoDaSubmissao,
): Avaliacao {
  const { tipo, dono, produtor, anexos } = submissao;
  const avaliacao = AVALIADOR.avaliar(carregarDemanda(banco, dono.demanda_id), submissao);
  if (avaliacao.resultado === "recusada") return avaliacao;

  // Fora da transação: se ela falhar, sobra só arquivo sem referência (F2 §5.2).
  let guardados;
  try {
    guardados = guardarAnexos(banco, anexos, tipo, schemaDoTipo(tipo).arquivos, contexto.origens);
  } catch (erro) {
    if (erro instanceof ErroDeRegra) return { resultado: "recusada", motivo: erro.message };
    throw erro;
  }
  const agora = new Date().toISOString();
  comDemanda(
    banco,
    dono.demanda_id,
    (ag) => {
      contexto.conferirAntesDeGravar?.(ag);
      return tipo === "plano"
        ? submeterPlano(ag, avaliacao.dados, produtor, { agora })
        : submeterEvidenciaDemanda(
            ag,
            { tipo, dados: avaliacao.dados as EntradaEvidenciaDemanda["dados"], ticket_id: dono.ticket_id },
            produtor,
            agora,
          );
    },
    () => {
      gravarAnexos(
        banco,
        { demanda_id: dono.demanda_id, ticket_id: dono.ticket_id, tipo },
        guardados.map((a) => ({ caminho: a.nome, sha256: a.sha256, mime: a.mime, bytes: a.bytes })),
      );
    },
  );
  return avaliacao;
}
