// Cenário do encerramento da rodada: banco real, git real, pi falso e hospedagem falsa (CA-2 a CA-12 da I-227).
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after, beforeEach } from "node:test";
import { abrirBancoTemporario } from "./banco_temporario.ts";
import { instalarPiFalso } from "./pi_falso.ts";
import { Endereco } from "../src/nucleo/item_de_trabalho.ts";
import type { AgregadoDemanda } from "../src/nucleo/agregado_demanda.ts";
import { marcaDoPRRodada } from "../src/aplicacao/evidencias/pr_rodada.ts";
import { gravarCommitDemanda } from "../src/armazenamento/commits_demanda.ts";
import { registrarProjeto } from "../src/aplicacao/projeto/cadastro.ts";
import { carregarDemanda } from "../src/armazenamento/demandas.ts";
import { gravarAgregadoPronto } from "./cenarios_de_demanda.ts";
import { hospedagemFalsa } from "./hospedagem_falsa.ts";
import { criarRepositorioDeTeste, commitarArquivo, rodarGit } from "./repositorio_de_teste.ts";
import { garantirWorktreeDemanda, garantirWorktreeRodada } from "../src/infra/repositorio/worktree-demanda.ts";
import { AmbienteHostLocal } from "../src/infra/ambiente/ambiente_host_local.ts";

const ambiente = new AmbienteHostLocal();
const em = "2026-01-01T00:00:00.000Z";
const temporario = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-encerramento-")));
process.env.PI_CODING_AGENT_DIR = join(temporario, "pi-agent");
delete process.env.FABRIQUINHA_PORTA;
// A credencial do serviço, que os comandos de PR precisam ver.
process.env.GH_TOKEN = "token-do-servico";

export const hospedagem = hospedagemFalsa(temporario);
beforeEach(() => {
  hospedagem.zerar();
});

const abertos: DatabaseSync[] = [];
after(() => {
  for (const b of abertos) b.close();
  rmSync(temporario, { recursive: true, force: true });
});

export const DEMANDA = "I-206";
export const REF = { demanda_id: DEMANDA, rodada_id: 2 };
export const BRANCH_DEMANDA = "fabriquinha/I-206";
export const BRANCH_RODADA = "fabriquinha/I-206-2";
export const MARCA = marcaDoPRRodada(DEMANDA, 8);

interface Opcoes {
  /** Os dois primeiros tickets de implementação e a documentação entregue pelo agente (padrão: sim). */
  documentacao?: boolean;
  statusEncerrar?: "aberto" | "em_execucao" | "falhou";
  estado?: "encerrar_rodada" | "implementar";
  instrucao?: string;
  semTicketEncerrar?: boolean;
  /** Um `encerrar_rodada` anterior da rodada que já registrou o PR 1. */
  anterior?: boolean;
  descricao?: string;
}

