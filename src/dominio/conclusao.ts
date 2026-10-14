// C7 concluirTicket (F1 §5, §5.1): as pré-condições comuns a toda etapa, mais a regra e a transição de cada uma.
import { z } from "zod";
import {
  type Agregado,
  type Ator,
  type Contexto,
  exigirFabriquinha,
  rotuloIssue,
  type Ticket,
  type TipoEvidencia,
} from "./agregado.ts";
import { ErroDeRegra } from "./erros.ts";
import { exigirEvidencias } from "./evidencia.ts";
import { exigirSemExecucao, marcarConcluido, novoTicket, rotuloTicket, ticketDe } from "./execucao.ts";
import { type Etapa, type Fase, Id } from "./primitivos.ts";

/** Regra adicional e transição de uma etapa (F1 §5.1); recebe o agregado com o ticket já `concluido`. */
type Regra = (ag: Agregado, ticket: Ticket, ctx: Contexto) => Agregado;

const criouTicket = (ag: Agregado, ticket: Ticket): boolean =>
  ag.tickets.some((t) => t.etapa === "desenvolvimento" && t.origemTicket === ticket.id);

/** A evidência `tipo` do ticket saiu aprovada. */
const aprovada = (ag: Agregado, ticket: Ticket, tipo: TipoEvidencia): boolean =>
  ag.evidencias.some((e) => e.ticket === ticket.id && e.tipo === tipo && e.aprovada === true);

/** O que a revisão aprovada não pode ter (F1 §5.1, F3 §8), com a correção de cada um. */
const BARRA_APROVACAO: readonly [(ag: Agregado, ticket: Ticket) => boolean, string, string][] = [
  [criouTicket, "e criou ticket de desenvolvimento", "remove os tickets que criou ou reprova a revisão"],
  [
    (ag, t) => !aprovada(ag, t, "comprovacao_criterios"),
    "com critério de aceite não atendido",
    "reprova a revisão e cria um ticket de desenvolvimento para cada exigência",
  ],
  [
    (ag, t) => !aprovada(ag, t, "matriz_fitness"),
    "com fitness function reprovada",
    "reprova a revisão e cria um ticket de desenvolvimento para cada exigência",
  ],
];

/** Os nomes dos itens da lista `lista` nos `dados` da evidência `tipo` do ticket, em ordem alfabética. */
const nomesDe = (ag: Agregado, ticket: Ticket, tipo: TipoEvidencia, lista: string): string[] =>
  ag.evidencias
    .filter((e) => e.ticket === ticket.id && e.tipo === tipo)
    .flatMap((e) => (e.dados[lista] as { nome: string }[]).map((item) => item.nome))
    .toSorted((a, b) => a.localeCompare(b));

/** O desenho e a sessão em aberto só concluem com ticket de desenvolvimento criado; a issue vai a `fase`. */
const comTicketCriado =
  (quem: string, fase: Fase): Regra =>
  (ag, ticket) => {
    if (!criouTicket(ag, ticket)) {
      const t = rotuloTicket(ticket);
      throw new ErroDeRegra(
        `${t} não pode concluir: ${quem} não criou ticket de desenvolvimento`,
        `o agente de ${t} cria com fabriquinha ticket criar ${rotuloIssue(ag)} --titulo <título>`,
      );
    }
    return { ...ag, issue: { ...ag.issue, fase } };
  };

