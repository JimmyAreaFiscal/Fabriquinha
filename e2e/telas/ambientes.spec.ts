// Ambientes (I-307): pelo menu, a tabela do conjunto com o nome do slot, a imagem, o estado, o uso medido agora e o que
// roda em cada container; o uso muda na tela sem recarregar, e a rolagem lateral sobrevive à atualização de 5 s.
import type { TestInfo } from "@playwright/test";
import { inserirAmbienteAlocado, liberarAmbiente } from "../../apoio-testes/falsos/ambiente_falso.ts";
import {
  gravarAgregadoPronto,
  montarAgregadoDemanda,
  montarRodada,
  montarTicket,
} from "../../apoio-testes/cenarios/cenarios_de_demanda.ts";
import { abrirBancoDaFabriquinha } from "../../src/server/system/banco_da_fabriquinha.ts";
import { salvarConfiguracaoDoAmbiente } from "../../src/shared/armazenamento/configuracao_do_ambiente.ts";
import { ConfiguracaoDoAmbiente } from "../../src/shared/nucleo/configuracao_do_ambiente.ts";
import { expect, fotografar, projeto, test } from "../apoio.ts";

/** A imagem como o serviço a nomeia: a tag é o hash inteiro do contexto, longa o bastante para esticar a tabela. */
const IMAGEM_DO_SANDBOX = `fabriquinha/loja:${"6564fb5059c9ecead213e4a502ce546b".repeat(2)}`;

