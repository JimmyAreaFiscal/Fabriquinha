import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { ErroExterno } from "../../../../shared/nucleo/erros.ts";
import type { AgenteComCredencial } from "../infra/credenciais_dos_agentes.ts";
import { CredenciaisDosContainers } from "./credenciais_dos_containers.ts";

const base = mkdtempSync(join(tmpdir(), "fabriquinha-credenciais-dos-containers-"));
after(() => {
  rmSync(base, { recursive: true, force: true });
});

const MINUTO = 60_000;
const INICIO = Date.parse("2026-11-18T12:00:00Z");

let ultimoHost = 0;
/** Um host de teste: a credencial do Claude e a do pi, que o teste reescreve, e o gerador e o relógio falsos. */
function cenario(
  renovar: (agente: AgenteComCredencial, provedor: string) => Promise<boolean> = () => Promise.resolve(true),
) {
  const home = join(base, `home-${String(++ultimoHost)}`);
  const dirDoPi = join(home, "pi");
  mkdirSync(join(home, ".claude"), { recursive: true });
  mkdirSync(dirDoPi);
  const gravarClaude = (accessToken: string, expiresAt: number) => {
    writeFileSync(
      join(home, ".claude", ".credentials.json"),
      JSON.stringify({ claudeAiOauth: { accessToken, refreshToken: "renovacao", expiresAt } }),
    );
  };
  const gravarPi = (access: string, expires: number) => {
    writeFileSync(
      join(dirDoPi, "auth.json"),
      JSON.stringify({ "openai-codex": { type: "oauth", access, refresh: "renovacao", expires } }),
    );
  };
  gravarClaude("claude-1", INICIO + 8 * 60 * MINUTO);
  gravarPi("pi-1", INICIO + 10 * 24 * 60 * MINUTO);
  const gravadas: { containerId: string; caminho: string; conteudo: string }[] = [];
  const gerador = {
    gravarCredencial: (containerId: string, caminho: string, conteudo: string) => {
      if (containerId === "container-que-falha") return Promise.reject(new Error("docker fora do ar"));
      gravadas.push({ containerId, caminho, conteudo });
      return Promise.resolve();
    },
  };
  const relogio = { instante: INICIO, agora: () => new Date(relogio.instante).toISOString() };
  const renovacoes: string[] = [];
  const credenciais = new CredenciaisDosContainers(
    gerador,
    {
      copias: { dir_do_pi: dirDoPi, home_do_usuario: home },
      instalacaoDoPi: () => ({ comando: "pi", executavel: "pi", raiz: home }),
    },
    relogio,
    (agente, provedor) => {
      renovacoes.push(`${agente}/${provedor}`);
      return renovar(agente, provedor);
    },
  );
  return { credenciais, gravadas, relogio, renovacoes, gravarClaude, gravarPi };
}

test("levarAoContainer grava cada credencial enxuta e, depois, só a que mudou no host", async () => {
  const { credenciais, gravadas, gravarClaude } = cenario();
  await credenciais.levarAoContainer("c1");
  assert.deepEqual(
    gravadas.map(({ containerId, caminho }) => `${containerId}:${caminho}`),
    ["c1:.pi/agent/auth.json", "c1:.claude/.credentials.json"],
  );
  assert.ok(gravadas.every(({ conteudo }) => !conteudo.includes("renovacao")));
  await credenciais.levarAoContainer("c1");
  assert.equal(gravadas.length, 2);
  gravarClaude("claude-2", INICIO + 16 * 60 * MINUTO);
  await credenciais.levarAoContainer("c1");
  assert.deepEqual(
    gravadas.slice(2).map(({ caminho }) => caminho),
    [".claude/.credentials.json"],
  );
  assert.match(gravadas[2]?.conteudo ?? "", /claude-2/);
});

