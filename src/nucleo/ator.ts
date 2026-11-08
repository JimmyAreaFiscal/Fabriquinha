// Quem age: o Ator é o único tipo de autoria da Fabriquinha (CONCEITOS.md §15); as transições da demanda recebem o
// ator e checam se ele pode agir. É também o autor das evidências, o criador de um ticket e quem decide.
import { z } from "zod";
import { ErroDeEscopo } from "./erros.ts";
import { TrabalhoNaoGerenciado } from "./trabalho_agentico.ts";

/** A IA de fora da Fabriquinha: a ferramenta e a sessão que registraram a demanda. */
export const AtorExterno = z.object({ tipo: z.literal("externo"), ...TrabalhoNaoGerenciado.shape });

export const Ator = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("auditor") }),
  // shortcut: o trabalho é o `processo_do_trabalho.id`; a 12 troca pelo Id do trabalho inteiro.
  z.object({ tipo: z.literal("agente"), trabalho_id: z.string().min(1) }),
  AtorExterno,
  z.object({ tipo: z.literal("fabriquinha") }),
]);

export type Ator = z.infer<typeof Ator>;

/** Os atores sem dados: o Auditor e a própria Fabriquinha. */
export const AUDITOR: Ator = { tipo: "auditor" };
export const FABRIQUINHA: Ator = { tipo: "fabriquinha" };

const QUEM_PODE: Readonly<Record<Ator["tipo"], { nome: string; orientacao: string }>> = {
  auditor: { nome: "o Auditor", orientacao: "peça ao Auditor pelo web" },
  agente: { nome: "o Agente", orientacao: "peça à sessão do agente" },
  externo: { nome: "a IA externa", orientacao: "peça à ferramenta que registrou a demanda" },
  fabriquinha: { nome: "a Fabriquinha", orientacao: "ela faz isso sozinha ao executar o ticket" },
};

/** Recusa o ator que não é de um dos tipos `permitidos` para `acao`. */
export function exigirAtor(ator: Ator, acao: string, ...permitidos: Ator["tipo"][]): void {
  if (permitidos.includes(ator.tipo)) return;
  throw new ErroDeEscopo(
    `só ${permitidos.map((tipo) => QUEM_PODE[tipo].nome).join(" ou ")} pode ${acao}`,
    permitidos.map((tipo) => QUEM_PODE[tipo].orientacao).join("; "),
  );
}
