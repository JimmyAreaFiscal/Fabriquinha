// Revisão da rodada e da demanda (I-248, CA-2 a CA-4) com o pi falso: o revisor que decide conclui o ticket; o que
// sai sem decidir deixa o ticket Falhou, com o motivo, e Reabrir com instrução o põe de volta na fila.
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import type { AgregadoDemanda } from "../src/dominio/agregado_demanda.ts";
import { abrir } from "../src/persistencia/banco.ts";
import { gravarConfiguracaoProjeto } from "../src/persistencia/configuracao_projeto.ts";
import { carregarDemanda, criarDemanda } from "../src/persistencia/demandas.ts";
import { expect, projeto, test } from "./apoio.ts";

const em = "2026-10-11T12:00:00.000Z";
const SEM_DECISAO = "a revisão terminou sem registrar a decisão";

/**
 * A I-250 com o revisor aberto: o T2 `revisar_rodada` na R1 em revisão, ou, com `integral`, o T2 `revisar_demanda` com a
 * R1 concluída. A `descricao` dirige o pi falso. A execução parte da worktree da demanda, que precisa existir.
 */
function semear(raiz: string, descricao: string, integral = false): void {
  const repo = join(raiz, "loja");
  const caminho = join(raiz, "worktrees/loja/I-250/demanda");
  execFileSync("git", ["worktree", "add", "-q", "-b", "fabriquinha/I-250", caminho, "main"], { cwd: repo });
  execFileSync("git", ["config", "branch.fabriquinha/I-250.fabriquinha", `demanda:${caminho}`], { cwd: repo });
  const banco = abrir(raiz);
  gravarConfiguracaoProjeto(banco, {
    nome: "loja",
    branch_base: "main",
    chave_sonarqube: "loja",
    raiz_git: repo,
    hospedagem: "github",
    etapas: [],
    fitness: [{ nome: "f", comando: "true", descricao: "d" }],
    linguagens: [{ caminho: ".", linguagem: "ts", comando_teste: "true" }],
  });
  const ticket = (ticket_id: number, etapa: string, status: string) => ({
    demanda_id: "I-250",
    ticket_id,
    etapa,
    status,
    status_alterado_em: em,
    rodada_id: etapa === "revisar_demanda" ? undefined : 1,
    devolucoes: 0,
  });
  criarDemanda(banco, {
    demanda: {
      id: "I-250",
      projeto: "loja",
      titulo: "Cupons com prioridade",
      tipo: "funcionalidade",
      descricao,
      fase: integral ? "revisao_demanda" : "execucao",
      fase_alterada_em: em,
      origem_ferramenta: "claude",
      origem_sessao: "I-250",
      enviada: true,
      branch: "fabriquinha/I-250",
    },
    tickets: [
      ticket(1, "implementar", "concluido"),
      ticket(2, integral ? "revisar_demanda" : "revisar_rodada", "aberto"),
    ],
    decisoes: [],
    evidencias: [
      {
        demanda_id: "I-250",
        tipo: "criterios_aceite",
        dados: { criterios: [{ id: "CA-1", dado: "d", quando: "q", entao: "e" }] },
        em,
      },
    ],
    rodadas: [
      {
        demanda_id: "I-250",
        rodada_id: 1,
        titulo: "r1",
        fase: integral ? "concluida" : "revisao",
        e2e: false,
        branch: "fabriquinha/I-250-1",
      },
    ],
    dependencias_rodada: [],
    criterios_citados: [{ demanda_id: "I-250", rodada_id: 1, criterio_id: "CA-1" }],
    dependencias_ticket: [],
    caminhos_ticket: [],
  } as unknown as AgregadoDemanda);
  banco.close();
}

/** O estado da I-250 no banco da instância. */
function estado(raiz: string) {
  const banco = abrir(raiz);
  try {
    const ag = carregarDemanda(banco, "I-250");
    const t = ag.tickets.find((x) => x.ticket_id === 2);
    return { status: t?.status, motivo: t?.motivo_falha, decisoes: ag.decisoes.length, rodada: ag.rodadas[0]?.fase };
  } finally {
    banco.close();
  }
}

/** Executar agora no T2, como o Auditor, e espera o pi falso terminar. */
async function executar(pagina: Page, base: string, status: string): Promise<void> {
  await pagina.goto(`${base}/demandas/I-250`);
  await pagina.getByRole("button", { name: "Executar agora" }).click();
  const ticket = pagina.locator(".dm-ticket", { hasText: "I-250.T2" });
  await expect(async () => {
    await pagina.reload();
    await expect(ticket).toContainText(status);
  }).toPass();
}

test("CA-2: o revisor que decide aprovar conclui o ticket e a rodada segue para o encerramento", async ({
  pagina,
  fabriquinha,
}) => {
  projeto(fabriquinha.raiz);
  semear(fabriquinha.raiz, "revise");
  await executar(pagina, fabriquinha.base, "Concluído");
  const e = estado(fabriquinha.raiz);
  expect([e.status, e.decisoes, e.rodada]).toEqual(["concluido", 1, "encerramento"]);
});

for (const [ca, integral] of [
  ["CA-3", false],
  ["CA-4", true],
] as const) {
  test(`${ca}: o revisor ${integral ? "da demanda" : "da rodada"} que sai sem decidir deixa o ticket Falhou e Reabrir o retoma`, async ({
    pagina,
    fabriquinha,
  }) => {
    projeto(fabriquinha.raiz);
    semear(fabriquinha.raiz, "[sem decidir]", integral);
    await executar(pagina, fabriquinha.base, "Falhou");
    await expect(pagina.locator(".dm-ticket", { hasText: "I-250.T2" })).toContainText(SEM_DECISAO);
    expect(estado(fabriquinha.raiz)).toMatchObject({ status: "falhou", motivo: SEM_DECISAO, decisoes: 0 });

    await pagina.getByRole("button", { name: "Reabrir" }).click();
    await pagina.getByLabel(/Instrução/).fill("decida ao final");
    await pagina
      .getByRole("button", { name: /Reabrir/ })
      .last()
      .click();
    await expect(pagina.locator(".dm-ticket", { hasText: "I-250.T2" })).not.toContainText("Falhou");
  });
}
