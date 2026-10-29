// Entrada do `npm run estresse`: sobe o ambiente temporário, mede cada ação (200 chamadas, 20 simultâneas), imprime a
// tabela, grava o JSON em estresse/resultados/ e sai com 1 por erro, p95 acima do orçamento ou rota sem medição.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { subirAmbiente } from "./ambiente.ts";
import { acoesHttpLeitura, semMedicao } from "./grupos/http_leitura.ts";
import { type Medicao, medir } from "./medir.ts";

const CHAMADAS = 200;
const SIMULTANEAS = 20;

const amb = await subirAmbiente();
let medidas: [string, Medicao][];
let faltando: string[];
try {
  const acoes = await acoesHttpLeitura(amb);
  faltando = semMedicao(acoes);
  medidas = [];
  for (const a of acoes) {
    const m = await medir(() => a.chamar(), { n: CHAMADAS, concorrencia: SIMULTANEAS, orcamento: a.orcamento });
    medidas.push([`${a.metodo} ${a.caminho}`, m]);
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
for (const rota of faltando) console.log(`Sem medição: ${rota}`);

const pasta = join(import.meta.dirname, "resultados");
mkdirSync(pasta, { recursive: true });
const arquivo = join(pasta, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(arquivo, JSON.stringify({ acoes: Object.fromEntries(medidas), semMedicao: faltando }, null, 2));
console.log(`Resultado: ${arquivo}`);

if (faltando.length > 0 || medidas.some(([, m]) => m.erros > 0 || m.acimaDoOrcamento)) process.exitCode = 1;
