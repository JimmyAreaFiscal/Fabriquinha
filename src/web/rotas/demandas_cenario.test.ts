// Cenário compartilhado dos testes das rotas das demandas: banco real, projeto `loja`, as demandas I-206 e I-207 e o
// servidor web de verdade numa porta livre, com um agendador falso que só anota o que lhe pedem.
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after } from "node:test";
import type { AgregadoDemanda } from "../../dominio/agregado_demanda.ts";
import { guardarBytes } from "../../persistencia/arquivos.ts";
import { abrir, raizDo } from "../../persistencia/banco.ts";
import { criarDemanda } from "../../persistencia/demandas.ts";
import { gravarAnexos } from "../../persistencia/evidencia_demanda.ts";
import { servirWeb } from "../servidor.ts";

const base = mkdtempSync(join(tmpdir(), "fabriquinha-demandas-web-"));
const fechamentos: (() => Promise<void>)[] = [];
after(async () => {
  for (const fechar of fechamentos) await fechar();
  rmSync(base, { recursive: true, force: true });
});

const em = "2026-01-01T00:00:00.000Z";

const ticket = (demanda_id: string, ticket_id: number, etapa: string, extra: object = {}) => ({
  demanda_id,
  ticket_id,
  etapa,
  status: "aberto",
  status_alterado_em: em,
  devolucoes: 0,
  ...extra,
});

const rodada = (demanda_id: string, rodada_id: number, fase: string) => ({
  demanda_id,
  rodada_id,
  titulo: `rodada ${String(rodada_id)}`,
  fase,
  e2e: false,
  branch: `fabriquinha/${demanda_id}-${String(rodada_id)}`,
});

/** Uma demanda `fase` do projeto `loja`, sem rodadas nem tickets além dos de `resto`. */
export const demanda = (id: string, fase: string, resto: object = {}): AgregadoDemanda =>
  ({
    demanda: {
      id,
      projeto: "loja",
      titulo: `demanda ${id}`,
      tipo: "funcionalidade",
      descricao: "d",
      fase,
      fase_alterada_em: em,
      origem_ferramenta: "claude",
      origem_sessao: id,
      enviada: true,
      branch: `fabriquinha/${id}`,
    },
    tickets: [],
    decisoes: [],
    evidencias: [],
    rodadas: [],
    dependencias_rodada: [],
    criterios_citados: [],
    dependencias_ticket: [],
    caminhos_ticket: [],
    ...resto,
  }) as unknown as AgregadoDemanda;

/**
 * I-206 em execução: R1 concluída (T1, T2) e R2 com PR aberto (T3 em execução, T4 encerrar_rodada com o PR 7), uma
 * decisão do Auditor, a evidência `comportamento` do T3 com dois anexos e o T5 de planejamento. I-207 em
 * planejamento, dependente da I-206.
 */
