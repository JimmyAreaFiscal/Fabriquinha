// Rotas do gate do desenho (F7 §4.2, "Tickets e gates"): o Auditor ajusta os tickets propostos (C11 a C13), troca o
// modelo de um ticket (C20, com o par conferido no pi, F4 §9) e decide o desenho (C15), que, reprovado, volta à sessão.
import { z } from "zod";
import { AUDITOR } from "../../dominio/agregado.ts";
import { definirModeloTicket } from "../../dominio/execucao.ts";
import { Modelo } from "../../dominio/primitivos.ts";
import { adicionarTicketDesenvolvimento, editarTicket, removerTicket } from "../../dominio/tickets.ts";
import { conferirModelo } from "../../execucao/modelos.ts";
import { decidirGate } from "../../execucao/sessoes.ts";
import { comIssue, issueDoTicket } from "../../persistencia/issues.ts";
import { type Rota, IdDoCaminho } from "../rotas.ts";
import { DecisaoDoGate, opcoes } from "./chat.ts";

/** Confere o modelo no pi antes de gravar: o recusado não chega ao banco. */
const conferir = async (modelo: Modelo | null | undefined): Promise<void> => {
  if (modelo) await conferirModelo(modelo);
};

export const ROTAS_DO_DESENHO: Rota[] = [
  {
    metodo: "POST",
    caminho: "/api/issues/:id/tickets",
    tratar: async ({ banco, params, corpo }) => {
      const issue = IdDoCaminho.parse(params.id);
      await conferir(z.object({ modelo: Modelo.optional() }).parse(corpo).modelo);
      comIssue(banco, issue, "adicionarTicketDesenvolvimento", AUDITOR, (ag, ctx) =>
        adicionarTicketDesenvolvimento(ag, corpo, AUDITOR, ctx),
      );
    },
  },
  {
    metodo: "POST",
    caminho: "/api/tickets/:id",
    tratar: ({ banco, params, corpo }) => {
      const ticket = IdDoCaminho.parse(params.id);
      comIssue(banco, issueDoTicket(banco, ticket), "editarTicket", AUDITOR, (ag) =>
        editarTicket(ag, { ...z.object({}).loose().parse(corpo), ticket }, AUDITOR),
      );
    },
  },
  {
    metodo: "DELETE",
    caminho: "/api/tickets/:id",
    tratar: ({ banco, params }) => {
      const ticket = IdDoCaminho.parse(params.id);
      comIssue(banco, issueDoTicket(banco, ticket), "removerTicket", AUDITOR, (ag) =>
        removerTicket(ag, { ticket }, AUDITOR),
      );
    },
  },
  {
    metodo: "POST",
    caminho: "/api/tickets/:id/modelo",
    tratar: async ({ banco, params, corpo }) => {
      const ticket = IdDoCaminho.parse(params.id);
      const { modelo } = z.strictObject({ modelo: Modelo.nullable() }).parse(corpo);
      await conferir(modelo);
      comIssue(banco, issueDoTicket(banco, ticket), "definirModeloTicket", AUDITOR, (ag) =>
        definirModeloTicket(ag, { ticket, modelo }, AUDITOR),
      );
    },
  },
  {
    metodo: "POST",
    caminho: "/api/issues/:id/desenho",
    tratar: async ({ banco, params, corpo }) => {
      const decisao = DecisaoDoGate.parse(corpo);
      await decidirGate(banco, IdDoCaminho.parse(params.id), "desenho", decisao, opcoes(banco));
    },
  },
];
