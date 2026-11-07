// Entrada do `npm run estresse`: sobe o ambiente temporário, mede cada ação (40 chamadas, 20 simultâneas), imprime a
// tabela, grava o JSON em estresse/resultados/ e sai com 1 por erro, p95 acima do orçamento ou rota ou comando sem medição.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { subirAmbiente } from "./ambiente.ts";
import { acoesCli, semMedicaoCli } from "./grupos/cli.ts";
import {
  acoesEtapas,
  EXECUCOES,
  SIMULTANEAS as SIMULTANEAS_ETAPAS,
  semMedicao as etapasSemMedicao,
} from "./grupos/etapas.ts";
import { acoesHttpLeitura, semMedicao } from "./grupos/http_leitura.ts";
import { acoesHttpMutacao, semMedicao as semMedicaoMutacao } from "./grupos/http_mutacao.ts";
import { CHAMADAS, type Medicao, medir } from "./medir.ts";

const SIMULTANEAS_HTTP = 20;

const amb = await subirAmbiente();
// Morto pelo tempo limite (SIGTERM) ou por Ctrl+C, o `finally` não roda: o ambiente cai junto e a raiz temporária some.
for (const sinal of ["SIGTERM", "SIGINT"] as const) {
  process.once(sinal, () => {
    void amb.encerrar().finally(() => process.exit(1));
  });
}
let medidas: [string, Medicao][];
let faltando: string[];
try {
  const leitura = await acoesHttpLeitura(amb);
  const mutacao = await acoesHttpMutacao(amb);
  const http = [...leitura, ...mutacao];
  faltando = [...semMedicao(leitura), ...semMedicaoMutacao(mutacao)];
  medidas = [];
  const medirTodas = async (acoes: { nome: string; orcamento: number; chamar(): Promise<number> }[]) => {
    for (const a of acoes) {
      const m = await medir(() => a.chamar(), { n: CHAMADAS, concorrencia: SIMULTANEAS_HTTP, orcamento: a.orcamento });
      medidas.push([a.nome, m]);
    }
  };
  await medirTodas(http.map((a) => ({ ...a, nome: `${a.metodo} ${a.caminho}` })));
  // O grupo do CLI semeia centenas de demandas: só depois das rotas, para não pesar nas leituras de lista.
  const cli = acoesCli(amb);
  faltando.push(...semMedicaoCli(cli));
  await medirTodas(cli);
  const etapas = acoesEtapas(amb);
  faltando.push(...etapasSemMedicao(etapas));
  for (const a of etapas) {
    const m = await medir(() => a.chamar(), { n: EXECUCOES, concorrencia: SIMULTANEAS_ETAPAS, orcamento: a.orcamento });
    medidas.push([a.etapa, m]);
  }
} finally {
  const log = await amb.encerrar();
  if (log) process.stderr.write(log);
}

const ms = (v: number) => v.toFixed(1);
const colunas = ["ação", "n", "p50", "p95", "max", "erros", "orçamento"];
const linhas = medidas.map(([nome, m]) => [
  nome,
  String(m.n),
  ms(m.p50),
  ms(m.p95),
  ms(m.max),
  String(m.erros),
  `${String(m.orcamento)}${m.acimaDoOrcamento ? " ACIMA" : ""}`,
]);
const larguras = colunas.map((c, i) => Math.max(c.length, ...linhas.map((l) => (l[i] ?? "").length)));
const formatar = (l: string[]) =>
  l.map((c, i) => (i === 0 ? c.padEnd(larguras[i] ?? 0) : c.padStart(larguras[i] ?? 0))).join("  ");
console.log([formatar(colunas), ...linhas.map(formatar)].join("\n"));
for (const [nome, m] of medidas)
  if (m.primeiroErro) console.log(`Erro em ${nome} (${String(m.erros)}): ${m.primeiroErro}`);
for (const rota of faltando) console.log(`Sem medição: ${rota}`);

const pasta = join(import.meta.dirname, "resultados");
mkdirSync(pasta, { recursive: true });
const arquivo = join(pasta, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(arquivo, JSON.stringify({ acoes: Object.fromEntries(medidas), semMedicao: faltando }, null, 2));
console.log(`Resultado: ${arquivo}`);

if (faltando.length > 0 || medidas.some(([, m]) => m.erros > 0 || m.acimaDoOrcamento)) process.exitCode = 1;
