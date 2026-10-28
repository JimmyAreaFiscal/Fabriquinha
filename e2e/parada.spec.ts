// Parar o serviço com um ticket de demanda em execução (I-246, CA-1 a CA-3): o systemd manda o SIGTERM ao cgroup
// inteiro, então o serviço e o pi recebem o sinal juntos. A parada sai limpa e o ticket falha com "serviço reiniciado".
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { setTimeout as dormir } from "node:timers/promises";
import { abrir } from "../src/persistencia/banco.ts";
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

test.describe("I-246", () => {
  test.use({ pi: piParado });
  test("CA-1, CA-2: SIGTERM com ticket em execução sai limpo, e a subida seguinte o mostra Falhou", async ({
    pagina,
    fabriquinha,
  }) => {
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

    // Como o systemd: o pi e o serviço recebem o SIGTERM juntos.
    const saiu = once(fabriquinha.servico, "exit");
    sinalNoGrupo(pgid, "SIGTERM");
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

    const banco = abrir(fabriquinha.raiz);
    const { execucoes } = carregarSessoesDoTicket(banco, { demanda_id: "I-216", ticket_id: 1 });
    banco.close();
    expect(execucoes).toHaveLength(1);
    expect(execucoes[0]?.fim).not.toBeNull();

    await pagina.getByLabel(/Instrução/).fill("refazer depois da parada");
    await pagina.getByRole("button", { name: "Reabrir" }).click();
    await expect(pagina.getByRole("button", { name: "Reabrir" })).toHaveCount(0);
    await expect(pagina.getByText("Falhou", { exact: true })).toHaveCount(0);
  });
});
