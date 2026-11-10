// O cenário do Início: uma demanda em cada lugar do board, num banco com o projeto `loja`, usado pelos testes da consulta e da rota.
import type { DatabaseSync } from "node:sqlite";
import { Endereco } from "../src/nucleo/item_de_trabalho.ts";
import { gravarAgregadoPronto, montarAgregadoDemanda } from "./cenarios_de_demanda.ts";

export const em = (minuto: number) => `2026-01-01T00:${String(minuto).padStart(2, "0")}:00.000Z`;

export const ticket = (demanda_id: string, ticket_id: number, etapa: string, status: string, extra: object = {}) => ({
  demanda_id,
  ticket_id,
  etapa,
  estado: status,
  estado_alterado_em: em(ticket_id),
  criado_por: { tipo: "fabriquinha" },
  ...extra,
});

export const rodada = (demanda_id: string, rodada_id: number, estado: string) => ({
  demanda_id,
  rodada_id,
  titulo: `rodada ${String(rodada_id)}`,
  estado,
  estado_alterado_em: "2026-01-01T00:00:00.000Z",
  e2e: false,
  branch: `fabriquinha/${demanda_id}-${String(rodada_id)}`,
});

/**
 * Uma demanda em cada lugar do board: I-300 no registro (com a conversa interativa parada), I-301 e I-302 nos gates da
 * demanda e do plano, I-303 em execução com uma rodada em cada estado, I-304 no encerramento com o ticket global falho e
 * I-305 na revisão, bloqueada pela I-303, e I-307 em execução com a única rodada concluída. A I-306 concluiu e fica
 * fora.
 */
export function cenarioDoInicio(banco: DatabaseSync): void {
  banco.exec(`INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube)
    VALUES ('loja', '/repos/loja', 'main', 'github', 'k')`);
  gravarAgregadoPronto(
    banco,
    montarAgregadoDemanda("I-300", "entender_e_desenhar", {
      tickets: [ticket("I-300", 1, "entender_e_desenhar", "aberto")],
    }),
  );
  gravarAgregadoPronto(
    banco,
    montarAgregadoDemanda("I-301", "gate_demanda", {
      tickets: [ticket("I-301", 1, "entender_e_desenhar", "em_execucao")],
    }),
  );
  gravarAgregadoPronto(banco, montarAgregadoDemanda("I-302", "gate_planejamento"));
  gravarAgregadoPronto(
    banco,
    montarAgregadoDemanda("I-303", "em_execucao", {
      rodadas: [
        rodada("I-303", 1, "concluida"),
        rodada("I-303", 2, "gate_pr"),
        rodada("I-303", 3, "ajustar_resultado"),
        rodada("I-303", 4, "implementar"),
        rodada("I-303", 5, "gate_pr"),
      ],
      tickets: [
        ticket("I-303", 1, "implementar", "concluido", { rodada_id: 1 }),
        ticket("I-303", 2, "encerrar_rodada", "concluido", { rodada_id: 2 }),
        ticket("I-303", 3, "ajustar_resultado", "em_execucao", { rodada_id: 3 }),
        ticket("I-303", 4, "implementar", "aberto", { rodada_id: 4 }),
        ticket("I-303", 5, "implementar", "em_execucao", { rodada_id: 4, titulo: "Busca por cupom" }),
        ticket("I-303", 6, "implementar", "falhou", { rodada_id: 4 }),
        ticket("I-303", 7, "implementar", "em_execucao", { rodada_id: 4 }),
      ],
      tentativas: [
        {
          ticket: Endereco.doTicket("I-303", 6),
          numero: 1,
          inicio: em(0),
          fim: em(6),
          processo_id: "x6",
          resultado: { tipo: "interrompida", por: { tipo: "fabriquinha" }, motivo: "testes falharam" },
        },
      ],
      evidencias: [
        {
          demanda_id: "I-303",
          ticket_id: 2,
          tipo: "pr_aberto",
          autor: { tipo: "fabriquinha" },
          dados: { id: "7", url: "https://pr/7" },
          em: em(2),
        },
      ],
      pull_requests: [
        { rodada_id: 1, numero: 6, url: "https://pr/6", head: "abc", estado: "integrado", atualizado_em: em(2) },
        { rodada_id: 2, numero: 7, url: "https://pr/7", head: "abc", estado: "aberto", atualizado_em: em(2) },
      ],
    }),
  );
  gravarAgregadoPronto(
    banco,
    montarAgregadoDemanda("I-304", "encerrar_demanda", { tickets: [ticket("I-304", 8, "encerrar_demanda", "falhou")] }),
  );
  gravarAgregadoPronto(banco, montarAgregadoDemanda("I-305", "revisar_demanda"));
  gravarAgregadoPronto(banco, montarAgregadoDemanda("I-306", "concluida"));
  // I-307: rodadas concluídas, mas a regra recusa a revisão integral pela implementação cancelada.
  gravarAgregadoPronto(
    banco,
    montarAgregadoDemanda("I-307", "em_execucao", {
      rodadas: [rodada("I-307", 1, "concluida")],
      tickets: [
        ticket("I-307", 1, "implementar", "concluido", { rodada_id: 1 }),
        ticket("I-307", 9, "implementar", "cancelado", { rodada_id: 1 }),
      ],
    }),
  );
  // I-308 acabou de concluir a última rodada (o agendador ainda tem o ciclo); I-309 a regra aceita, mas nada abriu.
  for (const [id, quando] of [
    ["I-308", new Date().toISOString()],
    ["I-309", em(10)],
  ] as const) {
    gravarAgregadoPronto(
      banco,
      montarAgregadoDemanda(id, "em_execucao", {
        rodadas: [rodada(id, 1, "concluida")],
        tickets: [
          ticket(id, 1, "implementar", "concluido", { rodada_id: 1, estado_alterado_em: quando }),
          ticket(id, 2, "implementar", "concluido", { rodada_id: 1, estado_alterado_em: em(1) }),
        ],
      }),
    );
  }
  banco.exec(`
    INSERT INTO dependencia_demanda (demanda_id, depende_demanda_id) VALUES ('I-305', 'I-303'), ('I-305', 'I-306');
    INSERT INTO trabalho_agentico VALUES
      ('s-conversa', 'I-300', 1, 'interativo', 'c1'),
      ('s-ajustes', 'I-303', 3, 'interativo', 'c3'),
      ('s-titulo', 'I-303', 5, 'autonomo', 'c5'),
      ('s-falha', 'I-303', 6, 'autonomo', 'c6'),
      ('s-viva', 'I-303', 7, 'autonomo', 'c7');
    INSERT INTO processo_do_trabalho (id, trabalho_id, inicio, fim, falha, grupo_processo) VALUES
      ('x1', 's-conversa', '${em(0)}', '${em(40)}', 0, NULL),
      ('x3', 's-ajustes', '${em(0)}', '${em(41)}', 0, NULL),
      ('x5', 's-titulo', '${em(30)}', NULL, 0, 4242),
      ('x6', 's-falha', '${em(0)}', '${em(6)}', 1, NULL),
      ('x7', 's-viva', '${em(31)}', NULL, 0, NULL);
  `);
}
