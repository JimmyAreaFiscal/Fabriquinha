// Parar o serviço com um ticket de demanda em execução (I-246, CA-1 a CA-3): o systemd manda o SIGTERM ao cgroup
// inteiro, então o serviço e o pi recebem o sinal juntos. A parada sai limpa e o ticket falha com "serviço reiniciado".
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { setTimeout as dormir } from "node:timers/promises";
import type { Page } from "@playwright/test";
import { carregarDemanda } from "../src/persistencia/demandas.ts";
import { abrir } from "../src/persistencia/banco.ts";
import { substituirPreparacaoDoProjeto } from "../src/persistencia/configuracao_projeto.ts";
import { carregarSessoesDoTicket } from "../src/persistencia/sessoes.ts";
import { sinalNoGrupo } from "../src/processo.ts";
import { expect, projeto, test } from "./apoio.ts";
import { semearTicketAberto } from "./demandas-apoio.ts";

// Um pi que não termina sozinho: só o sinal o encerra.
const piParado = join(mkdtempSync(join(tmpdir(), "pi-parado-")), "pi");
writeFileSync(piParado, '#!/bin/sh\n[ "$1" = "--version" ] && echo 0.0.0-falso && exit 0\nexec sleep 60\n', {
  mode: 0o755,
});

// Um pi que ignora o SIGTERM: só o SIGKILL do `parar`, passado o limite, o encerra.
const piTeimoso = join(mkdtempSync(join(tmpdir(), "pi-teimoso-")), "pi");
writeFileSync(
  piTeimoso,
  '#!/bin/sh\n[ "$1" = "--version" ] && echo 0.0.0-falso && exit 0\ntrap \'\' TERM\nexec sleep 40\n',
  {
    mode: 0o755,
  },
);

test.describe("I-246 CA-4", () => {
  test.use({ pi: piTeimoso });
  test("pi que ignora o SIGTERM: o serviço o mata no limite, sai limpo, e a subida seguinte mostra Falhou", async ({
    pagina,
    fabriquinha,
  }) => {
    test.setTimeout(60_000);
    projeto(fabriquinha.raiz);
    semearTicketAberto(fabriquinha.raiz);
    await pagina.goto(`${fabriquinha.base}/demandas/I-216`);
    await pagina.getByRole("button", { name: "Executar agora" }).click();
    await expect(pagina.locator(".dm-ticket", { hasText: "I-216.T1" })).toContainText("Em execução");

    let pgid: number | null = null;
    while (pgid === null) {
      await dormir(50);
      const banco = abrir(fabriquinha.raiz);
      pgid = carregarSessoesDoTicket(banco, { demanda_id: "I-216", ticket_id: 1 }).execucoes[0]?.grupo_processo ?? null;
      banco.close();
    }

    const inicio = Date.now();
    const saiu = once(fabriquinha.servico, "exit");
    sinalNoGrupo(pgid, "SIGTERM");
    fabriquinha.servico.kill("SIGTERM");
    const codigo = (await saiu)[0] as number | null;
    expect(Date.now() - inicio).toBeLessThan(13_000);
    expect(codigo).toBe(0);
    expect(fabriquinha.stderr()).not.toContain("database is not open");
    expect(fabriquinha.stderr()).not.toMatch(/Error/);
    expect(() => process.kill(-pgid, 0)).toThrow(/ESRCH/);

    const nova = await fabriquinha.reiniciar();
    await pagina.goto(nova.link);
    await pagina.goto(`${nova.base}/demandas/I-216`);
    const ticket = pagina.locator(".dm-ticket", { hasText: "I-216.T1" });
    await expect(ticket).toContainText("Falhou");
    await expect(ticket).toContainText("serviço reiniciado");
  });
});