test("pelo menu, a linha do container ocupado traz o slot, a imagem, o estado, o uso e o que roda nele, e a do livre vem vazia (CA-1, CA-3)", async ({
  pagina,
  fabriquinha,
}, info: TestInfo) => {
  const { dockerFalso, raiz } = fabriquinha;
  projeto(raiz);
  const ocupado = dockerFalso.semearContainer({
    imagem: IMAGEM_DO_SANDBOX,
    rotulos: { "fabriquinha.ambiente": "amb-1" },
    uso: { cpu: "37.50%", memoria: "300.4MiB / 2GiB" },
  });
  const livre = dockerFalso.semearContainer({
    imagem: IMAGEM_DO_SANDBOX,
    rotulos: { "fabriquinha.ambiente": "amb-2" },
    uso: { cpu: "0.00%", memoria: "12MiB / 2GiB" },
  });
  const banco = abrirBancoDaFabriquinha(raiz);
  gravarAgregadoPronto(
    banco,
    montarAgregadoDemanda("I-12", "em_execucao", {
      tickets: [montarTicket("I-12", 3, "implementar", { rodada_id: 1, estado: "em_execucao" })],
      rodadas: [montarRodada("I-12", 1, "implementar")],
    }),
  );
  for (const [id, container_id, slot, alocado_para] of [
    ["amb-1", ocupado.id, 1, "I-12.R1"],
    ["amb-2", livre.id, 2, "I-7"],
  ] as const)
    inserirAmbienteAlocado(banco, {
      id,
      container_id,
      imagem: IMAGEM_DO_SANDBOX,
      slot,
      alocado_para,
      criado_em: "2026-11-09T12:00:00.000Z",
    });
  liberarAmbiente(banco, "amb-2", "livre", "2026-11-09T13:00:00.000Z");
  salvarConfiguracaoDoAmbiente(banco, ConfiguracaoDoAmbiente.parse({ tipo: "container" }));
  banco.close();

  await pagina.getByRole("navigation", { name: "Páginas" }).getByRole("link", { name: "Ambientes" }).click();

  await expect(pagina.locator(".tabela thead th")).toHaveText([
    "Container",
    "Imagem",
    "Estado",
    "CPU",
    "Memória",
    "Projeto",
    "Demanda",
    "Ticket",
    "Worktree",
    "Branch",
  ]);
  const celulasDoOcupado = pagina.locator('tr[data-container="amb-1"] td');
  await expect(celulasDoOcupado).toHaveText([
    "Fabriquinha - Slot 1",
    IMAGEM_DO_SANDBOX,
    "alocado",
    "0,38 CPUs",
    "300 MB",
    "loja",
    "I-12",
    "I-12.T3",
    "loja/I-12/rodadas/1",
    "fabriquinha/I-12-1",
  ]);
  await expect(celulasDoOcupado.nth(8)).toHaveAttribute("title", `${raiz}/worktrees/loja/I-12/rodadas/1`);
  await expect(celulasDoOcupado.nth(1)).toHaveAttribute("title", IMAGEM_DO_SANDBOX);
  await expect(pagina.locator('tr[data-container="amb-2"] td')).toHaveText([
    "Fabriquinha - Slot 2",
    IMAGEM_DO_SANDBOX,
    "livre",
    "0,00 CPUs",
    "12 MB",
    "—",
    "—",
    "—",
    "—",
    "—",
  ]);

  // Na largura de um notebook a tabela cabe sem rolar; no celular ela rola de lado dentro dela, nunca a página.
  const tabelaRolavel = pagina.locator("[data-rolagem-dos-ambientes]");
  const botaoDoTema = pagina.getByRole("button", { name: /Tema (claro|escuro)/ });
  for (const tema of ["escuro", "claro"]) {
    for (const largura of [1440, 1024, 375]) {
      await pagina.setViewportSize({ width: largura, height: 700 });
      expect(await pagina.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const sobra = await tabelaRolavel.evaluate((elemento) => elemento.scrollWidth - elemento.clientWidth);
      if (largura >= 1024) expect(sobra, `a tabela rola de lado em ${String(largura)} px`).toBe(0);
      await fotografar(pagina, info, `ambientes-${tema}-${String(largura)}`);
    }
    await botaoDoTema.click();
  }
  // Rolada até o fim no celular, a Worktree e a Branch aparecem.
  await pagina.setViewportSize({ width: 375, height: 700 });
  await celulasDoOcupado.nth(9).scrollIntoViewIfNeeded();
  await expect(celulasDoOcupado.nth(8)).toBeInViewport();
  await expect(celulasDoOcupado.nth(9)).toBeInViewport();
  await fotografar(pagina, info, "ambientes-escuro-375-rolada");
});

test("o uso do container muda na tela em poucos segundos, sem recarregar e sem perder a rolagem lateral (CA-2)", async ({
  pagina,
  fabriquinha,
}) => {
  const { dockerFalso, raiz } = fabriquinha;
  const ocupado = dockerFalso.semearContainer({
    imagem: IMAGEM_DO_SANDBOX,
    rotulos: { "fabriquinha.ambiente": "amb-1" },
    uso: { cpu: "37.50%", memoria: "300MiB / 2GiB" },
  });
  const banco = abrirBancoDaFabriquinha(raiz);
  inserirAmbienteAlocado(banco, {
    id: "amb-1",
    container_id: ocupado.id,
    imagem: IMAGEM_DO_SANDBOX,
    slot: 1,
    alocado_para: "I-12.R1",
    criado_em: "2026-11-09T12:00:00.000Z",
  });
  salvarConfiguracaoDoAmbiente(banco, ConfiguracaoDoAmbiente.parse({ tipo: "container" }));
  banco.close();
  await pagina.setViewportSize({ width: 375, height: 700 });
  await pagina.goto(`${fabriquinha.base}/ambientes`);
  const celulasDoOcupado = pagina.locator('tr[data-container="amb-1"] td');
  await expect(celulasDoOcupado.nth(3)).toHaveText("0,38 CPUs");
  // Uma marca no `window` some se a página recarregar. A tela se redesenha a cada 5 s; os 15 s cobrem a máquina carregada.
  await pagina.evaluate(() => {
    Object.assign(window, { marcaSemRecarregar: true });
  });
  const tabelaRolavel = pagina.locator("[data-rolagem-dos-ambientes]");
  const rolagemNoFim = await tabelaRolavel.evaluate((elemento) => {
    elemento.scrollLeft = elemento.scrollWidth;
    return elemento.scrollLeft;
  });
  expect(rolagemNoFim).toBeGreaterThan(0);

  dockerFalso.mudarUso(ocupado.id, { cpu: "150.00%", memoria: "1GiB / 2GiB" });

  await expect(celulasDoOcupado.nth(3)).toHaveText("1,50 CPUs", { timeout: 15_000 });
  await expect(celulasDoOcupado.nth(4)).toHaveText("1.024 MB");
  expect(await pagina.evaluate(() => "marcaSemRecarregar" in window)).toBe(true);
  expect(await tabelaRolavel.evaluate((elemento) => elemento.scrollLeft)).toBe(rolagemNoFim);
});

test("no host_local a tela diz que o trabalho roda no host e não há containers (CA-4)", async ({
  pagina,
  fabriquinha,
}, info: TestInfo) => {
  await pagina.goto(`${fabriquinha.base}/ambientes`);
  await expect(pagina.getByText("O trabalho roda no host: não há containers.")).toBeVisible();
  await expect(pagina.locator("table")).toHaveCount(0);
  await fotografar(pagina, info, "ambientes-host-local");
});
