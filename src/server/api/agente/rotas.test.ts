// As rotas de /api/agente/* contra o servidor de verdade e banco real: o token do processo é a única credencial, só alcança
// o ticket do próprio processo, e o pedido recusado não grava.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cenarioDaApiDoAgente,
  contagemDasTabelas,
  encerrarProcessoDoTicket,
  enderecoDoTicket,
  servirApiDoAgente,
  TICKETS_DA_API_DO_AGENTE as TICKETS,
  tokenDoTicket,
} from "../../../../apoio-testes/cenarios/cenario_da_api_do_agente.ts";
import {
  ErroDaApiDoAgente,
  PedidoRevisaoDecidir,
  RespostaDemandaVer,
  RespostaEvidenciaSchema,
  RespostaProjetoVer,
  RespostaRevisaoDecidir,
  RespostaTicketCriar,
  RespostaTicketVer,
} from "../../contrato/agente/agente.ts";

const ESTRESSE = {
  aplicavel: true,
  cenarios: [{ nome: "carga", objetivo: "o", comando: "npm test", resultado: "passou", observado: "ok" }],
};

interface AlvoDoPedido {
  demanda: string;
  ticket: number;
}
type PedidoHttp = readonly ["GET" | "POST", string, Record<string, unknown>?];

/** O pedido de cada comando do agente ao ticket `alvo` (o do `evidencia schema` e do `projeto ver` leva o ticket na query). */
const PEDIDOS_POR_COMANDO: Record<string, (alvo: AlvoDoPedido) => PedidoHttp> = {
  "projeto ver": (alvo) => ["GET", `/api/agente/projeto?ticket=${enderecoDoTicket(alvo)}`],
  "demanda ver": (alvo) => ["GET", `/api/agente/demandas/${alvo.demanda}`],
  "ticket ver": (alvo) => ["GET", `/api/agente/tickets/${enderecoDoTicket(alvo)}`],
  "ticket criar": (alvo) => ["POST", "/api/agente/tickets", { rodada: `${alvo.demanda}.R2`, titulo: "Corrigir" }],
  "revisao decidir": (alvo) => [
    "POST",
    "/api/agente/revisoes",
    { ticket: enderecoDoTicket(alvo), veredito: "aprovar" },
  ],
  "evidencia schema": (alvo) => [
    "GET",
    `/api/agente/evidencias/testes_estresse/schema?ticket=${enderecoDoTicket(alvo)}`,
  ],
  "evidencia add": (alvo) => [
    "POST",
    "/api/agente/evidencias",
    { ticket: enderecoDoTicket(alvo), tipo: "testes_estresse", dados: ESTRESSE, anexos: [] },
  ],
};

for (const [comando, pedidoDe] of Object.entries(PEDIDOS_POR_COMANDO)) {
  test(`CA-2: ${comando} com o token de outro processo vivo, de processo encerrado e sem token é recusado sem gravar`, async () => {
    const { banco } = cenarioDaApiDoAgente();
    const pedir = await servirApiDoAgente(banco);
    const [metodo, caminho, corpo] = pedidoDe(TICKETS.estresse);
    const antes = contagemDasTabelas(banco);
    const recusar = async (token: string | undefined, status: number) => {
      const resposta = await pedir(metodo, caminho, { token, corpo });
      assert.equal(resposta.status, status);
      ErroDaApiDoAgente.parse(resposta.json);
      assert.deepEqual(contagemDasTabelas(banco), antes);
    };

    await recusar(tokenDoTicket(TICKETS.deOutraDemanda), 403);
    await recusar(undefined, 401);
    await recusar("token-que-ninguem-gerou", 401);
    encerrarProcessoDoTicket(banco, TICKETS.estresse);
    await recusar(tokenDoTicket(TICKETS.estresse), 401);
    banco.close();
  });
}