/** Executa o ticket e espera o grupo do pi gravado. */
async function executarEEsperarPi(pagina: Page, raiz: string, base: string): Promise<number> {
  await pagina.goto(`${base}/demandas/I-216`);
  await pagina.getByRole("button", { name: "Executar agora" }).click();
  await expect(pagina.locator(".dm-ticket", { hasText: "I-216.T1" })).toContainText("Em execução");
  let pgid: number | null = null;
  while (pgid === null) {
    await dormir(50);
    const banco = abrir(raiz);
    pgid = carregarSessoesDoTicket(banco, { demanda_id: "I-216", ticket_id: 1 }).execucoes[0]?.grupo_processo ?? null;
    banco.close();
  }
  return pgid;
}

/** Logo depois da saída do serviço, antes de subir de novo: o fim e o motivo já estão no banco (não é a subida que os preenche). */
function conferirFimGravado(raiz: string): void {
  const banco = abrir(raiz);
  const { execucoes } = carregarSessoesDoTicket(banco, { demanda_id: "I-216", ticket_id: 1 });
  const ticket = carregarDemanda(banco, "I-216").tickets.find((t) => t.ticket_id === 1);
  banco.close();
  expect(execucoes).toHaveLength(1);
  expect(execucoes[0]?.fim).not.toBeNull();
  expect(execucoes[0]?.erro).toBe("serviço reiniciado");
  expect(ticket?.status).toBe("falhou");
  expect(ticket?.motivo_falha).toBe("serviço reiniciado");
}

test.describe("I-246", () => {
  test.use({ pi: piParado });
  for (const [nome, adiantoMs] of [
    ["SIGTERM simultâneo no pi e no serviço", 0],
    ["pi recebe o SIGTERM 200 ms antes do serviço", 200],
  ] as const) {
    test(`CA-1, CA-2: ${nome}: sai limpo, grava o fim, e a subida seguinte o mostra Falhou`, async ({
      pagina,
      fabriquinha,
    }) => {
      projeto(fabriquinha.raiz);
      semearTicketAberto(fabriquinha.raiz);
      const pgid = await executarEEsperarPi(pagina, fabriquinha.raiz, fabriquinha.base);

      // Como o systemd: o pi e o serviço recebem o SIGTERM juntos.
      const saiu = once(fabriquinha.servico, "exit");
      sinalNoGrupo(pgid, "SIGTERM");
      if (adiantoMs > 0) await dormir(adiantoMs);
      fabriquinha.servico.kill("SIGTERM");
      const codigo = (await saiu)[0] as number | null;
      expect(codigo).toBe(0);
      expect(fabriquinha.stderr()).not.toContain("database is not open");
      expect(fabriquinha.stderr()).not.toMatch(/Error/);
      conferirFimGravado(fabriquinha.raiz);

      const nova = await fabriquinha.reiniciar();
      await pagina.goto(nova.link);
      await pagina.goto(`${nova.base}/demandas/I-216`);
      const ticket = pagina.locator(".dm-ticket", { hasText: "I-216.T1" });
      await expect(ticket).toContainText("Falhou");
      await expect(ticket).toContainText("serviço reiniciado");

      await pagina.getByLabel(/Instrução/).fill("refazer depois da parada");
      await pagina.getByRole("button", { name: "Reabrir" }).click();
      await expect(pagina.getByRole("button", { name: "Reabrir" })).toHaveCount(0);
      await expect(pagina.getByText("Falhou", { exact: true })).toHaveCount(0);
    });
  }
});

