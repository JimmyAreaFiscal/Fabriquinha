// Evidência do agente de uma execução da demanda (comparacao-sdlc-implementacao.md §6): `evidencia schema <tipo>` e
// `evidencia add I-<n>.T<m> <tipo>`. Valida na fronteira (ticket próprio, etapa, produtor, schema do tipo, anexos) e
// grava dentro de `comDemanda`, que reconfere execução aberta e estado. Implementar não tem comando: a Fabriquinha
// coleta e conclui.
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { text } from "node:stream/consumers";
import { z } from "zod";
import type { AgregadoDemanda, TicketDemanda } from "../../nucleo/agregado_demanda.ts";
import { espacoDoTicket } from "../../nucleo/espaco_de_trabalho.ts";
import { ErroDeRegra, encontrado, mensagem } from "../../nucleo/erros.ts";
import { agregadoDaRodada, schemaDoTipo, TipoEvidencia } from "../../nucleo/evidencia.ts";
import { CATALOGO_ETAPAS } from "../../nucleo/evidencia_etapa.ts";
import { Endereco } from "../../nucleo/item_de_trabalho.ts";
import type { EsquemaDeEvidencia } from "../../nucleo/schemas.ts";
import { ambienteDoServico } from "../../aplicacao/espaco/ambiente_do_servico.ts";
import { gerarAula, type Trecho } from "../../aplicacao/evidencias/aula.ts";
import { submeterEvidencia } from "../../aplicacao/evidencia/submeter.ts";
import type { Origens } from "../../aplicacao/evidencias/submissao.ts";
import { exigirTrabalhoDoTicket } from "../../aplicacao/trabalho_do_ticket.ts";
import { raizDo } from "../../armazenamento/banco.ts";
import { carregarDemanda } from "../../armazenamento/demandas.ts";
import { projetoExistente } from "../../armazenamento/projetos.ts";
import {
  type ComandoDemanda,
  type EscopoDoAgente,
  proprio,
  resolverEscopoDoAgente,
  ticketProprio,
} from "./agente_demanda.ts";

/** Os tipos de produtor agente do catálogo das etapas: os únicos que o agente submete. */
const TIPOS_QUE_O_AGENTE_SUBMETE: readonly TipoEvidencia[] = [
  ...new Set(CATALOGO_ETAPAS.filter((i) => i.produtor === "agente").map((i) => i.tipo)),
];

/** O tipo que o agente submete e o schema dele; os demais tipos não têm comando do agente. */
function tipoDoAgente(texto: string): { tipo: TipoEvidencia; schema: EsquemaDeEvidencia } {
  const tipo = TipoEvidencia.safeParse(texto);
  if (!tipo.success || !TIPOS_QUE_O_AGENTE_SUBMETE.includes(tipo.data)) {
    throw new ErroDeRegra(
      `${texto} não é evidência que o agente submete`,
      `use um de ${TIPOS_QUE_O_AGENTE_SUBMETE.join(", ")}`,
    );
  }
  return { tipo: tipo.data, schema: schemaDoTipo(tipo.data) };
}

/** O ticket do agente, que só recebe evidência aberto ou em execução. */
function ticketAberto(ag: ReturnType<typeof carregarDemanda>, a: EscopoDoAgente): TicketDemanda {
  const ticket = encontrado(
    ag.tickets.find((t) => t.ticket_id === a.ticket_id),
    `o ticket ${proprio(a)} não existe`,
    "confira a execução",
  );
  if (ticket.estado !== "aberto" && ticket.estado !== "em_execucao") {
    throw new ErroDeRegra(
      `o ticket ${proprio(a)} está ${ticket.estado} e não recebe evidência`,
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

/** De onde os anexos podem vir: a worktree da rodada do ticket (ou a da demanda) e a saída da execução, da raiz real. */
function origensDe(banco: DatabaseSync, a: EscopoDoAgente, ag: AgregadoDemanda, ticket: TicketDemanda): Origens {
  const raiz = realpathSync(raizDo(banco));
  const saida = join(raiz, "execucoes", `E-${a.ator.trabalho_id}`, "saida");
  return {
    worktree: espacoDoTicket(ag, ticket, projetoExistente(banco, a.projeto), raiz).pasta,
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
      const agregadoLido = carregarDemanda(banco, demanda_id);
      const ticket = ticketAberto(agregadoLido, agente);
      const dados = await lerDados(op.dados as string | undefined, stdin);
      let caminhos = (op.arquivo ?? []) as string[];
      const origens = origensDe(banco, agente, agregadoLido, ticket);
      if (tipo === "aula_codigo") {
        if (caminhos.length > 0) {
          throw new ErroDeRegra(
            "aula_codigo não aceita anexo do agente",
            "a Fabriquinha gera o HTML; submeta só --dados",
          );
        }
        // O HTML nasce dos trechos, antes de a submissão ser avaliada; o CLI mostra o ZodError em uma linha com `z.prettifyError`.
        const { trechos } = z.object({ dados: schema.dados }).parse({ dados }).dados;
        const html = await gerarAula(
          ambienteDoServico(),
          agregadoDaRodada(carregarDemanda(banco, demanda_id), ticket.rodada_id),
          origens.worktree,
          trechos as Trecho[],
        );
        mkdirSync(origens.saida, { recursive: true });
        const aula = join(origens.saida, "aula.html");
        writeFileSync(aula, html);
        caminhos = [aula];
      }
      const avaliacao = submeterEvidencia(
        banco,
        { tipo, dono: Endereco.doTicket(demanda_id, ticket_id), produtor: agente.ator, dados, anexos: caminhos },
        {
          origens,
          conferirAntesDeGravar(ag) {
            resolverEscopoDoAgente(banco, agente.ator.trabalho_id); // a execução ainda está aberta?
            exigirTrabalhoDoTicket(banco, agente.ator, agente);
            ticketAberto(ag, agente);
          },
        },
      );
      // Erro síncrono ao agente: sem Tentativa (D10-1).
      if (avaliacao.resultado === "recusada") throw new ErroDeRegra(avaliacao.motivo);
      const { veredito } = avaliacao;
      return { ticket: proprio(agente), tipo, veredito };
    },
  },
];