test("a recusa do token dá o texto do CLI do agente numa linha e o código de saída 1", async () => {
  const { banco } = cenarioDaApiDoAgente();
  const pedir = await servirApiDoAgente(banco);
  assert.deepEqual((await pedir("GET", "/api/agente/projeto")).json, {
    mensagem: "token ausente, desconhecido ou de execução encerrada (confira FABRIQUINHA_TOKEN)",
    codigo_de_saida: 1,
  });
  const alheio = await pedir("GET", `/api/agente/tickets/${enderecoDoTicket(TICKETS.estresse)}`, {
    token: tokenDoTicket(TICKETS.deOutraDemanda),
  });
  assert.deepEqual(
    [alheio.status, alheio.json],
    [403, { mensagem: "o agente só lê o próprio ticket (leia I-207.T1)", codigo_de_saida: 1 }],
  );
  banco.close();
});

test("com o token do próprio processo, projeto ver, demanda ver e ticket ver respondem o contrato", async () => {
  const { banco } = cenarioDaApiDoAgente();
  const pedir = await servirApiDoAgente(banco);
  const token = tokenDoTicket(TICKETS.estresse);
  const projeto = await pedir("GET", `/api/agente/projeto?ticket=${enderecoDoTicket(TICKETS.estresse)}`, { token });
  assert.equal(projeto.status, 200);
  assert.equal(RespostaProjetoVer.parse(projeto.json).nome, "loja");

  const demanda = await pedir("GET", "/api/agente/demandas/I-206", { token });
  assert.equal(demanda.status, 200);
  const lida = RespostaDemandaVer.parse(demanda.json);
  assert.equal(lida.demanda.origem_ferramenta, "claude");
  assert.equal(lida.demanda.criada_por, undefined);
  assert.equal(lida.rodadas.length, 3);

  const ticket = await pedir("GET", "/api/agente/tickets/I-206.T5", { token });
  assert.equal(ticket.status, 200);
  assert.equal(RespostaTicketVer.parse(ticket.json).ticket, "I-206.T5");
  banco.close();
});

test("o agente só alcança o próprio ticket, na própria demanda: ticket irmão, rodada de outra demanda e endereço torto", async () => {
  const { banco } = cenarioDaApiDoAgente();
  const pedir = await servirApiDoAgente(banco);
  const token = tokenDoTicket(TICKETS.corretivo);
  const recusado = async (metodo: "GET" | "POST", caminho: string, corpo?: unknown) => {
    const { status, json } = await pedir(metodo, caminho, { token, corpo });
    return [status, ErroDaApiDoAgente.parse(json).mensagem];
  };
  assert.deepEqual(await recusado("GET", "/api/agente/tickets/I-206.T5"), [
    403,
    "o agente só lê o próprio ticket (leia I-206.T9)",
  ]);
  assert.deepEqual(await recusado("GET", "/api/agente/demandas/I-207"), [
    403,
    "o agente só lê a própria demanda (leia I-206, a do seu ticket I-206.T9)",
  ]);
  assert.deepEqual(await recusado("GET", "/api/agente/projeto?ticket=I-206.T5"), [
    403,
    "o agente só lê o próprio ticket (leia I-206.T9)",
  ]);
  assert.deepEqual(await recusado("POST", "/api/agente/tickets", { rodada: "I-207.R1", titulo: "x" }), [
    403,
    "I-207.R1 é de outra demanda (use uma rodada de I-206)",
  ]);
  assert.deepEqual(await recusado("POST", "/api/agente/tickets", { rodada: "rodada-torta", titulo: "x" }), [
    409,
    "rodada-torta não é um endereço de rodada (use a rodada do seu ticket, I-206.R2)",
  ]);
  assert.deepEqual(await recusado("POST", "/api/agente/revisoes", { ticket: "I-206.T5", veredito: "aprovar" }), [
    403,
    "o agente só age no próprio ticket (aja em I-206.T9)",
  ]);
  assert.deepEqual(await recusado("POST", "/api/agente/evidencias", { ticket: "I-206.T5", tipo: "plano" }), [
    403,
    "o agente só age no próprio ticket (aja em I-206.T9)",
  ]);
  banco.close();
});

