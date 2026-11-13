// O caminho único de uma Evidência (F3 §5): Evidências avalia com o agregado como contexto e guarda os anexos por
// SHA-256, e a evidência entra com eles na transação de `comDemanda`. Quem fecha a Etapa decide o que fazer com a recusa.
import type { DatabaseSync } from "node:sqlite";
import type { AgregadoDemanda, EvidenciaDemanda } from "../../nucleo/demanda/agregado_demanda.ts";
import {
  type Avaliacao,
  AvaliadorDeEvidencia,
  avaliarEGuardarAnexos,
  CATALOGO_ETAPAS,
  gravarAnexos,
  type OrigemDosAnexos,
  type SubmissaoDeEvidencia,
} from "../../../ciclo_de_vida/publico.ts";
import { CICLO_DA_DEMANDA } from "../../nucleo/ciclo_de_vida/ciclos.ts";
import { type Relogio, relogioDoSistema } from "../../../../shared/nucleo/relogio.ts";
import { validarPlano } from "../../nucleo/transicoes/transicoes_demanda.ts";
import { carregarDemanda, comDemanda } from "../../armazenamento/demandas.ts";

const AVALIADOR = new AvaliadorDeEvidencia(CATALOGO_ETAPAS, validarPlano);

interface ContextoDaSubmissao extends OrigemDosAnexos {
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
  const { tipo, dono, produtor } = submissao;
  const avaliada = avaliarEGuardarAnexos(
    banco,
    AVALIADOR,
    carregarDemanda(banco, dono.demanda_id),
    submissao,
    contexto,
  );
  if (avaliada.resultado === "recusada") return avaliada;
  const { anexosGuardados, ...avaliacao } = avaliada;
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
        anexosGuardados.map((a) => ({ caminho: a.nome, sha256: a.sha256, mime: a.mime, bytes: a.bytes })),
      );
    },
  );
  return avaliacao;
}