test("exigirCredenciaisValidas recusa como falha externa a credencial cujos tokens venceram, sem mostrar o token", () => {
  const { credenciais, relogio, gravarPi } = cenario();
  credenciais.exigirCredenciaisValidas();
  relogio.instante = INICIO + 9 * 60 * MINUTO;
  assert.throws(
    () => {
      credenciais.exigirCredenciaisValidas();
    },
    (erro: unknown) =>
      erro instanceof ErroExterno &&
      /a credencial do Claude no host venceu.*claude auth login/s.test(erro.message) &&
      !erro.message.includes("claude-1"),
  );
  gravarPi("pi-2", INICIO);
  assert.throws(() => {
    credenciais.exigirCredenciaisValidas();
  }, /do pi e do Claude no host venceu.*pi auth login openai-codex; claude auth login/s);
});

test("manter renova no host o que está para vencer e leva o novo aos containers alocados", async () => {
  const cenarioQueRenova = cenario((agente) => {
    if (agente === "Claude") cenarioQueRenova.gravarClaude("claude-renovado", INICIO + 16 * 60 * MINUTO);
    return Promise.resolve(true);
  });
  const { credenciais, gravadas, relogio, renovacoes } = cenarioQueRenova;
  const erros: unknown[] = [];
  await credenciais.levarAoContainer("c1");
  await credenciais.levarAoContainer("liberado");
  // Longe de vencer, nada é renovado nem copiado de novo.
  await credenciais.manter(["c1"], (erro) => erros.push(erro));
  assert.deepEqual(renovacoes, []);
  assert.equal(gravadas.length, 4);
  // O Claude só renova nos 5 min finais.
  relogio.instante = INICIO + 8 * 60 * MINUTO - 4 * MINUTO;
  await credenciais.manter(["c1", "c2"], (erro) => erros.push(erro));
  assert.deepEqual(renovacoes, ["Claude/claude.ai"]);
  assert.deepEqual(
    gravadas.slice(4).map(({ containerId, caminho }) => `${containerId}:${caminho}`),
    ["c1:.claude/.credentials.json", "c2:.pi/agent/auth.json", "c2:.claude/.credentials.json"],
  );
  assert.match(gravadas[4]?.conteudo ?? "", /claude-renovado/);
  assert.deepEqual(erros, []);
  // O container que saiu do conjunto é esquecido: alocado de novo, recebe tudo outra vez.
  await credenciais.levarAoContainer("liberado");
  assert.equal(gravadas.length, 9);
});

test("manter registra uma vez a renovação que falha, e só tenta de novo 30 min depois", async () => {
  let renovaDeVerdade = false;
  const cenarioQueFalha = cenario(() => {
    if (renovaDeVerdade) cenarioQueFalha.gravarClaude("claude-renovado", INICIO + 16 * 60 * MINUTO);
    return Promise.resolve(renovaDeVerdade);
  });
  const { credenciais, relogio, renovacoes } = cenarioQueFalha;
  const erros: unknown[] = [];
  const registrar = (erro: unknown) => erros.push(erro);
  relogio.instante = INICIO + 8 * 60 * MINUTO - MINUTO;
  await credenciais.manter(["container-que-falha"], registrar);
  relogio.instante += MINUTO / 2;
  await credenciais.manter([], registrar);
  assert.deepEqual(renovacoes, ["Claude/claude.ai"]);
  assert.equal(erros.length, 2);
  assert.match(
    String(erros[0]),
    /renovação da credencial do Claude \(claude\.ai\) no host não a renovou.*claude auth login/s,
  );
  assert.match(String(erros[1]), /docker fora do ar/);
  // 30 min depois tenta de novo; falhando outra vez, não registra de novo.
  relogio.instante += 30 * MINUTO;
  await credenciais.manter([], registrar);
  assert.equal(renovacoes.length, 2);
  assert.equal(erros.length, 2);
  // O agente que sai bem mas não renova também é falha; o que renova limpa a falha.
  relogio.instante += 30 * MINUTO;
  renovaDeVerdade = true;
  await credenciais.manter([], registrar);
  assert.equal(renovacoes.length, 3);
  assert.equal(erros.length, 2);
});

test("manter conta como falha o agente que sai bem sem renovar", async () => {
  const { credenciais, relogio } = cenario(() => Promise.resolve(true));
  const erros: unknown[] = [];
  relogio.instante = INICIO + 8 * 60 * MINUTO - MINUTO;
  await credenciais.manter([], (erro) => erros.push(erro));
  assert.equal(erros.length, 1);
});
