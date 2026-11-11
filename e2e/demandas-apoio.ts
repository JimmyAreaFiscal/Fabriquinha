// Apoio dos testes do quadro de demandas: semeia as demandas no banco da instância, sobre o `projeto()` de apoio.ts, e
// abre o chat do planejamento com o pi falso.
import { Endereco } from "../src/demanda/nucleo/item_de_trabalho/item_de_trabalho.ts";
import type { Page } from "@playwright/test";
import type { AgregadoDemanda } from "../src/demanda/nucleo/agregado_demanda.ts";
import { abrir } from "../src/compartilhado/armazenamento/banco.ts";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { gravarProjeto } from "../src/projeto/armazenamento/projetos.ts";
import { Projeto } from "../src/projeto/nucleo/projeto.ts";
import { guardarBytes } from "../src/compartilhado/armazenamento/arquivos.ts";
import { registrarCorrecoesSessao } from "../src/fluxo/nucleo/transicoes/transicoes_rodada.ts";
import { carregarDemanda, comDemanda } from "../src/demanda/armazenamento/demandas.ts";
import { gravarAgregadoPronto } from "../apoio-testes/cenarios_de_demanda.ts";
import { gravarAnexos } from "../src/qualidade/armazenamento/evidencia_demanda.ts";
import { expect, type Fabriquinha } from "./apoio.ts";

const em = "2026-10-11T12:00:00.000Z";

const ticket = (demanda_id: string, ticket_id: number, etapa: string, rodada_id: number, status: string) => ({
  demanda_id,
  ticket_id,
  etapa,
  estado: status,
  estado_alterado_em: em,
  criado_por: { tipo: "fabriquinha" },
  rodada_id,
});

const rodada = (demanda_id: string, rodada_id: number, estado: string) => ({
  demanda_id,
  rodada_id,
  titulo: `rodada ${String(rodada_id)}`,
  estado,
  estado_alterado_em: "2026-01-01T00:00:00.000Z",
  e2e: false,
  branch: `fabriquinha/${demanda_id}-${String(rodada_id)}`,
});