export async function cenarioDemandas() {
  const banco: DatabaseSync = abrir(mkdtempSync(join(base, "raiz-")));
  banco
    .prepare(
      `INSERT INTO projeto (nome, repo, branch_base, hospedagem, sonar_project_key)
       VALUES ('loja', '/repos/loja', 'main', 'github', 'k')`,
    )
    .run();
  criarDemanda(
    banco,
    demanda("I-206", "execucao", {
      rodadas: [rodada("I-206", 1, "concluida"), rodada("I-206", 2, "aprovacao_pull_request")],
      tickets: [
        ticket("I-206", 1, "implementar", { rodada_id: 1, status: "concluido" }),
        ticket("I-206", 2, "encerrar_rodada", { rodada_id: 1, status: "concluido" }),
        ticket("I-206", 3, "implementar", { rodada_id: 2, status: "em_execucao", titulo: "implementa" }),
        ticket("I-206", 4, "encerrar_rodada", { rodada_id: 2, status: "concluido" }),
        ticket("I-206", 5, "planejar", { status: "concluido" }),
      ],
      decisoes: [
        {
          demanda_id: "I-206",
          ticket_id: 5,
          decisao_id: 1,
          resultado: "recusado",
          motivo: "refaça",
          por: "auditor",
          em,
        },
        { demanda_id: "I-206", ticket_id: 5, decisao_id: 2, resultado: "aprovado", nota: 4, por: "auditor", em },
      ],
      evidencias: [
        { demanda_id: "I-206", ticket_id: 4, tipo: "pr_aberto", dados: { id: "7", url: "https://pr/7" }, em },
        { demanda_id: "I-206", ticket_id: 3, tipo: "comportamento", dados: { resumo: "ok" }, em },
      ],
    }),
  );
  const conteudos = ["primeiro anexo", "<h1>segundo</h1>"];
  const anexos = [
    { caminho: "um.txt", mime: "text/plain" },
    { caminho: "dois.html", mime: "text/html" },
  ].map((a, i) => ({ ...a, ...guardarBytes(banco, Buffer.from(String(conteudos[i]))) }));
  gravarAnexos(banco, { demanda_id: "I-206", ticket_id: 3, tipo: "comportamento" }, anexos);
  criarDemanda(banco, demanda("I-207", "planejamento"));
  banco.exec("INSERT INTO dependencia_demanda (demanda_id, depende_demanda_id) VALUES ('I-207', 'I-206')");

  return { banco, ...(await servir(banco)), conteudos };
}

/** O servidor web de verdade sobre `banco`, numa porta livre, com um agendador falso que só anota o que lhe pedem. */
export async function servir(banco: DatabaseSync, comExecutarDemanda = true) {
  const executados: { demanda_id: string; ticket_id: number }[] = [];
  const agendador = {
    proximaBusca: () => new Date(),
    executarAgoraDemanda(ref: { demanda_id: string; ticket_id: number }) {
      executados.push(ref);
      return Promise.resolve();
    },
  };
  if (!comExecutarDemanda) delete (agendador as { executarAgoraDemanda?: unknown }).executarAgoraDemanda;
  const servidor = createServer();
  servidor.listen(0, "127.0.0.1");
  await once(servidor, "listening");
  const porta = (servidor.address() as { port: number }).port;
  servidor.on("request", servirWeb({ banco, porta, agendador }));
  fechamentos.push(async () => {
    servidor.closeAllConnections();
    servidor.close();
    await once(servidor, "close");
    banco.close();
  });
  const token = new URL(readFileSync(join(raizDo(banco), "web.url"), "utf8")).searchParams.get("token");

  /** Pede ao servidor; por padrão com o cookie da sessão (e `same-origin` na mutação), `cookie: false` para pedir sem ele. */
  async function pedir(
    caminho: string,
    {
      metodo = "GET",
      corpo,
      cookie = true,
      headers = {},
    }: { metodo?: string; corpo?: unknown; cookie?: boolean; headers?: Record<string, string> } = {},
  ) {
    const texto = corpo === undefined ? undefined : JSON.stringify(corpo);
    const pedido = request(`http://127.0.0.1:${String(porta)}${caminho}`, {
      method: metodo,
      headers: {
        ...(cookie && { cookie: `fabriquinha=${String(token)}` }),
        ...(metodo !== "GET" && { "sec-fetch-site": "same-origin", "content-type": "application/json" }),
        ...(texto !== undefined && { "content-length": String(Buffer.byteLength(texto)) }),
        ...headers,
      },
    });
    pedido.end(texto);
    const [resposta] = (await once(pedido, "response")) as [import("node:http").IncomingMessage];
    const partes: Buffer[] = [];
    for await (const parte of resposta as AsyncIterable<Buffer>) partes.push(parte);
    const corpoBytes = Buffer.concat(partes);
    return {
      status: Number(resposta.statusCode),
      headers: resposta.headers,
      corpo: corpoBytes,
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- o teste diz o formato que espera
      json: <T = Record<string, string>>() => JSON.parse(corpoBytes.toString("utf8")) as T,
    };
  }

  return { pedir, executados };
}
