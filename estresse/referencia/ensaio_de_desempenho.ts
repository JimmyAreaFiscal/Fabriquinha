// Entrada do `npm run estresse:referencia`: para cada volume sintético, semeia um banco temporário, serve o web de
// verdade neste processo (o contador de execuções SQL só enxerga os statements do próprio processo) e mede as rotas de
// leitura das telas, uma por vez: 1 chamada conta as execuções SQL, e as seguintes dão o p50 e o p95. Grava o relatório
// em estresse/referencia/referencia.md, ou no arquivo pedido (`npm run estresse:referencia -- <arquivo>`), para comparar
// com a referência sem sobrescrevê-la.
import { montarCicloDeVidaDoBanco, montarDemandasDoBanco } from "../../src/server/system/banco_da_fabriquinha.ts";
import { once } from "node:events";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { cpus } from "node:os";
import { join, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { abrirBancoTemporario } from "../../apoio-testes/banco/banco_temporario.ts";
import { somarMeses } from "../../src/shared/nucleo/periodo.ts";
import { mesDoInstante, relogioDoSistema } from "../../src/shared/nucleo/relogio.ts";
import { noLog } from "../../src/shared/infra/registro.ts";
import { montarAmbientesDoServico } from "../../src/server/system/ambientes_do_servico.ts";
import { servirWeb } from "../../src/server/system/api/servidor.ts";
import { cronometrar } from "../grupos/http_leitura.ts";
import { medir } from "../medir.ts";
import { contarExecucoesSql } from "./contador_de_execucoes_sql.ts";
import { type MedicaoDaRota, type MedicoesDoVolume, montarRelatorioDaReferencia } from "./relatorio_da_referencia.ts";
import { type AlvosDasRotas, semearVolume, VOLUMES_SINTETICOS } from "./semeadura_dos_volumes.ts";
import { montarRepositorio } from "../../src/modulos/repositorio/publico.ts";

const CHAMADAS_POR_ROTA = 20;

/** As rotas que cada tela pede ao abrir, com a query que ela manda (os filtros padrão de cada uma). */
function rotasDasTelas(alvos: AlvosDasRotas, mesAtual: string): { tela: string; caminho: string }[] {
  const dozeMeses = `de=${somarMeses(mesAtual, -11)}&ate=${mesAtual}`;
  return [
    { tela: "Início", caminho: "/api/inicio" },
    { tela: "Menu", caminho: "/api/pendencias/quantidade" },
    { tela: "Início", caminho: "/api/despacho" },
    { tela: "Board", caminho: "/api/demandas" },
    { tela: "Demanda", caminho: `/api/demandas/${alvos.demandaEmExecucao}` },
    { tela: "Projeto", caminho: "/api/projetos" },
    {
      tela: "Projeto",
      caminho: `/api/projetos/${alvos.projeto}/demandas?concluidas=false&arquivadas=false&canceladas=false`,
    },
    { tela: "Projeto", caminho: `/api/metricas?projeto=${alvos.projeto}&de=${mesAtual}&ate=${mesAtual}` },
    { tela: "Histórico", caminho: "/api/sessoes?escopo=historico" },
    { tela: "Histórico", caminho: `/api/sessoes/${alvos.sessaoTerminada}` },
    { tela: "Métricas", caminho: `/api/metricas?${dozeMeses}` },
    { tela: "Métricas", caminho: `/api/metricas/demandas?${dozeMeses}` },
  ];
}

/** O web de verdade sobre `banco`, numa porta livre, já com o cookie da entrada pelo link do `web.url`. */
async function servirNumaPortaLivre(banco: DatabaseSync, raiz: string) {
  const servidor = createServer();
  servidor.listen(0, "127.0.0.1");
  await once(servidor, "listening");
  const { port: porta } = servidor.address() as AddressInfo;
  const ambientes = await montarAmbientesDoServico({ banco, raiz, porta, registrarErro: noLog });
  const repositorio = montarRepositorio({ banco: banco, ambientes: ambientes.gestao });
  servidor.on(
    "request",
    servirWeb({
      banco,
      raiz,
      porta,
      cicloDeVida: {
        ...montarCicloDeVidaDoBanco(banco, { ambientes: ambientes.gestao, repositorio }),
        proximaBusca: () => new Date().toISOString(),
      },
      ambientes,
      demandas: montarDemandasDoBanco(banco),
      repositorio,
      relogio: relogioDoSistema,
      registrarErro: noLog,
    }),
  );
  const linkDeEntrada = readFileSync(join(raiz, "web.url"), "utf8");
  const entrada = await fetch(linkDeEntrada, { redirect: "manual" });
  const cookie = entrada.headers.getSetCookie()[0]?.split(";")[0] ?? "";
  const encerrar = async () => {
    servidor.closeAllConnections();
    servidor.close();
    await once(servidor, "close");
    await ambientes.gestao.parar();
  };
  return { acesso: { base: new URL(linkDeEntrada).origin, cookie }, encerrar };
}

async function medirVolume(volume: (typeof VOLUMES_SINTETICOS)[number]): Promise<MedicoesDoVolume> {
  const { raiz, banco, fechar } = abrirBancoTemporario();
  try {
    const agora = new Date();
    const alvos = semearVolume(banco, volume, agora);
    const { acesso, encerrar } = await servirNumaPortaLivre(banco, raiz);
    try {
      const rotas: MedicaoDaRota[] = [];
      for (const { tela, caminho } of rotasDasTelas(alvos, mesDoInstante(agora.toISOString()))) {
        const chamarRota = () => cronometrar(acesso, caminho, false);
        const execucoesSql = await contarExecucoesSql(chamarRota);
        const medicao = await medir(chamarRota, {
          n: CHAMADAS_POR_ROTA,
          concorrencia: 1,
          orcamento: Number.POSITIVE_INFINITY,
        });
        if (medicao.erros > 0) throw new Error(`${volume.nome}, ${caminho}: ${String(medicao.primeiroErro)}`);
        rotas.push({ tela, caminho, p50: medicao.p50, p95: medicao.p95, execucoesSql });
        console.log(`${volume.nome}  ${caminho}  p95 ${medicao.p95.toFixed(1)} ms  ${String(execucoesSql)} SQL`);
      }
      return { volume, rotas };
    } finally {
      await encerrar();
    }
  } finally {
    fechar();
  }
}

const arquivoDoRelatorio = resolve(process.argv[2] ?? join(import.meta.dirname, "referencia.md"));
const medicoesPorVolume: MedicoesDoVolume[] = [];
for (const volume of VOLUMES_SINTETICOS) medicoesPorVolume.push(await medirVolume(volume));
writeFileSync(
  arquivoDoRelatorio,
  montarRelatorioDaReferencia(medicoesPorVolume, {
    medidaEm: new Date().toISOString(),
    maquina: `${cpus()[0]?.model ?? "CPU desconhecida"}, Node ${process.version}`,
    chamadasPorRota: CHAMADAS_POR_ROTA,
  }),
);
console.log(`Relatório: ${arquivoDoRelatorio}`);