const demanda = (id: string, estado: string, resto: object = {}): AgregadoDemanda =>
  ({
    demanda: {
      id,
      projeto: "loja",
      titulo: `Demanda ${id}`,
      tipo: "funcionalidade",
      descricao: "d",
      estado,
      estado_alterado_em: em,
      criada_por: { tipo: "externo", ferramenta: "claude", sessao: id },
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
    arquivos_previstos_rodada: [],
    arquivos_previstos_demanda: [],
    versoes_plano: [],
    tentativas: [],
    ...resto,
  }) as unknown as AgregadoDemanda;

/** A demanda no gate de aprovação: o ticket `demanda` em execução, que a decisão conclui. */
const comTicketDeDemanda = (id: string): AgregadoDemanda =>
  demanda(id, "gate_demanda", {
    tickets: [{ ...ticket(id, 1, "entender_e_desenhar", 1, "em_execucao"), rodada_id: undefined }],
  });

/** Uma evidência da própria demanda I-214. */
const daDemanda = (tipo: string, dados: object) => ({
  demanda_id: "I-214",
  tipo,
  dados,
  autor: { tipo: "externo", ferramenta: "claude", sessao: "I-214" },
  em,
});

/**
 * A I-214 aguardando a aprovação da demanda, com o ticket `demanda` em execução que a decisão conclui, e o que o
 * Auditor lê para decidir: descrição, comportamento, critérios, o desenho com o HTML e o relatório de impactos.
 */
export function semearGateDaDemanda(raiz: string): void {
  const banco = abrir(raiz);
  const ag = comTicketDeDemanda("I-214");
  gravarAgregadoPronto(banco, {
    ...ag,
    demanda: { ...ag.demanda, descricao: "O carrinho **perde** os cupons ao recarregar." },
    evidencias: [
      daDemanda("comportamento", { descricao: "Hoje o cupom some no F5.", comoReproduzir: ["recarregue"] }),
      daDemanda("criterios_aceite", {
        criterios: [
          { id: "CA-1", dado: "um cupom aplicado", quando: "o cliente recarrega", entao: "o cupom continua" },
        ],
      }),
      daDemanda("desenho_solucao", {
        resumo: "Guardar o cupom na `sessao`.",
        arquivosPrevistos: [{ caminho: "src/carrinho.ts", acao: "alterar", motivo: "ler o cupom da sessão" }],
        foraDeEscopo: ["cupons expirados"],
      }),
      daDemanda("relatorio_impactos_arquitetura", {
        impacto: "medio",
        novasDependencias: [],
        novosAcoplamentos: [{ de: "carrinho", para: "sessao", motivo: "ler o cupom" }],
        riscos: [],
      }),
    ],
  } as unknown as AgregadoDemanda);
  const html = guardarBytes(banco, Buffer.from("<h1>Desenho do cupom</h1>"));
  gravarAnexos(banco, { demanda_id: "I-214", tipo: "desenho_solucao" }, [
    { caminho: "desenho.html", mime: "text/html; charset=utf-8", ...html },
  ]);
  banco.close();
}

/**
 * I-206 em execução: R1 aguardando o PR 7 (aberto) e R2 sem PR, com o T3 em execução. I-207 em execução, com o T1 da R1
 * falho e dependente da I-206. I-208 aguardando a aprovação da demanda.
 */
export function semearDemandas(raiz: string): void {
  const banco = abrir(raiz);
  gravarAgregadoPronto(
    banco,
    demanda("I-206", "em_execucao", {
      rodadas: [rodada("I-206", 1, "gate_pr"), rodada("I-206", 2, "implementar")],
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
          autor: { tipo: "fabriquinha" },
          em,
        },
      ],
      pull_requests: [
        {
          rodada_id: 1,
          numero: 7,
          url: "https://exemplo.com/pr/7",
          head: "abc123",
          estado: "aberto",
          atualizado_em: em,
        },
      ],
    }),
  );
  gravarAgregadoPronto(
    banco,
    demanda("I-207", "em_execucao", {
      rodadas: [rodada("I-207", 1, "implementar")],
      tickets: [ticket("I-207", 1, "implementar", 1, "falhou")],
    }),
  );
  gravarAgregadoPronto(banco, comTicketDeDemanda("I-208"));
  banco.exec("INSERT INTO dependencia_demanda (demanda_id, depende_demanda_id) VALUES ('I-207', 'I-206')");
  banco.close();
}

/** Faz `demanda_id` depender de `depende_demanda_id`, que ainda não satisfaz a dependência. */
export function semearDependenciaEntreDemandas(raiz: string, demanda_id: string, depende_demanda_id: string): void {
  const banco = abrir(raiz);
  banco
    .prepare("INSERT INTO dependencia_demanda (demanda_id, depende_demanda_id) VALUES (?, ?)")
    .run(demanda_id, depende_demanda_id);
  banco.close();
}

