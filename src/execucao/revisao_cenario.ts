// Cenário compartilhado dos testes da revisão: git real temporário, banco real e um pi falso que só registra onde rodou.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after } from "node:test";
import { abrirBancoTemporario } from "../../apoio-testes/banco_temporario.ts";
import { instalarPiFalso } from "../../apoio-testes/pi_falso.ts";
import type { AgregadoDemanda } from "../dominio/agregado_demanda.ts";
import { gravarConfiguracaoProjeto, substituirPreparacaoDoProjeto } from "../persistencia/configuracao_projeto.ts";
import { criarDemanda } from "../persistencia/demandas.ts";
import { criarRepositorioDeTeste } from "../../apoio-testes/repositorio_de_teste.ts";
import { garantirWorktreeDemanda } from "../repositorio/worktree-demanda.ts";

const em = "2026-01-01T00:00:00.000Z";
const temporario = mkdtempSync(join(tmpdir(), "fabriquinha-revisao-"));
process.env.PI_CODING_AGENT_DIR = join(temporario, "pi-agent");
delete process.env.FABRIQUINHA_PORTA;

const abertos: DatabaseSync[] = [];
after(() => {
  for (const b of abertos) b.close();
});

export const REF_RODADA = { demanda_id: "I-1", ticket_id: 2 };
export const REF_GLOBAL = { demanda_id: "I-1", ticket_id: 3 };

/**
 * Projeto `loja`, demanda I-1. Padrão: em execução, rodada 1 em `revisao` (implementar T1 concluído, revisar_rodada
 * T2 aberto), com a worktree da demanda criada. Com `integral`: em `revisao_demanda`, rodada 1 concluída, revisar_demanda T3 aberto.
 */
export async function cenarioRevisao({ integral = false } = {}) {
  const c = criarRepositorioDeTeste();
  const { banco } = abrirBancoTemporario(c.raiz);
  abertos.push(banco);
  banco
    .prepare(
      `INSERT INTO projeto (nome, repo, branch_base, hospedagem, sonar_project_key)
       VALUES ('loja', ?, 'integracao', 'github', 'k')`,
    )
    .run(c.repo);
  gravarConfiguracaoProjeto(banco, {
    nome: "loja",
    branch_base: "integracao",
    chave_sonarqube: "k",
    raiz_git: c.repo,
    hospedagem: "github",
    etapas: [],
    fitness: [{ nome: "f", comando: "true", descricao: "d" }],
    linguagens: [{ caminho: ".", linguagem: "ts", comando_teste: "true" }],
  });
  substituirPreparacaoDoProjeto(banco, "loja", ["true"]);
  const ticket = (ticket_id: number, etapa: string, extra: object = {}) => ({
    demanda_id: "I-1",
    ticket_id,
    etapa,
    status: "aberto",
    status_alterado_em: em,
    devolucoes: 0,
    ...extra,
  });
  criarDemanda(banco, {
    demanda: {
      id: "I-1",
      projeto: "loja",
      titulo: "t",
      tipo: "funcionalidade",
      descricao: "d",
      fase: integral ? "revisao_demanda" : "execucao",
      fase_alterada_em: em,
      origem_ferramenta: "claude",
      origem_sessao: "s1",
      enviada: true,
      branch: "fabriquinha/I-1",
    },
    rodadas: [
      {
        demanda_id: "I-1",
        rodada_id: 1,
        titulo: "r1",
        fase: integral ? "concluida" : "revisao",
        e2e: false,
        branch: "fabriquinha/I-1-1",
      },
    ],
    dependencias_rodada: [],
    criterios_citados: [],
    tickets: [
      ticket(1, "implementar", { rodada_id: 1, status: "concluido" }),
      ticket(2, "revisar_rodada", { rodada_id: 1, ...(integral && { status: "concluido" }) }),
      ticket(3, "revisar_demanda"),
    ],
    dependencias_ticket: [],
    caminhos_ticket: [],
    decisoes: [],
    evidencias: [],
  } as unknown as AgregadoDemanda);
  await garantirWorktreeDemanda(c.raiz, c.projeto, "I-1", c.log, () => Promise.resolve());
  const piFalso = instalarPiFalso(c.dir);
  return {
    c,
    banco,
    piFalso,
    /** As pastas em que o pi falso rodou. */
    pastas: () =>
      piFalso
        .registro()
        .filter((entrada) => entrada.evento === "inicio")
        .map((entrada) => entrada.cwd),
  };
}