// I-246.R2 CA-4: o condutor ainda na preparação da worktree (pi não lançado) também não prende o `parar`.
for (const [nome, preparacao, sinalNosFilhos] of [
  ["preparação sleep 25, SIGTERM só no serviço", "sleep 25", false],
  ["preparação que ignora o SIGTERM, SIGTERM no serviço e nos filhos", "trap '' TERM; sleep 25", true],
] as const) {
  test.describe(`I-246 CA-4 preparação: ${nome}`, () => {
    test.use({ pi: piParado });
    test("sai no limite, sem erro, sem pi lançado, e a subida seguinte mostra Falhou", async ({
      pagina,
      fabriquinha,
    }) => {
      test.setTimeout(60_000);
      projeto(fabriquinha.raiz);
      semearTicketAberto(fabriquinha.raiz);
      const banco = abrir(fabriquinha.raiz);
      substituirPreparacaoDoProjeto(banco, "loja", [preparacao]);
      banco.close();
      await pagina.goto(`${fabriquinha.base}/demandas/I-216`);
      await pagina.getByRole("button", { name: "Executar agora" }).click();
      await expect(pagina.locator(".dm-ticket", { hasText: "I-216.T1" })).toContainText("Em execução");
      await dormir(1000); // a preparação está rodando

      const inicio = Date.now();
      const saiu = once(fabriquinha.servico, "exit");
      if (sinalNosFilhos) execFileSync("pkill", ["-TERM", "-P", String(fabriquinha.servico.pid)], { stdio: "ignore" });
      fabriquinha.servico.kill("SIGTERM");
      const codigo = (await saiu)[0] as number | null;
      expect(Date.now() - inicio).toBeLessThan(10_000 + 2_000 + 3_000);
      expect(codigo).toBe(0);
      expect(fabriquinha.stderr()).not.toContain("database is not open");
      expect(fabriquinha.stderr()).not.toMatch(/Error/);

      const nova = await fabriquinha.reiniciar();
      await pagina.goto(nova.link);
      await pagina.goto(`${nova.base}/demandas/I-216`);
      const ticket = pagina.locator(".dm-ticket", { hasText: "I-216.T1" });
      await expect(ticket).toContainText("Falhou");
      await expect(ticket).toContainText("serviço reiniciado");
    });
  });
}

// I-246.R3 CA-2, CA-4: o pi termina bem e o serviço para durante a coleta dos testes: o SIGTERM do cgroup mata o comando
// de testes, e a saída dele não vira devolução nem falha de infraestrutura.
test.describe("I-246.T15 parada durante a coleta das verificações", () => {
  test("sai limpo e a página da demanda mostra Falhou com 'serviço reiniciado'", async ({ pagina, fabriquinha }) => {
    test.setTimeout(60_000);
    projeto(fabriquinha.raiz);
    semearTicketAberto(fabriquinha.raiz);
    const banco = abrir(fabriquinha.raiz);
    banco.prepare("UPDATE linguagem_projeto SET comando_teste = 'sleep 31' WHERE projeto = 'loja'").run();
    banco.close();
    await pagina.goto(`${fabriquinha.base}/demandas/I-216`);
    await pagina.getByRole("button", { name: "Executar agora" }).click();
    await expect(pagina.locator(".dm-ticket", { hasText: "I-216.T1" })).toContainText("Em execução");
    // O comando de testes do projeto está rodando: a coleta começou.
    for (;;) {
      try {
        execFileSync("pgrep", ["-f", "sleep 31"], { stdio: "ignore" });
        break;
      } catch {
        await dormir(100);
      }
    }

    const saiu = once(fabriquinha.servico, "exit");
    execFileSync("pkill", ["-TERM", "-f", "sleep 31"]);
    fabriquinha.servico.kill("SIGTERM");
    const codigo = (await saiu)[0] as number | null;
    expect(codigo).toBe(0);
    expect(fabriquinha.stderr()).not.toContain("database is not open");
    expect(fabriquinha.stderr()).not.toMatch(/Error/);

    const nova = await fabriquinha.reiniciar();
    await pagina.goto(nova.link);
    await pagina.goto(`${nova.base}/demandas/I-216`);
    const ticket = pagina.locator(".dm-ticket", { hasText: "I-216.T1" });
    await expect(ticket).toContainText("Falhou");
    await expect(ticket).toContainText("serviço reiniciado");
  });
});