/** Uma demanda sem ticket algum: nada em execução. */
export function semearDemandaOciosa(raiz: string): void {
  const banco = abrir(raiz);
  gravarAgregadoPronto(banco, demanda("I-209", "gate_demanda"));
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
  const decisao = (ticket_id: number, gate: string, resultado: string, resto: object) => ({
    demanda_id: "I-210",
    ticket_id,
    decisao_id: ticket_id,
    gate,
    resultado,
    por: { tipo: "auditor" },
    em,
    ...resto,
  });
  gravarAgregadoPronto(
    banco,
    demanda("I-210", "encerrar_demanda", {
      rodadas: [rodada("I-210", 1, "gate_pr"), rodada("I-210", 2, "ajustar_resultado")],
      tickets: [
        ticket("I-210", 1, "implementar", 1, "concluido"),
        ticket("I-210", 2, "revisar_rodada", 1, "concluido"),
        ticket("I-210", 3, "encerrar_rodada", 1, "concluido"),
        ticket("I-210", 4, "implementar", 2, "concluido"),
        ticket("I-210", 5, "implementar", 2, "falhou"),
        { ...ticket("I-210", 6, "planejar", 1, "concluido"), rodada_id: undefined },
      ],
      tentativas: [
        {
          ticket: Endereco.doTicket("I-210", 5),
          numero: 1,
          inicio: em,
          fim: em,
          resultado: { tipo: "interrompida", por: { tipo: "fabriquinha" }, motivo: "o teste de erro não passou" },
        },
      ],
      decisoes: [
        decisao(2, "gate_revisao_rodada", "reprovado", { motivo: "falta teste do caminho de erro" }),
        decisao(3, "gate_pr", "aprovado", { nota: 4 }),
      ],
      evidencias: [
        {
          demanda_id: "I-210",
          ticket_id: 3,
          tipo: "pr_aberto",
          dados: { id: "7", url: "https://exemplo.com/pr/7" },
          autor: { tipo: "fabriquinha" },
          em,
        },
      ],
      encerramento: {
        demanda_id: "I-210",
        branch: "fabriquinha/I-210",
        base: "main",
        sha_verificado: "abc123",
        integracao: { sha: "def456" },
        limpeza_pendente: ["worktree da rodada 1"],
        falha: { etapa: "limpeza", motivo: "não consegui apagar a worktree" },
      },
      pull_requests: [
        {
          rodada_id: 1,
          numero: 7,
          url: "https://exemplo.com/pr/7",
          head: "abc123",
          estado: "aberto",
          atualizado_em: em,
        },
        { numero: 9, url: "https://exemplo.com/pr/9", head: "abc123", estado: "integrado", atualizado_em: em },
      ],
    }),
  );
  gravarAnexos(banco, { demanda_id: "I-210", ticket_id: 3, tipo: "pr_aberto" }, [
    { caminho: "print.png", sha256, mime: "image/png", bytes },
  ]);
  gravarAgregadoPronto(banco, demanda("I-211", "em_execucao"));
  banco.exec("INSERT INTO dependencia_demanda (demanda_id, depende_demanda_id) VALUES ('I-210', 'I-211')");
  banco.close();
}

/** A demanda no gate do planejamento: o ticket `planejar` em execução e o plano submetido, com uma rodada. */
const comPlano = (id: string): AgregadoDemanda =>
  demanda(id, "gate_planejamento", {
    tickets: [{ ...ticket(id, 1, "planejar", 1, "em_execucao"), rodada_id: undefined }],
    evidencias: [
      {
        demanda_id: id,
        tipo: "criterios_aceite",
        dados: { criterios: [{ id: "CA-1", dado: "d", quando: "q", entao: "e" }] },
        autor: { tipo: "externo", ferramenta: "claude", sessao: id },
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
        autor: { tipo: "fabriquinha" },
        em,
      },
    ],
  });

/** O projeto `loja` com a configuração do SDLC, que as decisões que integram exigem. */
function configurarProjeto(banco: ReturnType<typeof abrir>, raiz: string): void {
  gravarProjeto(
    banco,
    Projeto.parse({
      nome: "loja",
      branch_base: "main",
      chave_sonarqube: "loja",
      raiz_git: join(raiz, "loja"),
      hospedagem: "github",
      verificacoes: {
        fitness: [{ nome: "f", comando: "true", descricao: "d" }],
        linguagens: [{ caminho: ".", linguagem: "ts", comando_teste: "true" }],
      },
    }),
  );
}

