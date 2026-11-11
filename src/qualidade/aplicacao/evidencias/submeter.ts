// O caminho único de uma Evidência (F3 §5): o Avaliador aceita ou recusa, os anexos são guardados por SHA-256 e a
// evidência entra com eles na transação de `comDemanda`. Quem fecha a Etapa decide o que fazer com a recusa.
import type { DatabaseSync } from "node:sqlite";
import type { AgregadoDemanda, EvidenciaDemanda } from "../../../sdlc/nucleo/demanda/agregado_demanda.ts";
import {
  type Avaliacao,
  AvaliadorDeEvidencia,
  schemaDoTipo,
  type SubmissaoDeEvidencia,
} from "../../nucleo/evidencias/evidencia.ts";
import { ErroDeRegra } from "../../../compartilhado/nucleo/erros.ts";
import { CATALOGO_ETAPAS } from "../../../etapas/definicao/evidencia_exigida.ts";
import { CICLO_DA_DEMANDA } from "../../../sdlc/nucleo/ciclo_de_vida/ciclos.ts";
import { type Relogio, relogioDoSistema } from "../../../compartilhado/nucleo/relogio.ts";
import { validarPlano } from "../../../sdlc/nucleo/transicoes/transicoes_demanda.ts";
import { carregarDemanda, comDemanda } from "../../../sdlc/armazenamento/demandas.ts";
import { gravarAnexos } from "../../armazenamento/evidencia_demanda.ts";
import { type AnexosEnviados, guardarAnexos, guardarAnexosEnviados, type Origens } from "./submissao.ts";

const AVALIADOR = new AvaliadorDeEvidencia(CATALOGO_ETAPAS, validarPlano);

interface ContextoDaSubmissao {
  /** De onde os anexos podem vir. */
  origens: Origens;
  /** Os anexos que o agente enviou de dentro do Ambiente; sem eles, `anexos` são caminhos que o host abre. */
  enviados?: AnexosEnviados;
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
  relogio: Relogio = relogioDoSistema,
): Avaliacao {
  const { tipo, dono, produtor, anexos } = submissao;
  const avaliacao = AVALIADOR.avaliar(carregarDemanda(banco, dono.demanda_id), submissao);
  if (avaliacao.resultado === "recusada") return avaliacao;

  // Fora da transação: se ela falhar, sobra só arquivo sem referência (F2 §5.2).
  let guardados;
  try {
    const regra = schemaDoTipo(tipo).arquivos;
    guardados = contexto.enviados
      ? guardarAnexosEnviados(banco, contexto.enviados, tipo, regra, contexto.origens)
      : guardarAnexos(banco, anexos, tipo, regra, contexto.origens);
  } catch (erro) {
    if (erro instanceof ErroDeRegra) return { resultado: "recusada", motivo: erro.message };
    throw erro;
  }
  const agora = relogio.agora();
  // shortcut: a Avaliação lê a demanda antes da transação e só o ciclo barra a corrida do plano, reavaliar aqui se outra regra passar a depender de estado que muda em paralelo.
  comDemanda(
    banco,
    dono.demanda_id,
    (ag) => {
      contexto.conferirAntesDeGravar?.(ag);
      const nova = {
        demanda_id: dono.demanda_id,
        rodada_id: dono.rodada_id,
        ticket_id: dono.ticket_id,
        tipo,
        dados: avaliacao.dados as EvidenciaDemanda["dados"],
        autor: produtor,
        em: agora,
      };
      const substituindoAnterior = (e: EvidenciaDemanda) =>
        e.tipo === tipo && e.rodada_id === dono.rodada_id && e.ticket_id === dono.ticket_id;
      const comNova = { ...ag, evidencias: [...ag.evidencias.filter((e) => !substituindoAnterior(e)), nova] };
      return tipo === "plano"
        ? { ...comNova, demanda: CICLO_DA_DEMANDA.mudar(ag.demanda, "gate_planejamento", agora) }
        : comNova;
    },
    () => {
      gravarAnexos(
        banco,
        { demanda_id: dono.demanda_id, rodada_id: dono.rodada_id, ticket_id: dono.ticket_id, tipo },
        guardados.map((a) => ({ caminho: a.nome, sha256: a.sha256, mime: a.mime, bytes: a.bytes })),
      );
    },
  );
  return avaliacao;
}
