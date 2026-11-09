// Aula do código (F3 §4.5) contra um git real: cada trecho conferido contra o diff da última revisão, e o HTML com o
// código lido do git, a linha alterada marcada e a explicação escapada.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { AgregadoDemanda, type EvidenciaDemanda, type TicketDemanda } from "../../nucleo/agregado_demanda.ts";
import { ErroDeRegra } from "../../nucleo/erros.ts";
import type { ComandoNoAmbiente } from "../../infra/ambiente/ambiente.ts";
import { AmbienteHostLocal } from "../../infra/ambiente/ambiente_host_local.ts";
import { faixas, gerarAula, linhasMudadas, type Trecho } from "./aula.ts";

/** O host local registrando cada comando que recebe, para provar que o git passou pelo Ambiente. */
class AmbienteQueRegistra extends AmbienteHostLocal {
  readonly argumentosRecebidos: string[][] = [];
  override executar(comando: ComandoNoAmbiente) {
    this.argumentosRecebidos.push(comando.argumentos);
    return super.executar(comando);
  }
}

const ambiente = new AmbienteQueRegistra();
const repo = mkdtempSync(join(tmpdir(), "fabriquinha-aula-"));
after(() => {
  rmSync(repo, { recursive: true, force: true });
});
const git = (...args: string[]) =>
  execFileSync("git", ["-c", "user.name=A", "-c", "user.email=a@a", ...args], { cwd: repo })
    .toString()
    .trim();
git("init", "-q");
writeFileSync(join(repo, "busca.ts"), "const a = 1;\nconst b = 2;\nconst c = 3;\n");
writeFileSync(join(repo, "velho.ts"), "x\n");
git("add", ".");
git("commit", "-q", "-m", "base");
const base = git("rev-parse", "HEAD");
writeFileSync(join(repo, "busca.ts"), "const a = 1;\nconst b = <b>;\nconst c = 3;\nconst d = 4;\n");
writeFileSync(join(repo, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1]));
git("rm", "-q", "velho.ts");
git("add", ".");
git("commit", "-q", "-m", "alteração");
const head = git("rev-parse", "HEAD");
// A branch da demanda avançou com a mesma mudança de busca.ts (o merge de outra rodada): o diff direto fica vazio.
git("checkout", "-q", "-b", "demanda", base);
writeFileSync(join(repo, "busca.ts"), "const a = 1;\nconst b = <b>;\nconst c = 3;\nconst d = 4;\n");
git("commit", "-q", "-am", "outra rodada");
const baseAvancada = git("rev-parse", "HEAD");
git("checkout", "-q", "-");

const AGORA = "2026-10-15T12:00:00.000Z";
const revisao: TicketDemanda = {
  demanda_id: "I-1",
  ticket_id: 5,
  etapa: "revisar_rodada",
  estado: "concluido",
  estado_alterado_em: AGORA,
  criado_por: { tipo: "fabriquinha" },
};
const alterados: EvidenciaDemanda = {
  demanda_id: "I-1",
  rodada_id: undefined,
  ticket_id: 5,
  tipo: "arquivos_alterados",
  autor: { tipo: "externo", ferramenta: "claude", sessao: "s1" },
  dados: {
    base,
    head,
    arquivos: [
      { caminho: "busca.ts", status: "M", adicionadas: 2, removidas: 1, previsto: "busca.ts" },
      { caminho: "logo.png", status: "A", adicionadas: null, removidas: null, previsto: null },
      { caminho: "velho.ts", status: "D", adicionadas: 0, removidas: 1, previsto: null },
    ],
    previstosNaoTocados: [],
  },
  em: AGORA,
};
const ag = (troca: Partial<AgregadoDemanda> = {}): AgregadoDemanda =>
  AgregadoDemanda.parse({
    demanda: {
      id: "I-1",
      projeto: "loja",
      titulo: "Busca <rápida>",
      tipo: "problema",
      descricao: "d",
      estado: "em_execucao",
      estado_alterado_em: AGORA,
      criada_por: { tipo: "externo", ferramenta: "claude", sessao: "s1" },
      enviada: true,
      branch: "fabriquinha/I-1",
    },
    tickets: [revisao],
    decisoes: [],
    evidencias: [alterados],
    ...troca,
  });