/** I-212 e I-213 com o planejamento aguardando aprovação. */
export function semearPlanejamento(raiz: string): void {
  const banco = abrir(raiz);
  configurarProjeto(banco, raiz);
  gravarAgregadoPronto(banco, comPlano("I-212"));
  gravarAgregadoPronto(banco, comPlano("I-213"));
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
  // O pi falso da sessão de ajustes só sobe em branch da Fabriquinha.
  execFileSync(
    "git",
    ["config", "branch.fabriquinha/I-215.fabriquinha", `demanda:${join(raiz, "worktrees/loja/I-215/demanda")}`],
    { cwd: join(raiz, "loja") },
  );
  // A aprovação integra: o gh falso já vê o PR 9 mergeado, e a branch da demanda está no remoto para o fast-forward.
  execFileSync("git", ["push", "-q", "origin", "fabriquinha/I-215"], { cwd: join(raiz, "loja") });
  writeFileSync(
    join(raiz, "gh-pr.json"),
    JSON.stringify({ state: "MERGED", url: "https://exemplo.com/pr/9", mergedAt: em, mergeCommit: { oid: "abc" } }),
  );
  // Concluir a sessão restaura a branch da rodada no head do PR, que precisa ser um commit de verdade.
  const head = execFileSync("git", ["rev-parse", "main"], { cwd: join(raiz, "loja"), encoding: "utf8" }).trim();
  const banco = abrir(raiz);
  configurarProjeto(banco, raiz);
  gravarAgregadoPronto(
    banco,
    demanda("I-215", "em_execucao", {
      rodadas: [rodada("I-215", 1, "gate_pr")],
      tickets: [ticket("I-215", 1, "encerrar_rodada", 1, "em_execucao")],
      evidencias: [
        {
          demanda_id: "I-215",
          ticket_id: 1,
          tipo: "pr_aberto",
          dados: { id: "9", url: "https://exemplo.com/pr/9", branch: "fabriquinha/I-215-1", head },
          autor: { tipo: "fabriquinha" },
          em,
        },
      ],
      pull_requests: [
        { rodada_id: 1, numero: 9, url: "https://exemplo.com/pr/9", head, estado: "aberto", atualizado_em: em },
      ],
    }),
  );
  banco.close();
}

/** I-216 com o T1 e o T2 abertos na R1 em desenvolvimento: só o T1 é elegível para o Executar agora. */
export function semearTicketAberto(raiz: string): void {
  // A execução parte da worktree da demanda, que precisa existir e ser da Fabriquinha.
  const caminho = join(raiz, "worktrees/loja/I-216/demanda");
  const repo = join(raiz, "loja");
  execFileSync("git", ["worktree", "add", "-q", "-b", "fabriquinha/I-216", caminho, "main"], { cwd: repo });
  execFileSync("git", ["config", "branch.fabriquinha/I-216.fabriquinha", `demanda:${caminho}`], { cwd: repo });
  const banco = abrir(raiz);
  configurarProjeto(banco, raiz);
  gravarAgregadoPronto(
    banco,
    demanda("I-216", "em_execucao", {
      rodadas: [rodada("I-216", 1, "implementar")],
      tickets: [ticket("I-216", 1, "implementar", 1, "aberto"), ticket("I-216", 2, "implementar", 1, "aberto")],
    }),
  );
  banco.close();
}

/** A I-217 concluída, que o Auditor arquiva. */
export function semearDemandaConcluida(raiz: string): void {
  const banco = abrir(raiz);
  gravarAgregadoPronto(banco, demanda("I-217", "concluida"));
  banco.close();
}

/** A I-218 em encerramento com o PR final verificado, à espera do merge humano na plataforma. */
export function semearDemandaAguardandoMerge(raiz: string): void {
  const banco = abrir(raiz);
  gravarAgregadoPronto(
    banco,
    demanda("I-218", "encerrar_demanda", {
      rodadas: [rodada("I-218", 1, "concluida")],
      tickets: [
        ticket("I-218", 1, "implementar", 1, "concluido"),
        { ...ticket("I-218", 2, "encerrar_demanda", 1, "aberto"), rodada_id: undefined },
      ],
      encerramento: {
        demanda_id: "I-218",
        branch: "fabriquinha/I-218",
        base: "main",
        sha_verificado: "abc123",
        aguardando_merge_humano: true,
        limpeza_pendente: [],
      },
      pull_requests: [
        { numero: 12, url: "https://exemplo.com/pr/12", head: "abc123", estado: "aberto", atualizado_em: em },
      ],
    }),
  );
  banco.close();
}

