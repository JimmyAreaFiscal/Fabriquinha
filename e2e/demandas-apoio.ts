// Apoio dos testes do quadro de demandas: semeia as demandas no banco da instância, sobre o `projeto()` de apoio.ts.
import type { AgregadoDemanda } from "../src/dominio/agregado_demanda.ts";
import { abrir } from "../src/persistencia/banco.ts";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { gravarConfiguracaoProjeto } from "../src/persistencia/configuracao_projeto.ts";
import { guardarBytes } from "../src/persistencia/arquivos.ts";
import { criarDemanda } from "../src/persistencia/demandas.ts";
import { gravarAnexos } from "../src/persistencia/evidencia_demanda.ts";

const em = "2026-10-11T12:00:00.000Z";

const ticket = (demanda_id: string, ticket_id: number, etapa: string, rodada_id: number, status: string) => ({
  demanda_id,
  ticket_id,
  etapa,
  status,
  status_alterado_em: em,
  rodada_id,
  devolucoes: 0,
});

const rodada = (demanda_id: string, rodada_id: number, fase: string) => ({
  demanda_id,
  rodada_id,
  titulo: `rodada ${String(rodada_id)}`,
  fase,
  e2e: false,
  branch: `fabriquinha/${demanda_id}-${String(rodada_id)}`,
});

const demanda = (id: string, fase: string, resto: object = {}): AgregadoDemanda =>
  ({
    demanda: {
      id,
      projeto: "loja",
      titulo: `Demanda ${id}`,
      tipo: "funcionalidade",
      descricao: "d",
      fase,
      fase_alterada_em: em,
      origem_ferramenta: "claude",
      origem_sessao: id,
      enviada: true,
      branch: `fabriquinha/${id}`,
    },
    tickets: [],
    decisoes: [],
    evidencias: [],
    rodadas: [],
    dependencias_rodada: [],
    criterios_citados: [],
    dependencias_ticket: [],
    caminhos_ticket: [],
    ...resto,
  }) as unknown as AgregadoDemanda;

/** A demanda no gate de aprovação: o ticket `demanda` em execução, que a decisão conclui. */
const comTicketDeDemanda = (id: string): AgregadoDemanda =>
  demanda(id, "aprovacao_demanda", {
    tickets: [{ ...ticket(id, 1, "demanda", 1, "em_execucao"), rodada_id: undefined }],
  });

/** A I-214 aguardando a aprovação da demanda, com o ticket `demanda` em execução que a decisão conclui. */
export function semearGateDaDemanda(raiz: string): void {
  const banco = abrir(raiz);
  criarDemanda(banco, comTicketDeDemanda("I-214"));
  banco.close();
}

/**
 * I-206 em execução: R1 aguardando o PR 7 (aberto) e R2 sem PR, com o T3 em execução. I-207 em execução, com o T1 da R1
 * falho e dependente da I-206. I-208 aguardando a aprovação da demanda.
 */
export function semearDemandas(raiz: string): void {
  const banco = abrir(raiz);
  criarDemanda(
    banco,
    demanda("I-206", "execucao", {
      rodadas: [rodada("I-206", 1, "aprovacao_pull_request"), rodada("I-206", 2, "desenvolvimento")],
      tickets: [
        ticket("I-206", 1, "implementar", 1, "concluido"),
        ticket("I-206", 2, "encerrar_rodada", 1, "concluido"),
        ticket("I-206", 3, "implementar", 2, "em_execucao"),
      ],
      evidencias: [
        {
          demanda_id: "I-206",
          ticket_id: 2,
          tipo: "pr_aberto",
          dados: { id: "7", url: "https://exemplo.com/pr/7" },
          em,
        },
      ],
    }),
  );
  criarDemanda(
    banco,
    demanda("I-207", "execucao", {
      rodadas: [rodada("I-207", 1, "desenvolvimento")],
      tickets: [ticket("I-207", 1, "implementar", 1, "falhou")],
    }),
  );
  criarDemanda(banco, comTicketDeDemanda("I-208"));
  banco.exec("INSERT INTO dependencia_demanda (demanda_id, depende_demanda_id) VALUES ('I-207', 'I-206')");
  banco.close();
}

