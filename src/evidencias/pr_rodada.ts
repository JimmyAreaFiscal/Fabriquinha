// Título, marca e corpo do PR da rodada (branch da rodada → branch da demanda). Só endereços públicos (D09):
// `I-206`, `I-206.R2`, `I-206.T3`; o id interno do ticket nunca aparece.
import type { AgregadoDemanda } from "../dominio/agregado_demanda.ts";
import { formatarRodadaRef, formatarTicketRef } from "../dominio/demanda.ts";
import { ErroDeRegra } from "../dominio/erros.ts";
import type { Id } from "../dominio/primitivos.ts";
import { dolares, inteiro } from "../metricas/relatorio.ts";
import { codigo, lista, neutro, plural, tabela } from "./pr.ts";
import type { ProdutividadeRodada } from "./produtividade_rodada.ts";

// Os campos de `mensagem_pr` que o PR da rodada usa (schema do F3).
interface MensagemPR {
  titulo: string;
  oQueMudou: string;
  decisoesNaoObvias: string[];
  naoFeito: string[];
  comoRevisar: string[];
  naoVerificado: string[];
  reversao?: string;
}

/** `<feat|fix>: <titulo> [I-206.R2]`. */
export const tituloDoPRRodada = (ag: AgregadoDemanda, rodada: Id, titulo: string): string =>
  `${ag.demanda.tipo === "funcionalidade" ? "feat" : "fix"}: ${titulo} [${formatarRodadaRef({ demanda_id: ag.demanda.id, rodada_id: rodada })}]`;

/** A marca invisível do PR publicado pelo ticket `encerrar_rodada`, para reconhecê-lo depois de uma queda. */
export const marcaDoPRRodada = (demanda: string, ticket: Id): string =>
  `<!-- fabriquinha ${formatarTicketRef({ demanda_id: demanda, ticket_id: ticket })} -->`;

const custo = (c: { custo: number; custoIncompleto: boolean }): string =>
  c.custoIncompleto ? `${dolares(c.custo)} (incompleto)` : dolares(c.custo);

/** O corpo completo e o publicado, que cabe em `limite` caracteres, com remissão ao `pr_aberto` no corte. */
export function montarPRRodada(
  ag: AgregadoDemanda,
  rodada: Id,
  ticket: Id,
  relatorio: ProdutividadeRodada,
  limite: number,
): { titulo: string; completo: string; publicado: string } {
  const demanda = ag.demanda.id;
  const refRodada = formatarRodadaRef({ demanda_id: demanda, rodada_id: rodada });
  const refTicket = formatarTicketRef({ demanda_id: demanda, ticket_id: ticket });
  const mensagem = ag.evidencias.findLast((e) => e.ticket_id === ticket && e.tipo === "mensagem_pr")?.dados as
    MensagemPR | undefined;
  if (!mensagem) {
    throw new ErroDeRegra(
      `o PR da ${refRodada} não pode ser montado: falta a evidência mensagem_pr de ${refTicket}`,
      "o agente entrega a mensagem_pr antes da publicação",
    );
  }
  const concluidos = ag.tickets.filter((t) => t.rodada_id === rodada && t.status === "concluido");
  const secoes: [string, string][] = [
    ["Por quê", `${neutro(ag.demanda.titulo)} (${demanda}, ${refRodada})\n\n${neutro(ag.demanda.descricao)}`],
    ["O que mudou", neutro(mensagem.oQueMudou)],
    ["Decisões não óbvias", lista(mensagem.decisoesNaoObvias, "Nenhuma.")],
    ["Fora do escopo", lista(mensagem.naoFeito, "Nada declarado.")],
    [
      "Tickets da rodada concluídos",
      lista(
        concluidos.map(
          (t) => `${codigo(formatarTicketRef(t))} (${t.etapa})${t.titulo === undefined ? "" : `: ${t.titulo}`}`,
        ),
        "Nenhum.",
      ),
    ],
    [
      "Como revisar",
      mensagem.comoRevisar.map((p, i) => `${String(i + 1)}. ${neutro(p).replaceAll("\n", "\n   ")}`).join("\n"),
    ],
    ["Não verificado", lista(mensagem.naoVerificado, "Nada.")],
    ["Reversão", mensagem.reversao === undefined ? "Não declarada." : neutro(mensagem.reversao)],
    [
      "Autoria e custo",
      `Produzido por agentes pi na Fabriquinha.\n\n${tabela(
        ["Ticket", "Etapa", "Execuções", "Tokens", "Custo"],
        [
          ...relatorio.tickets.map((t) => [
            t.ticket,
            t.etapa,
            inteiro(t.execucoes),
            inteiro(t.tokensEntrada + t.tokensSaida + t.tokensCacheLeitura + t.tokensCacheEscrita),
            custo(t),
          ]),
          [
            "Total",
            "",
            plural(relatorio.total.execucoes, "execução", "execuções"),
            inteiro(
              relatorio.total.tokensEntrada +
                relatorio.total.tokensSaida +
                relatorio.total.tokensCacheLeitura +
                relatorio.total.tokensCacheEscrita,
            ),
            custo(relatorio.total),
          ],
        ],
      )}`,
    ],
  ];
  const completo =
    [marcaDoPRRodada(demanda, ticket), ...secoes.map(([titulo, texto]) => `## ${titulo}\n\n${texto.trim()}`)].join(
      "\n\n",
    ) + "\n";
  const titulo = tituloDoPRRodada(ag, rodada, mensagem.titulo);
  if (completo.length <= limite) return { titulo, completo, publicado: completo };
  const fim = `\n\n… corpo completo em ${refRodada}, evidência pr_aberto\n`;
  // Não deixa meio par de surrogates no fim do corte.
  const publicado = completo.slice(0, limite - fim.length).replace(/[\uD800-\uDBFF]$/, "") + fim;
  return { titulo, completo, publicado };
}