/** Registra uma correção na sessão de ajustes da rodada, como o agente do ticket da sessão. */
export function registrarCorrecaoDaSessao(raiz: string, demanda_id: string, rodada_id: number): void {
  const banco = abrir(raiz);
  const sessao = carregarDemanda(banco, demanda_id).tickets.find(
    (t) => t.rodada_id === rodada_id && t.etapa === "ajustar_resultado",
  );
  if (!sessao) throw new Error("a rodada não tem ticket de sessão");
  comDemanda(banco, demanda_id, (a) =>
    registrarCorrecoesSessao(
      a,
      {
        demanda_id,
        rodada_id,
        ticket_id: sessao.ticket_id,
        correcoes: [{ demanda_id, rodada_id, ticket_id: 1, titulo: "Corrigir", descricao: "Corrigir" }],
      },
      { tipo: "agente", trabalho_id: "execucao-1" },
      { agora: em },
    ),
  );
  banco.close();
}

/** A I-230 em planejamento, com o ticket `planejar` aberto e a `descricao` que dirige o pi falso. */
export function semearPlanejamentoComPi(raiz: string, descricao: string): void {
  // A execução parte da worktree da demanda, que precisa existir e ser da Fabriquinha.
  const caminho = join(raiz, "worktrees/loja/I-230/demanda");
  const repo = join(raiz, "loja");
  execFileSync("git", ["worktree", "add", "-q", "-b", "fabriquinha/I-230", caminho, "main"], { cwd: repo });
  execFileSync("git", ["config", "branch.fabriquinha/I-230.fabriquinha", `demanda:${caminho}`], { cwd: repo });
  const banco = abrir(raiz);
  gravarProjeto(
    banco,
    Projeto.parse({
      nome: "loja",
      branch_base: "main",
      chave_sonarqube: "loja",
      raiz_git: repo,
      hospedagem: "github",
      verificacoes: {
        fitness: [{ nome: "f", comando: "true", descricao: "d" }],
        linguagens: [{ caminho: ".", linguagem: "ts", comando_teste: "true" }],
      },
    }),
  );
  gravarAgregadoPronto(banco, {
    demanda: {
      id: "I-230",
      projeto: "loja",
      titulo: "Cupons com prioridade",
      tipo: "funcionalidade",
      descricao,
      estado: "planejar",
      estado_alterado_em: em,
      criada_por: { tipo: "externo", ferramenta: "claude", sessao: "I-230" },
      enviada: true,
      branch: "fabriquinha/I-230",
    },
    tickets: [
      {
        demanda_id: "I-230",
        ticket_id: 1,
        etapa: "planejar",
        estado: "aberto",
        estado_alterado_em: em,
        criado_por: { tipo: "fabriquinha" },
      },
    ],
    decisoes: [],
    evidencias: [
      {
        demanda_id: "I-230",
        tipo: "criterios_aceite",
        dados: { criterios: [{ id: "CA-1", dado: "d", quando: "q", entao: "e" }] },
        autor: { tipo: "externo", ferramenta: "claude", sessao: "I-230" },
        em,
      },
    ],
    rodadas: [],
    dependencias_rodada: [],
    criterios_citados: [],
    dependencias_ticket: [],
    caminhos_ticket: [],
    arquivos_previstos_rodada: [],
    arquivos_previstos_demanda: [],
    versoes_plano: [],
    tentativas: [],
  } as unknown as AgregadoDemanda);
  banco.close();
}

/** Executar agora, como o Auditor na página da demanda; devolve o chat da sessão assim que o ticket ganha o link. */
export async function abrirOChatDoPlanejamento(pagina: Page, { base }: Fabriquinha): Promise<void> {
  await pagina.goto(`${base}/demandas/I-230`);
  const ticket = pagina.locator(".dm-ticket", { hasText: "I-230.T1" });
  // CA-17: sem sessão, sem link para o chat.
  await expect(ticket.getByRole("link", { name: "chat →" })).toHaveCount(0);
  await pagina.getByRole("button", { name: "Executar agora" }).click();
  // CA-16: com a sessão, o ticket leva ao chat dela.
  await expect(async () => {
    await pagina.reload();
    await expect(ticket.getByRole("link", { name: "chat →" })).toBeVisible();
  }).toPass();
  await ticket.getByRole("link", { name: "chat →" }).click();
  await expect(pagina).toHaveTitle("Chat · Fabriquinha");
}