// O registro não conclui por C7 (C10); as demais etapas têm todas a sua regra.
const REGRAS: Record<Exclude<Etapa, "registro">, Regra> = {
  desenho: comTicketCriado("o desenho", "aprovacao_desenho"),
  sessao: comTicketCriado("a sessão em aberto", "desenvolvimento"),
  desenvolvimento: (ag, ticket, ctx) => {
    if (!ctx.temCommit(ticket.id)) {
      throw new ErroDeRegra(
        `${rotuloTicket(ticket)} não pode concluir: não tem commit registrado`,
        "a Fabriquinha commita depois que testes, fitness e SonarQube aprovam; execute o ticket de novo",
      );
    }
    if (ag.tickets.some((t) => t.etapa === "desenvolvimento" && t.status !== "concluido")) return ag;
    return {
      ...ag,
      issue: { ...ag.issue, fase: "revisao" },
      tickets: [...ag.tickets, novoTicket(ag, ctx, "revisao", "Revisar o desenvolvimento")],
    };
  },
  revisao: (ag, ticket, ctx) => {
    const t = rotuloTicket(ticket);
    // A regra cruzada do F3 §4.4 de novo: a explicação pode ter vindo de uma execução anterior, e a matriz é recoletada
    // antes de cada pi.
    const explicadas = nomesDe(ag, ticket, "explicacao_fitness", "explicacoes");
    if (explicadas.join() !== nomesDe(ag, ticket, "matriz_fitness", "linhas").join()) {
      throw new ErroDeRegra(
        `${t} não pode concluir: a explicacao_fitness não explica exatamente as linhas da matriz_fitness atual`,
        `o agente de ${t} submete de novo com fabriquinha evidencia add explicacao_fitness, uma explicação por linha`,
      );
    }
    const decisao = ag.decisoes.find((d) => d.gate === "revisao" && d.ticket === ticket.id);
    if (!decisao) {
      throw new ErroDeRegra(
        `${t} não pode concluir: não tem decisão de revisão`,
        `o agente de ${t} decide com fabriquinha revisao decidir ${t} aprovar|reprovar`,
      );
    }
    if (!decisao.aprovado) {
      if (!criouTicket(ag, ticket)) {
        throw new ErroDeRegra(
          `${t} não pode concluir: a revisão reprovou sem criar ticket de desenvolvimento`,
          `o agente de ${t} cria um para cada exigência com fabriquinha ticket criar ${rotuloIssue(ag)} --titulo <título>`,
        );
      }
      return { ...ag, issue: { ...ag.issue, fase: "desenvolvimento" } };
    }
    const barra = BARRA_APROVACAO.find(([barrou]) => barrou(ag, ticket));
    if (barra)
      throw new ErroDeRegra(`${t} não pode concluir: a revisão aprovou ${barra[1]}`, `o agente de ${t} ${barra[2]}`);
    return {
      ...ag,
      issue: { ...ag.issue, fase: "encerramento" },
      tickets: [...ag.tickets, novoTicket(ag, ctx, "encerramento", "Publicar o PR")],
    };
  },
  // As evidências do catálogo bastam: a Fabriquinha só registra pr_aberto depois de publicar o PR. O gate do PR só
  // recebe o PR limpo; senão, a issue volta ao desenvolvimento com um ticket que resolve o problema (F5 §5.1, passo 4).
  encerramento: (ag, ticket, ctx) => {
    const problemas = ctx.problemasPR;
    if (!problemas) {
      throw new ErroDeRegra(
        `${rotuloTicket(ticket)} não pode concluir: a situação do PR não foi verificada`,
        "a Fabriquinha verifica o PR depois de publicá-lo; execute o ticket de novo",
      );
    }
    const pr = ag.evidencias.findLast((e) => e.tipo === "pr_aberto")?.dados as { url: string; base: string };
    const linhas = problemas.checksFalhos.map((c) => (c.url ? `- ${c.nome}: ${c.url}` : `- ${c.nome}`));
    const [titulo, descricao] = problemas.conflito
      ? [
          `Resolver o conflito do PR com a branch base ${pr.base}`,
          `O PR ${pr.url} tem conflito com a branch base ${pr.base}. Na worktree, rode \`git fetch origin ${pr.base}\` e ` +
            `\`git merge --no-commit origin/${pr.base}\`, resolva os conflitos e rode os testes. Não faça commit: a ` +
            "Fabriquinha commita depois que testes, fitness e SonarQube aprovam.",
        ]
      : [
          `Corrigir os checks de CI falhos do PR: ${problemas.checksFalhos.map((c) => c.nome).join(", ")}`,
          `Os checks de CI do PR ${pr.url} terminaram falhos. Reproduza cada falha localmente, corrija e rode os ` +
            `testes:\n${linhas.join("\n")}`,
        ];
    if (!problemas.conflito && problemas.checksFalhos.length === 0) {
      return { ...ag, issue: { ...ag.issue, fase: "aprovacao_pr" } };
    }
    return {
      ...ag,
      issue: { ...ag.issue, fase: "desenvolvimento" },
      tickets: [...ag.tickets, novoTicket(ag, ctx, "desenvolvimento", titulo, descricao)],
    };
  },
};

const EntradaConclusao = z.object({ ticket: Id });

/** C7: ticket `concluido` e a transição da etapa, se o ticket já terminou de executar e tem as evidências. */
export function concluirTicket(ag: Agregado, entrada: unknown, ator: Ator, ctx: Contexto): Agregado {
  exigirFabriquinha(ator, "concluir um ticket");
  const { ticket: id } = EntradaConclusao.parse(entrada);
  const ticket = ticketDe(ag, id);
  const t = rotuloTicket(ticket);
  if (ticket.etapa === "registro") {
    throw new ErroDeRegra(
      `${t} é de registro e não conclui por concluirTicket`,
      "o Auditor o conclui no gate de registro",
    );
  }
  if (ticket.status !== "em_execucao") {
    throw new ErroDeRegra(`${t} tem status ${ticket.status}, não em_execucao`, "só se conclui ticket em execução");
  }
  exigirSemExecucao(ag, ticket, "concluir");
  exigirEvidencias(ag, ticket);
  const depois = marcarConcluido(ag, ticket, ctx.agora);
  return REGRAS[ticket.etapa](depois, ticketDe(depois, id), ctx);
}
