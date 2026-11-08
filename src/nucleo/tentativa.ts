// A Tentativa: cada execução de uma Etapa de um ticket, com o resultado tipado, e o retorno ao agente que a segue.
import { AUDITOR, type Ator } from "./ator.ts";
import { ErroDeRegra } from "./erros.ts";
import type { Endereco } from "./item_de_trabalho.ts";
import type { Instante } from "./primitivos.ts";

type CausaDeInfraestrutura =
  | "tempo_limite"
  | "cota"
  | "servico_reiniciado"
  | "modelo_sem_resposta"
  | "comando_ausente"
  | "servico_externo_inacessivel";

type ResultadoDaTentativa =
  | { tipo: "sucesso" }
  | { tipo: "reprovacao"; motivo: string }
  | { tipo: "falha_infraestrutura"; causa: CausaDeInfraestrutura; motivo: string }
  | { tipo: "interrompida"; por: Ator };

/** @testes o teste monta uma Tentativa sem resultado; a produção a recebe de tentativaAnteriorEmMemoria */
export interface Tentativa {
  ticket: Endereco;
  numero: number;
  processo_id?: string;
  inicio: Instante;
  fim?: Instante;
  resultado?: ResultadoDaTentativa;
  instrucao?: string;
}

/** O que o agente lê ao voltar a um ticket: o título da seção do prompt e o texto dela. */
export interface RetornoAoAgente {
  titulo: "Devolução" | "Reabertura";
  texto: string;
}

/**
 * O único montador do retorno ao agente: a Tentativa reprovada devolve o ticket com o motivo dela; qualquer outra o
 * reabre com a instrução do Auditor (ou a que a Tentativa já guarda).
 */
export function montarRetornoAoAgente(anterior: Tentativa, instrucaoDoAuditor?: string): RetornoAoAgente {
  const ticket = anterior.ticket.toString();
  if (anterior.resultado?.tipo === "reprovacao") {
    return {
      titulo: "Devolução",
      texto:
        `O ticket ${ticket} foi devolvido a você: a entrega anterior não passou. ` +
        `Corrija o que o motivo aponta e não refaça o resto.\n\nMotivo: ${anterior.resultado.motivo}`,
    };
  }
  const instrucao = instrucaoDoAuditor ?? anterior.instrucao;
  if (instrucao === undefined) {
    throw new ErroDeRegra(
      `a Tentativa ${String(anterior.numero)} de ${ticket} não tem instrução para reabrir`,
      "informe a instrução do Auditor",
    );
  }
  return {
    titulo: "Reabertura",
    texto: `O Auditor reabriu o ticket ${ticket}. Continue de onde a entrega anterior parou e atenda ao motivo.\n\nMotivo: ${instrucao}`,
  };
}

/**
 * A Tentativa que precedeu o retorno, montada em memória a partir dos dados do ticket.
 * shortcut: `numero` e `inicio` são marcadores, a tabela `tentativa` traz os reais; só o resultado e a instrução são lidos.
 */
export function tentativaAnteriorEmMemoria(
  ticket: Endereco,
  { motivoDaReprovacao, instrucao }: { motivoDaReprovacao?: string; instrucao?: string },
): Tentativa {
  const resultado: ResultadoDaTentativa =
    motivoDaReprovacao === undefined
      ? { tipo: "interrompida", por: AUDITOR }
      : { tipo: "reprovacao", motivo: motivoDaReprovacao };
  return { ticket, numero: 0, inicio: "1970-01-01T00:00:00.000Z", resultado, instrucao };
}
