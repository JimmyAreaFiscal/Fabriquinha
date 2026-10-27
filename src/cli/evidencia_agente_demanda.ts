// Evidência do agente de uma execução da demanda (comparacao-sdlc-implementacao.md §6): `evidencia schema <tipo>` e
// `evidencia add I-<n>.T<m> <tipo>`. Valida na fronteira (ticket próprio, etapa, produtor, schema do tipo, anexos) e
// grava dentro de `comDemanda`, que reconfere execução aberta e status. Implementar não tem comando: a Fabriquinha
// coleta e conclui.
import { readFileSync, realpathSync } from "node:fs";
import { basename, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { text } from "node:stream/consumers";
import { z } from "zod";
import type { TicketDemanda } from "../dominio/agregado_demanda.ts";
import { ErroDeRegra, encontrado, mensagem } from "../dominio/erros.ts";
import { type EntradaEvidenciaDemanda, submeterEvidenciaDemanda } from "../dominio/evidencia_demanda.ts";
import { validarEvidenciaDaEtapa } from "../dominio/evidencia_etapa.ts";
import { submeterPlano } from "../dominio/transicoes_demanda.ts";
import type { SchemaEvidencia } from "../evidencias/schemas.ts";
import { guardarAnexos } from "../evidencias/submissao.ts";
import { raizDo } from "../persistencia/banco.ts";
import { carregarDemanda, comDemanda } from "../persistencia/demandas.ts";
import { gravarAnexos } from "../persistencia/evidencia_demanda.ts";
import { caminhoDaWorktreeDemanda } from "../repositorio/worktree-demanda.ts";
import {
  type AgenteDemanda,
  type ComandoDemanda,
  paraDominio,
  proprio,
  resolverAgenteDemanda,
  schemaDoTipo,
  TIPOS_DA_ETAPA,
  ticketProprio,
} from "./agente_demanda.ts";

/** O tipo que o agente submete e o schema dele; os demais tipos não têm comando do agente. */
function tipoDoAgente(texto: string): { tipo: string; schema: SchemaEvidencia } {
  const schema = TIPOS_DA_ETAPA.includes(texto) ? schemaDoTipo(texto) : undefined;
  if (!schema) {
    throw new ErroDeRegra(`${texto} não é evidência que o agente submete`, `use um de ${TIPOS_DA_ETAPA.join(", ")}`);
  }
  return { tipo: texto, schema };
}

/** O ticket do agente, que só recebe evidência aberto ou em execução. */
function ticketAberto(ag: ReturnType<typeof carregarDemanda>, a: AgenteDemanda): TicketDemanda {
  const ticket = encontrado(
    ag.tickets.find((t) => t.ticket_id === a.ticket_id),
    `o ticket ${proprio(a)} não existe`,
    "confira a execução",
  );
  if (ticket.status !== "aberto" && ticket.status !== "em_execucao") {
    throw new ErroDeRegra(
      `o ticket ${proprio(a)} está ${ticket.status} e não recebe evidência`,
      "siga com o seu ticket",
    );
  }
  return ticket;
}

/** O JSON de `--dados`, de um arquivo ou do stdin com `-`. */
async function lerDados(arquivo: string | undefined, stdin: NodeJS.ReadableStream): Promise<unknown> {
  if (arquivo === undefined) throw new ErroDeRegra("falta --dados", "passe --dados <arquivo.json|->");
  try {
    return JSON.parse(arquivo === "-" ? await text(stdin) : readFileSync(arquivo, "utf8"));
  } catch (error_) {
    throw new ErroDeRegra(`${arquivo} não é um JSON válido: ${mensagem(error_)}`, "corrija o arquivo de dados");
  }
}

/**
 * De onde os anexos podem vir: a worktree da demanda e a saída da execução, partindo da raiz real (sem links).
 * shortcut: só a worktree da demanda; planejar e revisar_demanda são tickets sem rodada, e o tipo que rodar na da rodada
 * escolhe a dela quando entrar aqui.
 */
function origensDe(banco: DatabaseSync, a: AgenteDemanda) {
  const raiz = realpathSync(raizDo(banco));
  const saida = join(raiz, "execucoes", `E-${a.execucao}`, "saida");
  return {
    worktree: caminhoDaWorktreeDemanda(raiz, a.projeto, a.demanda_id),
    saida,
    fora: "da worktree do ticket e do diretório de saída",
    copie: `$FABRIQUINHA_SAIDA (${saida})`,
  };
}

export const COMANDOS_EVIDENCIA_DEMANDA: readonly ComandoDemanda[] = [
  {
    palavras: ["evidencia", "schema"],
    argumentos: ["<tipo>"],
    rodar({ pos }) {
      const { dados, arquivos } = tipoDoAgente(String(pos[0])).schema;
      return { dados: z.toJSONSchema(dados, { io: "input" }), arquivos };
    },
  },
  {
    palavras: ["evidencia", "add"],
    argumentos: ["I-<n>.T<m>", "<tipo>"],
    opcoesDeUso: "--dados <arquivo.json|-> [--arquivo <caminho>]...",
    opcoes: { dados: { type: "string" }, arquivo: { type: "string", multiple: true } },
    async rodar({ banco, agente, pos, op, stdin }) {
      ticketProprio(agente, String(pos[0]), true);
      const { tipo, schema } = tipoDoAgente(String(pos[1]));
      const { demanda_id, ticket_id } = agente;
      const ticket = ticketAberto(carregarDemanda(banco, demanda_id), agente);
      const dados = await lerDados(op.dados as string | undefined, stdin);
      // O caminho do campo sai a partir de `dados`, e o CLI mostra o ZodError em uma linha com `z.prettifyError`.
      const validos = z.object({ dados: schema.dados }).parse({ dados }).dados;
      validarEvidenciaDaEtapa(
        { demanda_id, ticket_id, etapa: ticket.etapa },
        { demanda_id, ticket_id, tipo, produtor: "agente", dados: validos },
      );
      const caminhos = (op.arquivo ?? []) as string[];
      // Fora da transação: se ela falhar, sobra só arquivo sem referência (F2 §5.2).
      const anexos = guardarAnexos(banco, caminhos, tipo, schema.arquivos, origensDe(banco, agente), () => {
        // Os três tipos não têm regra cruzada com o agregado; o plano cruza com a definição em `submeterPlano`.
      });
      const agora = new Date().toISOString();
      comDemanda(
        banco,
        demanda_id,
        (ag) => {
          resolverAgenteDemanda(banco, agente.execucao); // a execução ainda está aberta?
          ticketAberto(ag, agente);
          return tipo === "plano"
            ? submeterPlano(ag, validos, paraDominio(agente), { agora })
            : submeterEvidenciaDemanda(
                ag,
                { tipo: tipo as "testes_estresse", dados: validos as EntradaEvidenciaDemanda["dados"], ticket_id },
                { ferramenta: "agente", sessao: agente.execucao },
                agora,
              );
        },
        () => {
          gravarAnexos(
            banco,
            { demanda_id, ticket_id, tipo },
            anexos.map((a) => ({ caminho: basename(a.nome), sha256: a.sha256, mime: a.mime, bytes: a.bytes })),
          );
        },
      );
      return { ticket: proprio(agente), tipo, aprovada: schema.aprovada?.(validos) };
    },
  },
];
