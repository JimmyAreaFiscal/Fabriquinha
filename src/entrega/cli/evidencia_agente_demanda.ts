// Evidência do agente de uma execução da demanda (comparacao-sdlc-implementacao.md §6): `evidencia schema <tipo>` e
// `evidencia add I-<n>.T<m> <tipo>`. Valida na fronteira (ticket próprio, etapa, produtor, schema do tipo, anexos) e
// grava dentro de `comDemanda`, que reconfere execução aberta e status. Implementar não tem comando: a Fabriquinha
// coleta e conclui.
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { text } from "node:stream/consumers";
import { z } from "zod";
import type { AgregadoDemanda, TicketDemanda } from "../../nucleo/agregado_demanda.ts";
import { ErroDeRegra, encontrado, mensagem } from "../../nucleo/erros.ts";
import { type EntradaEvidenciaDemanda, submeterEvidenciaDemanda } from "../../nucleo/evidencia_demanda.ts";
import { validarEvidenciaDaEtapa } from "../../nucleo/evidencia_etapa.ts";
import { submeterPlano } from "../../nucleo/transicoes_demanda.ts";
import type { SchemaEvidencia } from "../../nucleo/schemas.ts";
import { gerarAula, type Trecho } from "../../aplicacao/evidencias/aula.ts";
import { guardarAnexos, type Origens } from "../../aplicacao/evidencias/submissao.ts";
import { raizDo } from "../../armazenamento/banco.ts";
import { carregarDemanda, comDemanda } from "../../armazenamento/demandas.ts";
import { gravarAnexos } from "../../armazenamento/evidencia_demanda.ts";
import { caminhoDaWorktreeDemanda, caminhoDaWorktreeRodada } from "../../infra/repositorio/worktree-demanda.ts";
import {
  type ComandoDemanda,
  type EscopoDoAgente,
  proprio,
  resolverEscopoDoAgente,
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
function ticketAberto(ag: ReturnType<typeof carregarDemanda>, a: EscopoDoAgente): TicketDemanda {
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

/** De onde os anexos podem vir: a worktree da rodada do ticket (ou a da demanda) e a saída da execução, da raiz real. */
function origensDe(banco: DatabaseSync, a: EscopoDoAgente, ticket: TicketDemanda): Origens {
  const raiz = realpathSync(raizDo(banco));
  const saida = join(raiz, "execucoes", `E-${a.ator.trabalho_id}`, "saida");
  return {
    worktree:
      ticket.rodada_id === undefined
        ? caminhoDaWorktreeDemanda(raiz, a.projeto, a.demanda_id)
        : caminhoDaWorktreeRodada(raiz, a.projeto, { demanda_id: a.demanda_id, rodada_id: ticket.rodada_id }),
    saida,
    fora: "da worktree do ticket e do diretório de saída",
    copie: `$FABRIQUINHA_SAIDA (${saida})`,
  };
}

/**
 * O agregado da demanda como as regras cruzadas e `gerarAula` o leem: só os tickets da rodada (e os sem rodada) e, nos
 * critérios de aceite, só os que ela cita. Sem rodada, o agregado inteiro.
 */
function agregadoDaRodada(ag: AgregadoDemanda, rodada?: number): AgregadoDemanda {
  if (rodada === undefined) return ag;
  const citados = ag.criterios_citados.filter((c) => c.rodada_id === rodada).map((c) => c.criterio_id);
  return {
    ...ag,
    tickets: ag.tickets.filter((t) => t.rodada_id === undefined || t.rodada_id === rodada),
    evidencias: ag.evidencias.map((e) =>
      e.tipo === "criterios_aceite"
        ? { ...e, dados: { criterios: (e.dados.criterios as { id: string }[]).filter((c) => citados.includes(c.id)) } }
        : e,
    ),
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
      const aprovada = schema.aprovada?.(validos);
      validarEvidenciaDaEtapa(
        { demanda_id, ticket_id, etapa: ticket.etapa },
        { demanda_id, ticket_id, tipo, produtor: "agente", aprovada, dados: validos },
      );
      let caminhos = (op.arquivo ?? []) as string[];
      const origens = origensDe(banco, agente, ticket);
      const agregado = agregadoDaRodada(carregarDemanda(banco, demanda_id), ticket.rodada_id);
      if (tipo === "aula_codigo") {
        if (caminhos.length > 0) {
          throw new ErroDeRegra(
            "aula_codigo não aceita anexo do agente",
            "a Fabriquinha gera o HTML; submeta só --dados",
          );
        }
        const html = await gerarAula(agregado, origens.worktree, validos.trechos as Trecho[]);
        mkdirSync(origens.saida, { recursive: true });
        const aula = join(origens.saida, "aula.html");
        writeFileSync(aula, html);
        caminhos = [aula];
      }
      // Fora da transação: se ela falhar, sobra só arquivo sem referência (F2 §5.2).
      const anexos = guardarAnexos(banco, caminhos, tipo, schema.arquivos, origens, () =>
        schema.cruzar?.(validos, { ag: agregado, ticket: ticket_id, anexos: caminhos.map((c) => basename(c)) }),
      );
      const agora = new Date().toISOString();
      comDemanda(
        banco,
        demanda_id,
        (ag) => {
          resolverEscopoDoAgente(banco, agente.ator.trabalho_id); // a execução ainda está aberta?
          ticketAberto(ag, agente);
          return tipo === "plano"
            ? submeterPlano(ag, validos, agente.ator, { agora })
            : submeterEvidenciaDemanda(
                ag,
                { tipo: tipo as "testes_estresse", dados: validos as EntradaEvidenciaDemanda["dados"], ticket_id },
                agente.ator,
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
      return { ticket: proprio(agente), tipo, aprovada };
    },
  },
];
