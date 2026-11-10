// CLI do agente de uma execução da demanda (comparacao-sdlc-implementacao.md §6): traduz os argumentos para os casos de
// uso de `aplicacao/agente`, que confere o escopo (a própria demanda, o próprio ticket) e reconfere a execução.
// Nenhuma regra mora aqui.
import type { DatabaseSync } from "node:sqlite";
import { encontrado } from "../../nucleo/erros.ts";
import { decidirRevisao } from "../../aplicacao/agente/decidir_revisao.ts";
import { criarTicketCorretivo } from "../../aplicacao/agente/criar_ticket_corretivo.ts";
import { verDemanda, verProjeto, verTicket } from "../../aplicacao/agente/consultas.ts";
import { type ProcessoDoAgente, resolverEscopoDoAgente } from "../../aplicacao/agente/escopo.ts";
import { type Comando, type DepsDoCli, lerJsonDoArquivo } from "./comando.ts";
import { demandaParaCli } from "../contrato/demanda_para_cli.ts";

/**
 * Roda `usar` com o banco e o processo de `FABRIQUINHA_EXECUCAO`; a execução que não existe (ou que já terminou) recusa
 * o comando antes de ele agir.
 */
export function comProcessoDoAgente<T>(
  deps: DepsDoCli,
  usar: (banco: DatabaseSync, processo: ProcessoDoAgente) => T | Promise<T>,
): Promise<T> {
  const execucao = String(deps.env.FABRIQUINHA_EXECUCAO);
  return deps.comBanco((banco) => {
    encontrado(
      resolverEscopoDoAgente(banco, execucao),
      `a execução ${execucao} não existe`,
      "confira FABRIQUINHA_EXECUCAO",
    );
    return usar(banco, { id: execucao });
  });
}

export const COMANDOS_DEMANDA: readonly Comando[] = [
  {
    nome: "projeto ver",
    posicionais: [],
    argumentos: {},
    executar: (_, deps) => comProcessoDoAgente(deps, verProjeto),
  },
  {
    nome: "demanda ver",
    posicionais: ["I-<n>"],
    argumentos: {},
    executar: ({ posicionais }, deps) =>
      comProcessoDoAgente(deps, (banco, processo) => {
        const visao = verDemanda(banco, processo, String(posicionais[0]));
        return { ...visao, demanda: demandaParaCli(visao.demanda) };
      }),
  },
  {
    nome: "ticket ver",
    posicionais: ["I-<n>.T<m>"],
    argumentos: {},
    executar: ({ posicionais }, deps) =>
      comProcessoDoAgente(deps, (banco, processo) => verTicket(banco, processo, String(posicionais[0]))),
  },
  {
    nome: "ticket criar",
    posicionais: ["I-<n>.R<m>"],
    opcoesDeUso: "--titulo <texto>",
    argumentos: { options: { titulo: { type: "string" } } },
    executar: ({ posicionais, opcoes }, deps) =>
      comProcessoDoAgente(deps, (banco, processo) =>
        criarTicketCorretivo(banco, processo, {
          rodada: String(posicionais[0]),
          titulo: opcoes.titulo as string | undefined,
        }),
      ),
  },
  {
    nome: "revisao decidir",
    posicionais: ["I-<n>.T<m>", "aprovar|reprovar"],
    opcoesDeUso: "[--motivo <texto>] [--correcoes <json|->] [--plano <json|->]",
    argumentos: {
      options: {
        motivo: { type: "string" },
        correcoes: { type: "string" },
        plano: { type: "string" },
      },
    },
    executar: ({ posicionais, opcoes }, deps) =>
      comProcessoDoAgente(deps, (banco, processo) =>
        decidirRevisao(
          banco,
          processo,
          {
            ticket: String(posicionais[0]),
            veredito: String(posicionais[1]),
            motivo: opcoes.motivo as string | undefined,
            correcoes: opcoes.correcoes as string | undefined,
            plano: opcoes.plano as string | undefined,
          },
          (valor, opcao) => lerJsonDoArquivo(valor, deps.stdin, opcao),
        ),
      ),
  },
];
