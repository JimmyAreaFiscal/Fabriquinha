// O cenário das sessões de ajustes do PR reprovado: banco real, git real (origin bare), pi falso e a demanda I-206 com a
// rodada 2 no gate do PR (ticket 8), as duas worktrees prontas e o PR publicado.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after } from "node:test";
import { setTimeout as dormir } from "node:timers/promises";
import { AUDITOR, type Ator } from "../src/nucleo/ator.ts";
import type { AgregadoDemanda } from "../src/nucleo/agregado_demanda.ts";
import { Endereco } from "../src/nucleo/item_de_trabalho.ts";
import { registrarCorrecoesSessao } from "../src/nucleo/transicoes_rodada.ts";
import { registrarProjeto } from "../src/aplicacao/projeto/cadastro.ts";
import { decidirGate } from "../src/aplicacao/gates/decidir_gate.ts";
import { concluirSessaoAjustes } from "../src/aplicacao/sessao_ajustes.ts";
import { carregarDemanda, comDemanda } from "../src/armazenamento/demandas.ts";
import { garantirWorktreeDemanda, garantirWorktreeRodada } from "../src/infra/repositorio/worktree-demanda.ts";
import { abrirBancoTemporario } from "./banco_temporario.ts";
import { gravarAgregadoPronto } from "./cenarios_de_demanda.ts";
import { instalarPiFalso } from "./pi_falso.ts";
import { commitarArquivo, criarRepositorioDeTeste, rodarGit } from "./repositorio_de_teste.ts";
import { AmbienteHostLocal } from "../src/infra/ambiente/ambiente_host_local.ts";

const ambiente = new AmbienteHostLocal();

const em = "2026-01-01T00:00:00.000Z";
const temporario = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-ajustes-")));
process.env.PI_CODING_AGENT_DIR = join(temporario, "pi-agent");
delete process.env.FABRIQUINHA_PORTA;

const abertos: DatabaseSync[] = [];
after(() => {
  for (const b of abertos) b.close();
  rmSync(temporario, { recursive: true, force: true });
});

export const DEMANDA = "I-206";
export const REF = { demanda_id: DEMANDA, rodada_id: 2 };
export const BRANCH_DEMANDA = "fabriquinha/I-206";
export const BRANCH_RODADA = "fabriquinha/I-206-2";
export const MOTIVO = "Falta teste do fluxo de erro";
export const URL_PR = "https://github.com/org/loja/pull/1";

/** Demanda I-206 com a rodada 2 no gate do PR (ticket 8) e as duas worktrees prontas. */
export async function cenarioDeAjustes(shell = "") {
  const c = criarRepositorioDeTeste();
  const { banco } = abrirBancoTemporario(c.raiz);
  abertos.push(banco);
  registrarProjeto(banco, {
    nome: "loja",
    branch_base: "integracao",
    chave_sonarqube: "k",
    raiz_git: c.repo,
    hospedagem: "github",
    etapas: [],
    verificacoes: {
      fitness: [{ nome: "f", comando: "true", descricao: "d" }],
      linguagens: [{ caminho: ".", linguagem: "ts", comando_teste: "true" }],
    },
  });
  const ticket = (ticket_id: number, etapa: string, status: string) => ({
    demanda_id: DEMANDA,
    ticket_id,
    etapa,
    estado: status,
    estado_alterado_em: em,
    criado_por: { tipo: "fabriquinha" },
    rodada_id: 2,
  });
  await garantirWorktreeDemanda(ambiente, c.raiz, c.projeto, DEMANDA, c.log);
  const rodada = await garantirWorktreeRodada(ambiente, c.raiz, c.projeto, REF, c.log);
  const head = commitarArquivo(rodada, "a.txt", "a\n");
  const demanda = join(c.raiz, "worktrees", "loja", DEMANDA, "demanda");
  gravarAgregadoPronto(banco, {
    demanda: {
      id: DEMANDA,
      projeto: "loja",
      titulo: "Demanda",
      tipo: "funcionalidade",
      descricao: "d",
      estado: "em_execucao",
      estado_alterado_em: em,
      criada_por: { tipo: "externo", ferramenta: "claude", sessao: "s1" },
      enviada: true,
      branch: BRANCH_DEMANDA,
    },
    rodadas: [
      {
        ...REF,
        titulo: "r2",
        estado: "gate_pr",
        estado_alterado_em: "2026-01-01T00:00:00.000Z",
        e2e: false,
        branch: BRANCH_RODADA,
      },
    ],
    dependencias_rodada: [],
    criterios_citados: [],
    tickets: [
      ticket(3, "implementar", "concluido"),
      ticket(7, "encerrar_rodada", "concluido"),
      ticket(8, "encerrar_rodada", "em_execucao"),
    ],
    tentativas: [],
    dependencias_ticket: [],
    caminhos_ticket: [],
    decisoes: [],
    evidencias: [
      {
        demanda_id: DEMANDA,
        ticket_id: 8,
        tipo: "pr_aberto",
        autor: { tipo: "fabriquinha" },
        dados: { id: "1", url: URL_PR, branch: BRANCH_RODADA, head },
        em,
      },
    ],
    pull_requests: [{ rodada_id: 2, numero: 1, url: URL_PR, head, estado: "aberto", atualizado_em: em }],
  } as unknown as AgregadoDemanda);
  const id = ["-c", "user.name=t", "-c", "user.email=t@t"];
  const piFalso = instalarPiFalso(c.dir).roteirizar([
    { shell: shell.replaceAll("{id}", id.join(" ")).replaceAll("{demanda}", demanda) },
  ]);
  return {
    c,
    banco,
    head,
    sha: (branch: string) => rodarGit(c.repo, "rev-parse", branch),
    sujo: () => existsSync(join(rodada, "sujo.txt")),
    ag: () => carregarDemanda(banco, DEMANDA),
    piFalso,
    rodada,
    prompts: () => piFalso.prompts(),
    marco: () => join(c.raiz, "execucoes", "ajustes-I-206.R2.json"),
  };
}

export const ENDERECO = Endereco.daRodada(DEMANDA, 2);

/** Reprova o PR da rodada pelo gate, que abre a sessão de ajustes com o limite de tempo da configuração. */
export const reprovarPRRodada = (banco: DatabaseSync, motivo: string, ator: Ator = AUDITOR) =>
  decidirGate(banco, "gate_pr", ENDERECO, { resultado: "reprovado", motivo }, ator);

/** O mesmo caminho de efeitos do gate, com um limite curto para o pi terminar logo e o `fim` poder ser esperado. */

export async function ate(condicao: () => boolean): Promise<void> {
  for (let i = 0; i < 500 && !condicao(); i++) await dormir(20);
  assert.ok(condicao(), "a condição não se cumpriu a tempo");
}

/** Registra a correção como o agente da sessão (ticket 9) e conclui como Auditor. */
export async function concluirComCorrecao(banco: DatabaseSync, ag: () => AgregadoDemanda) {
  comDemanda(banco, DEMANDA, (a) =>
    registrarCorrecoesSessao(
      a,
      {
        ...REF,
        ticket_id: 9,
        correcoes: [{ demanda_id: DEMANDA, rodada_id: 2, ticket_id: 1, titulo: "Corrigir", descricao: "Corrigir" }],
      },
      { tipo: "agente", trabalho_id: "1" },
      { agora: em },
    ),
  );
  assert.ok(ag().tickets.some((t) => t.etapa === "implementar" && t.estado === "aberto"));
  return concluirSessaoAjustes(banco, REF, AUDITOR);
}
