// Parar o serviço com um ticket de demanda em execução (I-246, CA-1 a CA-3): o systemd manda o SIGTERM ao cgroup
// inteiro, então o serviço e o pi recebem o sinal juntos. A parada sai limpa e o ticket falha com "serviço reiniciado".
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as dormir } from "node:timers/promises";
import type { Page } from "@playwright/test";
import type { PassoPi } from "../../apoio-testes/falsos/pi_falso.ts";
import { motivoDaFalhaDoTicket, carregarDemanda } from "../../src/modulos/ciclo_de_vida/publico.ts";
import { abrirBancoDaFabriquinha, montarDemandasDoBanco } from "../../src/server/composicao/banco_da_fabriquinha.ts";
import { Projeto } from "../../src/modulos/demandas/publico.ts";
import { carregarSessoesDoContexto } from "../../src/modulos/sessoes/publico.ts";
import { sinalNoGrupo } from "../../src/shared/infra/processo.ts";
import { expect, projeto, test } from "../apoio.ts";
import { semearTicketAberto } from "../demandas-apoio.ts";
import { gravarProjeto } from "../../apoio-testes/demandas_de_teste.ts";

// Um pi que não termina sozinho: só o sinal o encerra.
const roteiroDoPiParado: PassoPi[] = [{ termina: "trava" }];

// Um pi que ignora o SIGTERM: só o SIGKILL do `parar`, passado o limite, o encerra.
const roteiroDoPiTeimoso: PassoPi[] = [{ termina: "trava", sigterm: "ignora" }];