/** Projeto `loja`, demanda I-206 em execução com a rodada 2 em encerramento, os T3 e T4 commitados e registrados. */
export async function cenario({
  documentacao = true,
  statusEncerrar = "em_execucao",
  estado = "encerrar_rodada",
  instrucao,
  semTicketEncerrar = false,
  anterior = false,
  descricao = "d",
}: Opcoes = {}) {
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
      preparacao: ["true"],
      fitness: [{ nome: "f", comando: "true", descricao: "d" }],
      linguagens: [{ caminho: ".", linguagem: "ts", comando_teste: "true" }],
    },
  });
  const ticket = (ticket_id: number, etapa: string, status: string, extra: object = {}) => ({
    demanda_id: DEMANDA,
    ticket_id,
    etapa,
    estado: status,
    estado_alterado_em: em,
    criado_por: { tipo: "fabriquinha" },
    rodada_id: 2,
    ...extra,
  });
  const evidencia = (ticket_id: number, tipo: string, dados: object) => ({
    demanda_id: DEMANDA,
    ticket_id,
    tipo,
    autor: { tipo: "agente", trabalho_id: "1" },
    dados,
    em,
  });
  const mensagemPR = {
    titulo: "Encerrar a rodada",
    oQueMudou: "Conduz o encerramento.",
    decisoesNaoObvias: [],
    naoFeito: [],
    comoRevisar: ["Leia o diff."],
    naoVerificado: [],
  };
  gravarAgregadoPronto(banco, {
    demanda: {
      id: DEMANDA,
      projeto: "loja",
      titulo: "Demanda",
      tipo: "funcionalidade",
      descricao,
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
        estado,
        estado_alterado_em: "2026-01-01T00:00:00.000Z",
        e2e: false,
        branch: BRANCH_RODADA,
      },
    ],
    dependencias_rodada: [],
    criterios_citados: [],
    tickets: [
      ticket(3, "implementar", "concluido", { titulo: "Primeiro" }),
      ticket(4, "implementar", "concluido", { titulo: "Segundo" }),
      ticket(5, "revisar_rodada", "concluido"),
      ...(anterior ? [ticket(7, "encerrar_rodada", "concluido")] : []),
      ...(semTicketEncerrar ? [] : [ticket(8, "encerrar_rodada", statusEncerrar, instrucao ? { instrucao } : {})]),
    ],
    tentativas: instrucao
      ? [
          {
            ticket: Endereco.doTicket(DEMANDA, 8),
            numero: 1,
            inicio: em,
            fim: em,
            instrucao,
            resultado: { tipo: "interrompida", por: { tipo: "auditor" } },
          },
        ]
      : [],
    pull_requests: anterior
      ? [
          {
            rodada_id: 2,
            numero: 1,
            url: "https://github.com/org/loja/pull/1",
            head: "a".repeat(40),
            estado: "aberto",
            atualizado_em: em,
          },
        ]
      : [],
    dependencias_ticket: [],
    caminhos_ticket: [],
    decisoes: [],
    evidencias: [
      ...(semTicketEncerrar
        ? []
        : documentacao
          ? [evidencia(8, "mensagem_pr", mensagemPR), evidencia(8, "aula_codigo", { resumo: "aula" })]
          : [evidencia(8, "mensagem_pr", mensagemPR)]),
      ...(anterior ? [evidencia(7, "pr_aberto", { id: "1", url: "https://github.com/org/loja/pull/1" })] : []),
    ],
  } as unknown as AgregadoDemanda);
  await garantirWorktreeDemanda(ambiente, c.raiz, c.projeto, DEMANDA, c.log);
  const rodada = await garantirWorktreeRodada(ambiente, c.raiz, c.projeto, REF, c.log);
  const demanda = join(c.raiz, "worktrees", "loja", DEMANDA, "demanda");
  /** Commita na rodada e, com `ticket`, registra o commit como desse ticket de implementação. */
  const commitarNaRodada = (arquivo: string, ticket?: number) => {
    const sha = commitarArquivo(rodada, arquivo, `${arquivo}\n`);
    if (ticket !== undefined) {
      const mensagem = `feat: ${arquivo} [I-206/T-${String(ticket)}]`;
      gravarCommitDemanda(banco, DEMANDA, ticket, { sha, mensagem, em, arquivos: [] });
    }
    return sha;
  };
  commitarNaRodada("a.txt", 3);
  commitarNaRodada("b.txt", 4);
  const piFalso = instalarPiFalso(c.dir);
  return {
    c,
    banco,
    piFalso,
    rodada,
    demanda,
    commitarNaRodada,
    ag: () => carregarDemanda(banco, DEMANDA),
    ticket: () => carregarDemanda(banco, DEMANDA).tickets.find((t) => t.ticket_id === 8),
    evidencia: (tipo: string) =>
      carregarDemanda(banco, DEMANDA).evidencias.find((e) => e.tipo === tipo && e.ticket_id === 8),
    prompt: () =>
      piFalso
        .prompts()
        .map((entrada) => entrada.prompt)
        .join("\n"),
    noRemoto: (branch: string) => rodarGit(c.bare, "for-each-ref", "--format=%(objectname)", `refs/heads/${branch}`),
    estado: () => carregarDemanda(banco, DEMANDA).rodadas[0]?.estado,
  };
}
