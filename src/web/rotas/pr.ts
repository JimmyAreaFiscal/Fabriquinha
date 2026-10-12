// Rotas do gate do PR (F7 §4.2): o estado do PR lido agora na plataforma (F5 §5.2) e a decisão do Auditor (C16), que
// encerra a issue com a nota e remove a worktree (F5 §5.3) ou pede mudanças com o motivo, abrindo a sessão em aberto.
// A falha do `gh` ou do `az` é ErroExterno (502); o estado que não permite a decisão, ErroDeRegra (409).
import { EntradaPR } from "../../dominio/gates.ts";
import { encerrarIssue, pedirMudancas } from "../../execucao/sessoes.ts";
import { estadoPR } from "../../repositorio/pr.ts";
import type { Rota } from "../rotas.ts";
import { opcoes } from "./chat.ts";
import { IdDoCaminho, issueExistente, projetoDa } from "./issue.ts";

export const ROTAS_DO_PR: Rota[] = [
  {
    metodo: "GET",
    caminho: "/api/issues/:id/pr",
    tratar: ({ banco, params }) => {
      const ag = issueExistente(banco, IdDoCaminho.parse(params.id));
      return estadoPR(projetoDa(banco, ag), ag);
    },
  },
  {
    // Encerrar devolve os avisos da limpeza que falhou, que não desfazem o encerramento; pedir mudanças, a sessão.
    metodo: "POST",
    caminho: "/api/issues/:id/pr",
    tratar: async ({ banco, params, corpo }) => {
      const issue = IdDoCaminho.parse(params.id);
      const decisao = EntradaPR.parse(corpo);
      return decisao.aprovado
        ? { avisos: await encerrarIssue(banco, issue, decisao.nota) }
        : { sessao: await pedirMudancas(banco, issue, decisao.motivo, opcoes(banco)) };
    },
  },
];
