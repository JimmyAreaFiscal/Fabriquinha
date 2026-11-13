// O cenário dos testes de /api/agente/*: banco real com a I-206, que tem um ticket de cada etapa que o agente usa, e a
// I-207, de outra demanda. Cada ticket tem a execução aberta, com o token `token-<ticket>`; a pasta do que o agente anexa
// (worktree da rodada e saída) existe na raiz temporária.
import { once } from "node:events";
import { mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { Readable } from "node:stream";
import { after } from "node:test";
import { relogioDoSistema } from "../../src/shared/nucleo/relogio.ts";
import { raizDo } from "../../src/shared/armazenamento/banco.ts";
import { gravarTokenDaExecucao } from "../../src/modulos/sessoes/publico.ts";
import type { RotaDoAgente } from "../../src/server/api/agente/rotas.ts";
import { servirWeb } from "../../src/server/api/servidor.ts";
import { noLog } from "../../src/shared/infra/registro.ts";
import { fabricaDeBancosTemporarios } from "../banco/banco_temporario.ts";
import {
  abrirTrabalhoDoAgente,
  cadastrarProjetoLoja,
  gravarAgregadoPronto,
  INSTANTE_DO_CENARIO,
  montarAgregadoDemanda,
  montarRodada,
  montarTicket,
} from "./cenarios_de_demanda.ts";

// Os testes do cliente do agente (que não importa o armazenamento) dão o token ao processo por aqui.
export { gravarTokenDaExecucao };

const abrirBancoTemporario = fabricaDeBancosTemporarios();

const fechamentos: (() => Promise<void>)[] = [];
after(async () => {
  for (const fechar of fechamentos) await fechar();
});

/** O ticket de cada etapa da I-206 e a rodada dele: o T5 recebe `testes_estresse`, o T7 `video_demonstracao`, o T9 cria corretivo e o T10 decide a revisão. */
export const TICKETS_DA_API_DO_AGENTE = {
  estresse: { demanda: "I-206", ticket: 5 },
  video: { demanda: "I-206", ticket: 7 },
  corretivo: { demanda: "I-206", ticket: 9 },
  revisao: { demanda: "I-206", ticket: 10 },
  deOutraDemanda: { demanda: "I-207", ticket: 1 },
} as const;

export const enderecoDoTicket = ({ demanda, ticket }: { demanda: string; ticket: number }): string =>
  `${demanda}.T${String(ticket)}`;

export const tokenDoTicket = (alvo: { demanda: string; ticket: number }): string => `token-${enderecoDoTicket(alvo)}`;

const emExecucao = { estado: "em_execucao" };

export function cenarioDaApiDoAgente() {
  const { raiz, banco } = abrirBancoTemporario();
  cadastrarProjetoLoja(banco);
  gravarAgregadoPronto(
    banco,
    montarAgregadoDemanda("I-206", "em_execucao", {
      rodadas: [
        montarRodada("I-206", 1, "encerrar_rodada"),
        montarRodada("I-206", 2, "ajustar_resultado"),
        montarRodada("I-206", 3, "revisar_rodada"),
      ],
      tickets: [
        montarTicket("I-206", 5, "revisar_demanda", emExecucao),
        montarTicket("I-206", 7, "encerrar_rodada", { rodada_id: 1, ...emExecucao }),
        montarTicket("I-206", 9, "ajustar_resultado", { rodada_id: 2, ...emExecucao }),
        montarTicket("I-206", 3, "implementar", { rodada_id: 3, estado: "concluido" }),
        montarTicket("I-206", 10, "revisar_rodada", { rodada_id: 3, ...emExecucao }),
      ],
    }),
  );
  gravarAgregadoPronto(
    banco,
    montarAgregadoDemanda("I-207", "planejar", { tickets: [montarTicket("I-207", 1, "planejar", emExecucao)] }),
  );
  for (const alvo of Object.values(TICKETS_DA_API_DO_AGENTE)) {
    const { trabalho_id } = abrirTrabalhoDoAgente(banco, { demanda_id: alvo.demanda, ticket_id: alvo.ticket });
    gravarTokenDaExecucao(banco, trabalho_id, tokenDoTicket(alvo));
  }
  mkdirSync(join(raiz, "worktrees", "loja", "I-206", "rodadas", "1"), { recursive: true });
  return { raiz, banco };
}

/** A execução do ticket de `alvo` termina: o token dela deixa de valer. */
export function encerrarProcessoDoTicket(banco: DatabaseSync, alvo: { demanda: string; ticket: number }): void {
  banco
    .prepare("UPDATE processo_do_trabalho SET fim = ? WHERE id = ?")
    .run(INSTANTE_DO_CENARIO, `e-${alvo.demanda}-T${String(alvo.ticket)}`);
}

/** A quantidade de linhas de cada tabela do banco, para provar que um pedido recusado não gravou nada. */
export function contagemDasTabelas(banco: DatabaseSync): Record<string, number> {
  const tabelas = banco.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as {
    name: string;
  }[];
  return Object.fromEntries(
    tabelas.map(({ name }) => [name, (banco.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get() as { n: number }).n]),
  );
}

/**
 * O servidor web de verdade sobre `banco`, numa porta livre, e o `pedir` a `/api/agente/*` com o `token` no
 * `Authorization` (sem ele, sem o cabeçalho). `rotas` troca as rotas do agente, para os testes porem espiões nos casos de uso.
 */
export async function servirApiDoAgente(banco: DatabaseSync, rotas?: RotaDoAgente[]) {
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
      agendador: { proximaBusca: () => new Date() },
      relogio: relogioDoSistema,
      registrarErro: noLog,
      rotasDoAgente: rotas,
    }),
  );
  fechamentos.push(async () => {
    servidor.closeAllConnections();
    servidor.close();
    await once(servidor, "close");
  });
  return async function pedir(
    metodo: "GET" | "POST",
    caminho: string,
    { token, corpo, bytes }: { token?: string; corpo?: unknown; bytes?: Readable } = {},
  ) {
    const resposta = await fetch(`http://127.0.0.1:${String(porta)}${caminho}`, {
      method: metodo,
      headers: {
        ...(token !== undefined && { authorization: `Bearer ${token}` }),
        ...(corpo !== undefined && { "content-type": "application/json" }),
        ...(bytes !== undefined && { "content-type": "application/octet-stream" }),
      },
      body: bytes ? (Readable.toWeb(bytes) as ReadableStream) : JSON.stringify(corpo),
      ...(bytes && { duplex: "half" }),
    });
    return { status: resposta.status, json: (await resposta.json()) as unknown };
  };
}