/** Uma demanda sem ticket algum: nada em execução. */
export function semearDemandaOciosa(raiz: string): void {
  const banco = abrir(raiz);
  criarDemanda(banco, demanda("I-209", "aprovacao_demanda"));
  banco.close();
}

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * I-210 em encerramento, dependente da I-211 (em execução): R1 com o PR 7 e a nota 4, R2 na sessão de ajustes, o T2
 * reprovado na revisão, o T5 falho, o T6 global e o print do PR anexado. O encerramento final integrou e a limpeza falhou.
 */
export function semearPaginaDaDemanda(raiz: string): void {
  const banco = abrir(raiz);
  const { sha256, bytes } = guardarBytes(banco, PNG);
  const decisao = (ticket_id: number, resultado: string, resto: object) => ({
    demanda_id: "I-210",
    ticket_id,
    decisao_id: ticket_id,
    resultado,
    por: "auditor",
    em,
    ...resto,
  });
  criarDemanda(
    banco,
    demanda("I-210", "encerramento", {
      rodadas: [rodada("I-210", 1, "aprovacao_pull_request"), rodada("I-210", 2, "sessao")],
      tickets: [
        ticket("I-210", 1, "implementar", 1, "concluido"),
        ticket("I-210", 2, "revisar_rodada", 1, "concluido"),
        ticket("I-210", 3, "encerrar_rodada", 1, "concluido"),
        ticket("I-210", 4, "implementar", 2, "concluido"),
        { ...ticket("I-210", 5, "implementar", 2, "falhou"), motivo_falha: "o teste de erro não passou" },
        { ...ticket("I-210", 6, "planejar", 1, "concluido"), rodada_id: undefined },
      ],
      decisoes: [
        decisao(2, "recusado", { motivo: "falta teste do caminho de erro" }),
        decisao(3, "aprovado", { nota: 4 }),
      ],
      evidencias: [
        {
          demanda_id: "I-210",
          ticket_id: 3,
          tipo: "pr_aberto",
          dados: { id: "7", url: "https://exemplo.com/pr/7" },
          em,
        },
      ],
      encerramento: {
        demanda_id: "I-210",
        pr: { numero: 9, url: "https://exemplo.com/pr/9" },
        branch: "fabriquinha/I-210",
        base: "main",
        sha_verificado: "abc123",
        integracao: { sha: "def456" },
        limpeza_pendente: ["worktree da rodada 1"],
        falha: { etapa: "limpeza", motivo: "não consegui apagar a worktree" },
      },
    }),
  );
  gravarAnexos(banco, { demanda_id: "I-210", ticket_id: 3, tipo: "pr_aberto" }, [
    { caminho: "print.png", sha256, mime: "image/png", bytes },
  ]);
  criarDemanda(banco, demanda("I-211", "execucao"));
  banco.exec("INSERT INTO dependencia_demanda (demanda_id, depende_demanda_id) VALUES ('I-210', 'I-211')");
  banco.close();
}

/** A demanda no gate do planejamento: o ticket `planejar` em execução e o plano submetido, com uma rodada. */
const comPlano = (id: string): AgregadoDemanda =>
  demanda(id, "aprovacao_planejamento", {
    tickets: [{ ...ticket(id, 1, "planejar", 1, "em_execucao"), rodada_id: undefined }],
    evidencias: [
      {
        demanda_id: id,
        tipo: "criterios_aceite",
        dados: { criterios: [{ id: "CA-1", dado: "d", quando: "q", entao: "e" }] },
        em,
      },
      {
        demanda_id: id,
        ticket_id: 1,
        tipo: "plano",
        dados: {
          demanda_id: id,
          criterios: ["CA-1"],
          rodadas: [{ demanda_id: id, rodada_id: 1, titulo: "r1", e2e: false, criterios: ["CA-1"], depende: [] }],
          tickets: [{ demanda_id: id, ticket_id: 1, rodada_id: 1, titulo: "t1", descricao: "d" }],
        },
        em,
      },
    ],
  });