test.describe("I-246 CA-4", () => {
  test.use({ roteiroDoPi: roteiroDoPiTeimoso });
  test("pi que ignora o SIGTERM: o serviço o mata no limite, sai limpo, e a subida seguinte mostra Falhou", async ({
    pagina,
    fabriquinha,
  }) => {
    test.setTimeout(60_000);
    projeto(fabriquinha.raiz);
    semearTicketAberto(fabriquinha.raiz);
    await pagina.goto(`${fabriquinha.base}/demandas/I-216`);
    await pagina.getByRole("button", { name: "Executar agora" }).click();
    await expect(pagina.locator(".dm-ticket", { hasText: "I-216.T1" })).toContainText(
      /Sessão pi ativa|Em execução \(sistema\)/,
    );

    let pgid: number | null = null;
    while (pgid === null) {
      await dormir(50);
      const banco = abrirBancoDaFabriquinha(fabriquinha.raiz);
      pgid =
        carregarSessoesDoContexto(banco, { demanda_id: "I-216", ticket_id: 1 }).execucoes[0]?.grupo_processo ?? null;
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
  await expect(pagina.locator(".dm-ticket", { hasText: "I-216.T1" })).toContainText(
    /Sessão pi ativa|Em execução \(sistema\)/,
  );
  let pgid: number | null = null;
  while (pgid === null) {
    await dormir(50);
    const banco = abrirBancoDaFabriquinha(raiz);
    pgid = carregarSessoesDoContexto(banco, { demanda_id: "I-216", ticket_id: 1 }).execucoes[0]?.grupo_processo ?? null;
    banco.close();
  }
  return pgid;
}

/** Logo depois da saída do serviço, antes de subir de novo: o fim e o motivo já estão no banco (não é a subida que os preenche). */
function conferirFimGravado(raiz: string): void {
  const banco = abrirBancoDaFabriquinha(raiz);
  const { execucoes } = carregarSessoesDoContexto(banco, { demanda_id: "I-216", ticket_id: 1 });
  const agregado = carregarDemanda(banco, "I-216");
  const ticket = agregado.tickets.find((t) => t.ticket_id === 1);
  banco.close();
  expect(execucoes).toHaveLength(1);
  expect(execucoes[0]?.fim).not.toBeNull();
  expect(agregado.tentativas.find((tentativa) => tentativa.processo_id === execucoes[0]?.id)?.resultado).toEqual({
    tipo: "falha_infraestrutura",
    causa: "servico_reiniciado",
    motivo: "serviço reiniciado",
  });
  expect(ticket?.estado).toBe("falhou");
  expect(ticket && motivoDaFalhaDoTicket(agregado.tentativas, ticket)).toBe("serviço reiniciado");
}

test.describe("I-246", () => {
  test.use({ roteiroDoPi: roteiroDoPiParado });
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
    test.use({ roteiroDoPi: roteiroDoPiParado });
    test("sai no limite, sem erro, sem pi lançado, e a subida seguinte mostra Falhou", async ({
      pagina,
      fabriquinha,
    }) => {
      test.setTimeout(60_000);
      projeto(fabriquinha.raiz);
      semearTicketAberto(fabriquinha.raiz);
      const banco = abrirBancoDaFabriquinha(fabriquinha.raiz);
      const projetoLoja = montarDemandasDoBanco(banco).projeto("loja");
      gravarProjeto(
        banco,
        Projeto.parse({
          ...projetoLoja,
          verificacoes: { ...projetoLoja.verificacoes, preparacao: [preparacao] },
        }),
      );
      banco.close();
      await pagina.goto(`${fabriquinha.base}/demandas/I-216`);
      await pagina.getByRole("button", { name: "Executar agora" }).click();
      // A preparação da worktree roda antes do pi: o ticket está em execução pelo sistema.
      await expect(pagina.locator(".dm-ticket", { hasText: "I-216.T1" })).toContainText("Em execução (sistema)");
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
    const banco = abrirBancoDaFabriquinha(fabriquinha.raiz);
    const arquivoComPidDaColeta = join(fabriquinha.raiz, "coleta.pid");
    banco
      .prepare("UPDATE linguagem_projeto SET comando_teste = ? WHERE projeto = 'loja'")
      .run(`sh -c 'echo $$ > ${arquivoComPidDaColeta}; exec sleep 31'`);
    banco.close();
    // Processo alheio, fora da árvore do serviço, com a mesma linha de comando da coleta: não pode receber sinal.
    const sleepAlheio = spawn("sleep", ["31"], { stdio: "ignore" });
    sleepAlheio.unref();
    await pagina.goto(`${fabriquinha.base}/demandas/I-216`);
    await pagina.getByRole("button", { name: "Executar agora" }).click();
    await expect(pagina.locator(".dm-ticket", { hasText: "I-216.T1" })).toContainText(
      /Sessão pi ativa|Em execução \(sistema\)/,
    );
    // O comando de testes do projeto está rodando: a coleta começou.
    while (!existsSync(arquivoComPidDaColeta) || readFileSync(arquivoComPidDaColeta, "utf8").trim() === "") {
      await dormir(100);
    }
    // Na coleta o pi já saiu: o ticket segue em execução pelo sistema.
    await pagina.reload();
    await expect(pagina.locator(".dm-ticket", { hasText: "I-216.T1" })).toContainText("Em execução (sistema)");

    const saiu = once(fabriquinha.servico, "exit");
    process.kill(Number(readFileSync(arquivoComPidDaColeta, "utf8")), "SIGTERM");
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
    expect(sleepAlheio.exitCode ?? sleepAlheio.signalCode).toBeNull(); // o sleep alheio seguiu vivo
    sleepAlheio.kill("SIGKILL");
  });
});

/** As execuções do I-216.T1 gravadas no banco, lidas por outra conexão enquanto o serviço roda. */
function execucoesDoT1(raiz: string): { grupo_processo?: number | null; fim?: string | null }[] {
  const banco = abrirBancoDaFabriquinha(raiz);
  const { execucoes } = carregarSessoesDoContexto(banco, { demanda_id: "I-216", ticket_id: 1 });
  banco.close();
  return execucoes;
}

/** O grupo de processo existe (o `kill -0` não lança). */
const grupoVivo = (pgid: number): boolean => {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch {
    return false;
  }
};

// MELHORIAS §5.2 e §5.3 (ticket 20): o serviço cai (SIGKILL, sem parada limpa) com o pi do T1 rodando. A identidade do
// processo (a execução e o grupo do pi) já estava gravada; a subida seguinte mata o pi órfão por ela e falha o ticket como
// "serviço reiniciado", e o 1º ciclo do agendador o retoma com uma execução nova só: nada roda em dobro, nada se perde.
test.describe("ticket 20: queda no meio da execução", () => {
  test.use({ roteiroDoPi: roteiroDoPiParado });
  test("a subida seguinte mata o pi órfão, e o ciclo seguinte retoma o ticket com uma execução nova só", async ({
    pagina,
    fabriquinha,
  }) => {
    test.setTimeout(150_000);
    projeto(fabriquinha.raiz);
    semearTicketAberto(fabriquinha.raiz);
    const pgidDaQueda = await executarEEsperarPi(pagina, fabriquinha.raiz, fabriquinha.base);

    const saiu = once(fabriquinha.servico, "exit");
    fabriquinha.servico.kill("SIGKILL");
    await saiu;
    expect(grupoVivo(pgidDaQueda)).toBe(true); // o pi sobreviveu à queda do serviço
    rmSync(join(fabriquinha.raiz, "web.url")); // a queda não apaga o link morto
    const banco = abrirBancoDaFabriquinha(fabriquinha.raiz);
    banco.exec("UPDATE configuracao SET agendador_ativo = 1, intervalo_min = 1");
    banco.close();

    const nova = await fabriquinha.reiniciar();
    await expect.poll(() => grupoVivo(pgidDaQueda)).toBe(false);
    const [daQueda] = execucoesDoT1(fabriquinha.raiz);
    expect(execucoesDoT1(fabriquinha.raiz)).toHaveLength(1);
    expect(daQueda?.fim).not.toBeNull();
    await pagina.goto(nova.link);
    await pagina.goto(`${nova.base}/demandas/I-216`);
    await expect(pagina.locator(".dm-ticket", { hasText: "I-216.T1" })).toContainText("serviço reiniciado");

    // O 1º ciclo (em ~60 s) devolve o ticket a aberto e o despacha de novo, num pi novo.
    await expect
      .poll(() => execucoesDoT1(fabriquinha.raiz)[1]?.grupo_processo ?? null, { timeout: 100_000 })
      .not.toBeNull();
    const execucoes = execucoesDoT1(fabriquinha.raiz);
    expect(execucoes).toHaveLength(2);
    expect(execucoes.filter((execucao) => execucao.fim === null)).toHaveLength(1);
    const pgidDaRetomada = Number(execucoes[1]?.grupo_processo);
    expect(pgidDaRetomada).not.toBe(pgidDaQueda);
    expect(grupoVivo(pgidDaRetomada)).toBe(true);
    await pagina.reload();
    await expect(pagina.locator(".dm-ticket", { hasText: "I-216.T1" })).toContainText(
      /Sessão pi ativa|Em execução \(sistema\)/,
    );
    await expect(pagina.locator(".dm-ticket", { hasText: "I-216.T2" })).toContainText("Aberto");
  });
});
