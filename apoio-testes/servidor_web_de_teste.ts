// Servidor web de verdade para os testes das rotas: banco real, projeto `loja` e um agendador falso que só anota o que
// lhe pedem. Fica fora de cenarios_de_demanda.ts porque fecha o servidor num `after()` do arquivo de teste.
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer, request } from "node:http";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after } from "node:test";
import type { MotivoDeRecusa } from "../src/nucleo/despacho.ts";
import { relogioDoSistema } from "../src/nucleo/relogio.ts";
import { guardarBytes } from "../src/armazenamento/arquivos.ts";
import { raizDo } from "../src/armazenamento/banco.ts";
import { gravarAnexos } from "../src/armazenamento/evidencia_demanda.ts";
import { servirWeb } from "../src/entrega/http/servidor.ts";
import { noLog } from "../src/infra/registro.ts";
import { fabricaDeBancosTemporarios } from "./banco_temporario.ts";
import {
  agregadoComPullRequestAberto,
  cadastrarProjetoLoja,
  gravarAgregadoPronto,
  montarAgregadoDemanda,
} from "./cenarios_de_demanda.ts";

const fechamentos: (() => Promise<void>)[] = [];
after(async () => {
  for (const fechar of fechamentos) await fechar();
});
const abrirBancoTemporario = fabricaDeBancosTemporarios();

/**
 * I-206 em execução ({@link agregadoComPullRequestAberto}), com dois anexos na evidência `comportamento` do T3. I-207 em
 * planejamento, dependente da I-206.
 */
export async function cenarioDemandas() {
  const banco: DatabaseSync = abrirBancoTemporario().banco;
  cadastrarProjetoLoja(banco);
  gravarAgregadoPronto(banco, agregadoComPullRequestAberto("I-206"));
  const conteudos = ["primeiro anexo", "<h1>segundo</h1>"];
  const anexos = [
    { caminho: "um.txt", mime: "text/plain" },
    { caminho: "dois.html", mime: "text/html" },
  ].map((a, i) => ({ ...a, ...guardarBytes(banco, Buffer.from(String(conteudos[i]))) }));
  gravarAnexos(banco, { demanda_id: "I-206", ticket_id: 3, tipo: "comportamento" }, anexos);
  gravarAgregadoPronto(banco, montarAgregadoDemanda("I-207", "planejar"));
  banco.exec("INSERT INTO dependencia_demanda (demanda_id, depende_demanda_id) VALUES ('I-207', 'I-206')");

  return { banco, ...(await servir(banco)), conteudos };
}

/** O servidor web de verdade sobre `banco`, numa porta livre, com um agendador falso que só anota o que lhe pedem. */
export async function servir(banco: DatabaseSync, comExecutarDemanda = true, recusaDoDespacho?: MotivoDeRecusa) {
  const executados: { demanda_id: string; ticket_id: number }[] = [];
  const agendador = {
    proximaBusca: () => new Date(),
    executarAgora(ref: { demanda_id: string; ticket_id: number }) {
      executados.push(ref);
      return Promise.resolve(recusaDoDespacho);
    },
  };
  if (!comExecutarDemanda) delete (agendador as { executarAgora?: unknown }).executarAgora;
  const servidor = createServer();
  servidor.listen(0, "127.0.0.1");
  await once(servidor, "listening");
  const porta = (servidor.address() as { port: number }).port;
  servidor.on(
    "request",
    servirWeb({
      banco,
      raiz: raizDo(banco),
      porta,
      agendador,
      relogio: relogioDoSistema,
      registrarErro: noLog,
    }),
  );
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