/** O projeto `loja` com a configuração do SDLC, que as decisões que integram exigem. */
function configurarProjeto(banco: ReturnType<typeof abrir>, raiz: string): void {
  gravarConfiguracaoProjeto(banco, {
    nome: "loja",
    branch_base: "main",
    chave_sonarqube: "loja",
    raiz_git: join(raiz, "loja"),
    hospedagem: "github",
    etapas: [],
    preparacao: [{ ordem: 1, comando: "true" }],
    fitness: [{ nome: "f", comando: "true", descricao: "d" }],
    linguagens: [{ caminho: ".", linguagem: "ts", comando_teste: "true" }],
  });
}

/** I-212 e I-213 com o planejamento aguardando aprovação. */
export function semearPlanejamento(raiz: string): void {
  const banco = abrir(raiz);
  configurarProjeto(banco, raiz);
  criarDemanda(banco, comPlano("I-212"));
  criarDemanda(banco, comPlano("I-213"));
  banco.close();
}

/** I-215 com a R1 aguardando o PR 9 (aberto); o ticket `encerrar_rodada` em execução é o que a decisão conclui. */
export function semearPrDaRodada(raiz: string): void {
  // A reprovação grava o marco na worktree da demanda, que precisa existir.
  execFileSync(
    "git",
    ["worktree", "add", "-q", "-b", "fabriquinha/I-215", join(raiz, "worktrees/loja/I-215/demanda"), "main"],
    {
      cwd: join(raiz, "loja"),
    },
  );
  // A aprovação integra: o gh falso já vê o PR 9 mergeado, e a branch da demanda está no remoto para o fast-forward.
  execFileSync("git", ["push", "-q", "origin", "fabriquinha/I-215"], { cwd: join(raiz, "loja") });
  writeFileSync(
    join(raiz, "gh-pr.json"),
    JSON.stringify({ state: "MERGED", url: "https://exemplo.com/pr/9", mergedAt: em, mergeCommit: { oid: "abc" } }),
  );
  const banco = abrir(raiz);
  configurarProjeto(banco, raiz);
  criarDemanda(
    banco,
    demanda("I-215", "execucao", {
      rodadas: [rodada("I-215", 1, "aprovacao_pull_request")],
      tickets: [ticket("I-215", 1, "encerrar_rodada", 1, "em_execucao")],
      evidencias: [
        {
          demanda_id: "I-215",
          ticket_id: 1,
          tipo: "pr_aberto",
          dados: { id: "9", url: "https://exemplo.com/pr/9", branch: "fabriquinha/I-215-1", head: "abc" },
          em,
        },
      ],
    }),
  );
  banco.close();
}

/** I-216 com o T1 aberto na R1 em desenvolvimento: pronto para o Executar agora. */
export function semearTicketAberto(raiz: string): void {
  // A execução parte da worktree da demanda, que precisa existir e ser da Fabriquinha.
  const caminho = join(raiz, "worktrees/loja/I-216/demanda");
  const repo = join(raiz, "loja");
  execFileSync("git", ["worktree", "add", "-q", "-b", "fabriquinha/I-216", caminho, "main"], { cwd: repo });
  execFileSync("git", ["config", "branch.fabriquinha/I-216.fabriquinha", `demanda:${caminho}`], { cwd: repo });
  const banco = abrir(raiz);
  configurarProjeto(banco, raiz);
  criarDemanda(
    banco,
    demanda("I-216", "execucao", {
      rodadas: [rodada("I-216", 1, "desenvolvimento")],
      tickets: [ticket("I-216", 1, "implementar", 1, "aberto")],
    }),
  );
  banco.close();
}
