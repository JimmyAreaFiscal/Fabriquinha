// Roda fora do `npm test`: node --test estresse/grupos/preparo_demandas.test.ts
// Sobe o ambiente de verdade e confere que cada preparo deixa a rota que o usa responder o esperado (CA-2).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { abrir } from "../../src/compartilhado/armazenamento/banco.ts";
import { carregarDemanda } from "../../src/sdlc/armazenamento/demandas.ts";
import { type Ambiente, subirAmbiente } from "../instancia_descartavel.ts";
import { acoesHttpLeitura } from "./http_leitura.ts";
import { criarPreparo, type Preparo } from "./preparo_demandas.ts";

let amb: Ambiente;
let p: Preparo;
before(async () => {
  amb = await subirAmbiente();
  p = await criarPreparo(amb);
});
after(async () => {
  p.fechar();
  await amb.encerrar();
});

async function chamar(metodo: "POST" | "DELETE", caminho: string, corpo?: unknown): Promise<number> {
  const binario = Buffer.isBuffer(corpo);
  const r = await fetch(`${amb.base}${caminho}`, {
    method: metodo,
    headers: {
      cookie: amb.cookie,
      "sec-fetch-site": "same-origin",
      ...(corpo !== undefined && { "content-type": binario ? "application/octet-stream" : "application/json" }),
    },
    body: corpo === undefined ? undefined : binario ? new Uint8Array(corpo) : JSON.stringify(corpo),
  });
  const texto = await r.text();
  assert.ok(r.status < 300, `${metodo} ${caminho}: HTTP ${String(r.status)} ${texto}`);
  return r.status;
}

/** A estado e os estados das rodadas que o banco guarda agora, lidas por outra conexão. */
function estados(id: string): string[] {
  const banco = abrir(amb.raiz);
  try {
    const ag = carregarDemanda(banco, id);
    return [ag.demanda.estado, ...ag.rodadas.map((r) => r.estado)];
  } finally {
    banco.close();
  }
}

test("a decisão, o cancelamento e o arquivamento agem sobre a demanda no estado exigido", async () => {
  const [a, b] = [p.demandaEnviada(), p.demandaEnviada()];
  assert.notEqual(a, b);
  assert.deepEqual(estados(a), ["gate_demanda"]);
  await chamar("POST", `/api/demandas/${a}/decisao`, { resultado: "aprovado" });
  assert.deepEqual(estados(a), ["planejar"]);
  await chamar("POST", `/api/demandas/${b}/cancelar`);
  assert.deepEqual(estados(b), ["cancelada"]);
  const c = p.demandaConcluida();
  await chamar("POST", `/api/demandas/${c}/arquivar`);
  assert.deepEqual(estados(c), ["arquivada"]);
});

test("o planejamento pronto é aprovado e vira execução", async () => {
  const id = p.planejamentoPronto();
  assert.deepEqual(estados(id), ["gate_planejamento"]);
  await chamar("POST", `/api/demandas/${id}/planejamento/decisao`, { resultado: "aprovado" });
  assert.equal(estados(id)[0], "em_execucao");
});

test("a rodada com PR é aprovada pela hospedagem falsa e concluída", async () => {
  const { demanda, rodada } = await p.rodadaComPR();
  assert.deepEqual(estados(demanda), ["em_execucao", "gate_pr"]);
  await chamar("POST", `/api/demandas/rodadas/${rodada}/pr`, { resultado: "aprovado", nota: 4 });
  assert.equal(estados(demanda)[1], "concluida");
});

test("a rodada com PR reprovado abre a sessão de ajustes pelo próprio serviço", async () => {
  const { demanda, rodada } = await p.rodadaComPR();
  await chamar("POST", `/api/demandas/rodadas/${rodada}/pr`, { resultado: "reprovado", motivo: "falta teste" });
  assert.equal(estados(demanda)[1], "ajustar_resultado");
});

test("a sessão de ajustes com a correção registrada conclui", async () => {
  const rodada = await p.rodadaEmAjustes(true);
  await chamar("POST", `/api/demandas/rodadas/${rodada}/ajustes/concluir`);
  assert.equal(estados(rodada.split(".")[0] ?? "")[1], "implementar");
});

test("reabrir e executar acham o ticket na situação certa", async () => {
  const falho = await p.ticketFalho();
  await chamar("POST", `/api/demandas/tickets/${falho}/reabrir`, { instrucao: "tente de novo" });
  const aberto = await p.ticketAberto();
  await chamar("POST", `/api/demandas/tickets/${aberto}/executar`);
});

test("as sessões de conversa recebem mensagem e a rodando é abortada", async () => {
  const parada = await p.sessaoParada();
  await chamar("POST", `/api/sessoes/${parada}/mensagens`, { texto: "oi", modo: "prompt" });
  const rodando = await p.sessaoRodando();
  await chamar("POST", `/api/sessoes/${rodando}/abortar`);
});

test("projeto, simulação e avaliação preparados são aceitos pelas rotas", async () => {
  await chamar("DELETE", `/api/projetos/${await p.projetoProprio()}`);
  const usuario = String(p.usuarioSimulado());
  await chamar("POST", `/api/usuarios-simulados/${usuario}/anexos?nome=a.txt`, Buffer.from("x"));
  await chamar("DELETE", `/api/usuarios-simulados/${usuario}/anexos/a.txt`);
  await chamar("POST", `/api/tarefas/${String(p.tarefa())}/executar`);
  const avaliacao = p.avaliacao(true);
  await chamar("POST", `/api/avaliacoes/${avaliacao}/achados/1/encaminhar`);
  await chamar("POST", `/api/avaliacoes/${p.avaliacao()}/mensagens`, { texto: "oi" });
});

test("o encaminhar funciona depois que o grupo de leitura semeia a I-1 (a sequência `issue` fica à frente)", async () => {
  const outro = await subirAmbiente();
  try {
    await acoesHttpLeitura(outro);
    const preparo = await criarPreparo(outro);
    try {
      const r = await fetch(`${outro.base}/api/avaliacoes/${preparo.avaliacao(true)}/achados/1/encaminhar`, {
        method: "POST",
        headers: { cookie: outro.cookie, "sec-fetch-site": "same-origin" },
      });
      assert.equal(r.status, 200, await r.text());
    } finally {
      preparo.fechar();
    }
  } finally {
    await outro.encerrar();
  }
});