const trecho = (troca: Partial<Trecho> = {}): Trecho => ({
  arquivo: "busca.ts",
  inicio: 1,
  fim: 3,
  oQueFaz: "define b",
  porQue: "b <muda>",
  decisaoDoDesenho: "constantes no topo",
  ...troca,
});

const recusa = (mensagem: string) => (e: unknown) => e instanceof ErroDeRegra && e.message === mensagem;

test("linhasMudadas e faixas: as linhas novas dos cabeçalhos do diff, em faixas legíveis", () => {
  assert.deepEqual([...linhasMudadas("@@ -2 +2 @@\n-x\n+y\n@@ -4,0 +5,2 @@\n+a\n+b\n@@ -9,3 +10,0 @@\n")], [2, 5, 6]);
  assert.equal(faixas(new Set([7, 1, 2, 3, 9, 10])), "1-3, 7, 9-10");
  assert.equal(faixas(new Set()), "");
});

test("a aula: o código do git na ordem dos trechos, a linha alterada marcada e o texto do agente escapado", async () => {
  const html = await gerarAula(ambiente, ag(), repo, [
    trecho({ alternativaDescartada: "ler do .env" }),
    trecho({ inicio: 4, fim: 4, oQueFaz: "define d" }),
  ]);
  for (const subcomando of ["show", "diff"]) {
    assert.ok(ambiente.argumentosRecebidos.some((a) => a.includes(subcomando)));
  }
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<title>Aula do código da I-1<\/title>/);
  assert.match(html, /<h1>Aula do código da I-1: Busca &lt;rápida&gt;<\/h1>/);
  assert.match(html, /<li><a href="#t1"><code>busca\.ts<\/code><\/a> — define b<\/li><li><a href="#t2">/);
  assert.match(
    html,
    /<tr><td class="n">1<\/td><td class="m"><\/td><td class="c">const a = 1;<\/td><\/tr><tr class="mudou"><td class="n">2<\/td><td class="m">\+<\/td><td class="c">const b = &lt;b&gt;;<\/td><\/tr>/,
  );
  assert.match(html, /<span class="linhas">linhas 1–3<\/span>.*<span class="linhas">linha 4<\/span>/s);
  assert.match(
    html,
    /<dt>Por que assim<\/dt><dd>b &lt;muda&gt;<\/dd><dt>Decisão do desenho<\/dt><dd>constantes no topo<\/dd>/,
  );
  assert.match(html, /<dt>Alternativa descartada<\/dt><dd>ler do \.env<\/dd>/);
  assert.equal(html.match(/Alternativa descartada/g)?.length, 1, "só no trecho que a traz");
  assert.match(html, /@media \(prefers-color-scheme: dark\)/);
});

test("a aula recusa o que não é código alterado pela demanda, dizendo onde procurar", async () => {
  await assert.rejects(
    gerarAula(ambiente, ag({ evidencias: [] }), repo, [trecho()]),
    recusa("a demanda não tem revisão concluída com arquivos_alterados (a aula vem depois da revisão)"),
  );
  for (const arquivo of ["nada.ts", "velho.ts"]) {
    await assert.rejects(
      gerarAula(ambiente, ag(), repo, [trecho({ arquivo })]),
      recusa(
        `${arquivo} não é um arquivo criado ou alterado pela demanda (escolha um da lista: busca.ts, logo.png, velho.ts)`,
      ),
    );
  }
  await assert.rejects(
    gerarAula(ambiente, ag(), repo, [trecho({ arquivo: "logo.png" })]),
    recusa("logo.png é binário (explique arquivos binários na mensagem do PR)"),
  );
  await assert.rejects(
    gerarAula(ambiente, ag(), repo, [trecho({ fim: 5 })]),
    recusa("busca.ts:1-5 passa do fim do arquivo (busca.ts tem 4 linhas)"),
  );
  await assert.rejects(
    gerarAula(ambiente, ag(), repo, [trecho(), trecho({ inicio: 1, fim: 1 })]),
    recusa("busca.ts:1-1 não toca nenhuma linha alterada pela demanda (as linhas alteradas de busca.ts são 2, 4)"),
  );
});

test("a aula confere o trecho contra o diff desde o ancestral comum, como o arquivos_alterados", async () => {
  const avancada = { ...alterados, dados: { ...alterados.dados, base: baseAvancada } };
  const html = await gerarAula(ambiente, ag({ evidencias: [avancada] }), repo, [trecho()]);
  assert.match(html, /<tr class="mudou"><td class="n">2<\/td>/);
});