test("ticket criar cria o corretivo na rodada do agente e devolve o endereço dele", async () => {
  const { banco } = cenarioDaApiDoAgente();
  const pedir = await servirApiDoAgente(banco);
  const resposta = await pedir("POST", "/api/agente/tickets", {
    token: tokenDoTicket(TICKETS.corretivo),
    corpo: { rodada: "I-206.R2", titulo: "Corrigir" },
  });
  assert.equal(resposta.status, 200);
  assert.deepEqual(RespostaTicketCriar.parse(resposta.json), { rodada: "I-206.R2", tickets: ["I-206.T11"] });
  const semTitulo = await pedir("POST", "/api/agente/tickets", {
    token: tokenDoTicket(TICKETS.corretivo),
    corpo: { rodada: "I-206.R2" },
  });
  assert.deepEqual(semTitulo.json, {
    mensagem: "falta o título do ticket corretivo (passe --titulo <texto>)",
    codigo_de_saida: 1,
  });
  banco.close();
});

test("revisao decidir lê correcoes do corpo: reprovar a revisão de rodada as aplica, e opção a mais na aprovação é recusada", async () => {
  const { banco } = cenarioDaApiDoAgente();
  const pedir = await servirApiDoAgente(banco);
  const token = tokenDoTicket(TICKETS.revisao);
  const ticket = enderecoDoTicket(TICKETS.revisao);
  const comPlano = await pedir("POST", "/api/agente/revisoes", {
    token,
    corpo: { ticket, veredito: "aprovar", plano: { qualquer: "coisa" } },
  });
  assert.deepEqual(
    [comPlano.status, comPlano.json],
    [409, { mensagem: "aprovar não leva --motivo, --correcoes nem --plano (omita as opções)", codigo_de_saida: 1 }],
  );
  const sem = await pedir("POST", "/api/agente/revisoes", {
    token,
    corpo: { ticket, veredito: "reprovar", motivo: "m" },
  });
  assert.equal((sem.json as { mensagem: string }).mensagem, "reprovar exige --correcoes (passe --correcoes)");

  const corpo = PedidoRevisaoDecidir.parse({
    ticket,
    veredito: "reprovar",
    motivo: "falta",
    correcoes: [{ titulo: "a", descricao: "b" }],
  });
  const reprovada = await pedir("POST", "/api/agente/revisoes", { token, corpo });
  assert.equal(reprovada.status, 200);
  assert.deepEqual(RespostaRevisaoDecidir.parse(reprovada.json), {
    ticket: "I-206.T10",
    rodada: "I-206.R3",
    resultado: "reprovado",
  });
  banco.close();
});

test("evidencia schema devolve o JSON Schema dos dados e a regra dos arquivos; tipo que o agente não submete é recusado", async () => {
  const { banco } = cenarioDaApiDoAgente();
  const pedir = await servirApiDoAgente(banco);
  const token = tokenDoTicket(TICKETS.estresse);
  const schema = await pedir("GET", "/api/agente/evidencias/testes_estresse/schema", { token });
  assert.equal(schema.status, 200);
  const { dados, arquivos } = RespostaEvidenciaSchema.parse(schema.json);
  assert.equal(dados.type, "object");
  assert.ok(arquivos);
  const recusado = await pedir("GET", "/api/agente/evidencias/pr_aberto/schema", { token });
  assert.equal(recusado.status, 409);
  assert.match(ErroDaApiDoAgente.parse(recusado.json).mensagem, /^pr_aberto não é evidência que o agente submete/);
  banco.close();
});

test("corpo fora do contrato é recusado numa linha com o caminho do campo; rota que não existe é 404", async () => {
  const { banco } = cenarioDaApiDoAgente();
  const pedir = await servirApiDoAgente(banco);
  const token = tokenDoTicket(TICKETS.corretivo);
  const torto = await pedir("POST", "/api/agente/tickets", { token, corpo: { titulo: 1 } });
  assert.equal(torto.status, 422);
  const { mensagem, codigo_de_saida } = ErroDaApiDoAgente.parse(torto.json);
  assert.match(mensagem, /^✖ [^\n]*rodada/);
  assert.equal(codigo_de_saida, 1);
  const inexistente = await pedir("GET", "/api/agente/nao-existe", { token });
  assert.deepEqual(
    [inexistente.status, inexistente.json],
    [404, { mensagem: "GET /api/agente/nao-existe não existe", codigo_de_saida: 1 }],
  );
  banco.close();
});
