// Banco legado em memória com os casos reais do backfill; os testes de backfill_demanda* partem dele.
import { DatabaseSync } from "node:sqlite";
import { migrar } from "./banco.ts";
import { MIGRACOES } from "./migracoes.ts";

export const SHA_3 = "3".repeat(40);
export const SHA_6 = "6".repeat(40);
export const SHA_5 = "5".repeat(40);
export const SHA_HUMANO = "9".repeat(40);
export const SHA_ARQ_A = "a".repeat(64);
export const SHA_ARQ_Z = "b".repeat(64);
const T = (dia: number) => `'2026-01-${String(dia).padStart(2, "0")}T00:00:00.000Z'`;

/**
 * I-1 concluída (PR, commits, devoluções, retrabalho, execuções, uso, evidências e anexos), I-2 arquivada (depende da I-1), I-3 cancelada no desenho,
 * I-4 cancelada no registro (sem título), I-5 em desenvolvimento (dependências com a I-1 nos dois sentidos, ticket falho com
 * instrução e devoluções, commit, decisão, execuções e anexo), e uma issue em andamento em cada outra fase migrável:
 * I-6 registro, I-7 desenho, I-8 aprovação do desenho (com duas propostas), I-9 revisão e I-10 encerramento.
 */
export function montarFixture(): DatabaseSync {
  const b = new DatabaseSync(":memory:");
  b.exec("PRAGMA foreign_keys = ON");
  migrar(b, MIGRACOES);
  b.exec(`
    INSERT INTO projeto (nome, repo, branch_base, hospedagem, testes, sonar_project_key, fitness)
      VALUES ('p', '/repo/p', 'main', 'github', '["t"]', 'k', '[{"nome":"f"}]');
    INSERT INTO issue (id, projeto, titulo, tipo, descricao, fase, criada_em, concluida_em, arquivada_em, cancelada_em) VALUES
      (1, 'p', 'Concluída', 'problema', 'd1', 'concluida', ${T(1)}, ${T(9)}, NULL, NULL),
      (2, 'p', 'Arquivada', 'funcionalidade', 'd2', 'concluida', ${T(2)}, ${T(10)}, ${T(11)}, NULL),
      (3, 'p', 'Cancelada no desenho', 'funcionalidade', 'd3', 'desenho', ${T(3)}, NULL, NULL, ${T(12)}),
      (4, 'p', NULL, NULL, '', 'registro', ${T(4)}, NULL, NULL, ${T(13)}),
      (5, 'p', 'Em andamento', 'funcionalidade', 'd5', 'desenvolvimento', ${T(5)}, NULL, NULL, NULL),
      (6, 'p', 'No registro', 'problema', 'd6', 'registro', ${T(6)}, NULL, NULL, NULL),
      (7, 'p', 'No desenho', 'funcionalidade', 'd7', 'desenho', ${T(7)}, NULL, NULL, NULL),
      (8, 'p', 'Aprovando o desenho', 'funcionalidade', 'd8', 'aprovacao_desenho', ${T(8)}, NULL, NULL, NULL),
      (9, 'p', 'Em revisão', 'funcionalidade', 'd9', 'revisao', ${T(9)}, NULL, NULL, NULL),
      (10, 'p', 'Encerrando', 'funcionalidade', 'd10', 'encerramento', ${T(10)}, NULL, NULL, NULL);
    INSERT INTO issue_dep (issue, dep) VALUES (2, 1), (1, 5), (5, 1);
    INSERT INTO ticket (id, issue, etapa, titulo, descricao, status, origem, origem_ticket, modelo_provedor, modelo_nome, instrucao, erro, criado_em, concluido_em, enviado_em, devolucoes) VALUES
      (1, 1, 'registro', 'Registro', 'r', 'concluido', 'auditor', NULL, NULL, NULL, NULL, NULL, ${T(1)}, ${T(1)}, ${T(1)}, NULL),
      (2, 1, 'desenho', 'Desenho', 'r', 'concluido', 'fabriquinha', NULL, 'anthropic', 'opus', NULL, NULL, ${T(2)}, ${T(3)}, ${T(2)}, NULL),
      (3, 1, 'desenvolvimento', 'Dev A', 'r', 'concluido', 'fabriquinha', NULL, 'anthropic', 'sonnet', 'refaça', NULL, ${T(4)}, ${T(5)}, NULL, 2),
      (4, 1, 'desenvolvimento', 'Dev B', 'r', 'falhou', 'agente', 3, NULL, NULL, NULL, 'quebrou', ${T(5)}, NULL, NULL, NULL),
      (5, 1, 'revisao', 'Revisão', 'r', 'concluido', 'fabriquinha', NULL, NULL, NULL, NULL, NULL, ${T(6)}, ${T(7)}, NULL, 1),
      (6, 2, 'desenvolvimento', 'Dev', 'r', 'concluido', 'externo', NULL, NULL, NULL, NULL, NULL, ${T(7)}, ${T(8)}, NULL, NULL),
      (7, 3, 'registro', 'Registro', 'r', 'concluido', 'auditor', NULL, NULL, NULL, NULL, NULL, ${T(3)}, ${T(3)}, ${T(3)}, NULL),
      (8, 3, 'desenho', 'Desenho', 'r', 'falhou', 'fabriquinha', NULL, NULL, NULL, 'sem rumo', 'erro do desenho', ${T(4)}, NULL, ${T(4)}, NULL),
      (9, 4, 'registro', 'Registro', 'r', 'cancelado', 'auditor', NULL, NULL, NULL, NULL, NULL, ${T(4)}, NULL, NULL, NULL),
      (10, 5, 'desenvolvimento', 'Dev', 'r', 'aberto', 'fabriquinha', NULL, NULL, NULL, NULL, NULL, ${T(5)}, NULL, NULL, NULL),
      (11, 5, 'desenvolvimento', 'Dev falho', 'r', 'falhou', 'agente', 10, 'anthropic', 'haiku', 'ajuste', 'falhou aqui', ${T(6)}, NULL, NULL, 2),
      (12, 6, 'registro', 'Registro', 'r', 'aberto', 'auditor', NULL, NULL, NULL, NULL, NULL, ${T(6)}, NULL, NULL, NULL),
      (13, 7, 'registro', 'Registro', 'r', 'concluido', 'auditor', NULL, NULL, NULL, NULL, NULL, ${T(7)}, ${T(7)}, ${T(7)}, NULL),
      (14, 7, 'desenho', 'Desenho', 'r', 'aberto', 'fabriquinha', NULL, NULL, NULL, NULL, NULL, ${T(8)}, NULL, NULL, NULL),
      (15, 7, 'desenvolvimento', 'Proposta solta', 'r', 'aberto', 'agente', 14, NULL, NULL, NULL, NULL, ${T(8)}, NULL, NULL, NULL),
      (16, 8, 'registro', 'Registro', 'r', 'concluido', 'auditor', NULL, NULL, NULL, NULL, NULL, ${T(8)}, ${T(8)}, ${T(8)}, NULL),
      (17, 8, 'desenho', 'Desenho', 'r', 'em_execucao', 'fabriquinha', NULL, NULL, NULL, NULL, NULL, ${T(9)}, NULL, ${T(10)}, NULL),
      (18, 8, 'desenvolvimento', 'Proposta A', 'a', 'aberto', 'agente', 17, 'anthropic', 'sonnet', NULL, NULL, ${T(10)}, NULL, NULL, NULL),
      (19, 8, 'desenvolvimento', 'Proposta B', 'b', 'aberto', 'agente', 17, NULL, NULL, NULL, NULL, ${T(10)}, NULL, NULL, NULL),
      (20, 9, 'desenvolvimento', 'Dev', 'r', 'concluido', 'fabriquinha', NULL, NULL, NULL, NULL, NULL, ${T(9)}, ${T(10)}, NULL, NULL),
      (21, 9, 'revisao', 'Revisão', 'r', 'aberto', 'fabriquinha', NULL, NULL, NULL, NULL, NULL, ${T(10)}, NULL, NULL, NULL),
      (22, 10, 'desenvolvimento', 'Dev', 'r', 'concluido', 'fabriquinha', NULL, NULL, NULL, NULL, NULL, ${T(10)}, ${T(11)}, NULL, NULL),
      (23, 10, 'revisao', 'Revisão', 'r', 'concluido', 'fabriquinha', NULL, NULL, NULL, NULL, NULL, ${T(11)}, ${T(12)}, NULL, NULL),
      (24, 10, 'encerramento', 'Encerramento', 'r', 'aberto', 'fabriquinha', NULL, NULL, NULL, NULL, NULL, ${T(12)}, NULL, NULL, NULL);
    INSERT INTO decisao (id, issue, ticket, gate, aprovado, motivo, nota, por, em) VALUES
      (1, 1, 2, 'desenho', 0, 'refaça', NULL, 'auditor', ${T(2)}),
      (2, 1, 2, 'desenho', 1, NULL, NULL, 'auditor', ${T(3)}),
      (3, 1, 3, 'revisao', 1, NULL, NULL, 'agente', ${T(7)}),
      (4, 1, 5, 'pr', 1, NULL, 5, 'auditor', ${T(9)}),
      (5, 5, 11, 'revisao', 0, 'refaça', NULL, 'agente', ${T(7)});
    INSERT INTO commit_ticket (sha, ticket, mensagem, em) VALUES
      ('${SHA_3}', 3, 'feat: a', ${T(5)}), ('${SHA_6}', 6, 'feat: b', ${T(8)}), ('${SHA_5}', 11, 'feat: c', ${T(7)});
    INSERT INTO arquivo_commit (sha, caminho, caminho_anterior, status, adicionadas, removidas) VALUES
      ('${SHA_3}', 'a.ts', NULL, 'A', 10, 0), ('${SHA_3}', 'b.ts', 'c.ts', 'R', 1, 1), ('${SHA_6}', 'a.ts', NULL, 'M', NULL, NULL), ('${SHA_5}', 'e.ts', NULL, 'A', 3, 0);
    INSERT INTO retrabalho (commit_alterador, ticket, autor, ticket_origem, linhas) VALUES
      ('${SHA_6}', 6, NULL, 3, 4),
      ('${SHA_3}', 3, NULL, 4, 2),
      ('${SHA_HUMANO}', NULL, 'Ana', 3, 7);
    INSERT INTO execucao (id, ticket, modo, sessao_pi, modelo_provedor, modelo_nome, pgid_pi, resultado, erro, iniciada_em, terminada_em) VALUES
      (1, 2, 'interativo', 'pi-2', 'anthropic', 'opus', 0, 'sucesso', NULL, ${T(2)}, ${T(3)}),
      (2, 3, 'autonomo', 'pi-3', 'anthropic', 'sonnet', 4242, 'falha', 'caiu', ${T(4)}, ${T(4)}),
      (3, 3, 'consulta', 'pi-3', NULL, NULL, NULL, 'sucesso', NULL, ${T(5)}, ${T(5)}),
      (4, 6, 'autonomo', 'pi-6', NULL, NULL, NULL, 'em_andamento', NULL, ${T(8)}, NULL),
      (5, 10, 'autonomo', 'pi-10', NULL, NULL, NULL, 'sucesso', NULL, ${T(5)}, ${T(5)}),
      (6, 11, 'autonomo', 'pi-11', 'anthropic', 'haiku', 77, 'falha', 'sem rede', ${T(6)}, ${T(7)});
    INSERT INTO uso (execucao, provedor, modelo, chamadas, input, output, cache_read, cache_write, custo) VALUES
      (1, 'anthropic', 'opus', 3, 100, 50, 10, 5, 0),
      (2, 'anthropic', 'sonnet', 2, 200, 80, 0, 0, 0.5),
      (2, 'anthropic', 'haiku', 1, 0, 0, 0, 0, 0),
      (5, 'anthropic', 'sonnet', 1, 1, 1, 1, 1, 0),
      (6, 'anthropic', 'haiku', 4, 30, 20, 0, 0, 1.25);
    INSERT INTO evidencia (id, ticket, tipo, produtor, aprovada, dados, em) VALUES
      (1, 2, 'desenho_solucao', 'agente', 1, '{"a":1}', ${T(3)}),
      (2, 3, 'pr_aberto', 'fabriquinha', NULL, '{"n":1}', ${T(6)}),
      (3, 5, 'pr_aberto', 'fabriquinha', 1, '{"n":2}', ${T(9)}),
      (4, 6, 'pr_aberto', 'fabriquinha', NULL, '{}', ${T(8)}),
      (5, 8, 'desenho_solucao', 'agente', 0, '{}', ${T(4)}),
      (6, 10, 'comportamento', 'agente', NULL, '{}', ${T(5)}),
      (7, 11, 'comportamento', 'agente', 0, '{"b":2}', ${T(7)});
    INSERT INTO evidencia_arquivo (evidencia, nome, sha256, mime, bytes) VALUES
      (1, 'z.png', '${SHA_ARQ_Z}', 'image/png', 10), (1, 'a.png', '${SHA_ARQ_A}', 'image/png', 20),
      (6, 'x.txt', '${"d".repeat(64)}', 'text/plain', 0),
      (7, 'y.txt', '${"e".repeat(64)}', 'text/plain', 7);
  `);
  return b;
}
