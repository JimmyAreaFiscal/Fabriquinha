// Avaliação de melhoria do SDLC: escopo, recusas, achados, uso fora das métricas, encaminhamento, contra banco real e pi falso.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { setTimeout as dormir } from "node:timers/promises";
import { abrirBancoTemporario } from "../../apoio-testes/banco_temporario.ts";
import { instalarPiFalso, type PassoPi } from "../../apoio-testes/pi_falso.ts";
import { ErroDeInexistente, ErroDeRegra, ErroExterno } from "../nucleo/erros.ts";
import { metricasDaDemanda } from "./demanda.ts";
import { recuperarAuditorias } from "./auditoria.ts";
import {
  abortarAvaliacao,
  abrir as abrirAv,
  encaminharAchado,
  enviarNaAvaliacao,
  estadoDaAvaliacao,
  iniciarAvaliacao,
} from "./avaliacao.ts";
import { encerrar, situacao } from "./gerente.ts";

const { raiz: raizTemporaria, banco, fechar } = abrirBancoTemporario();
after(fechar);
const raiz = realpathSync(raizTemporaria);
const T = "'2026-10-10T10:00:00.000Z'";
banco.exec(`
  INSERT INTO projeto (nome, repo, branch_base, hospedagem, sonar_project_key) VALUES
    ('loja', '/r/loja', 'main', 'github', 'loja'),
    ('site', '/r/site', 'main', 'github', 'site'),
    ('vazio', '/r/vazio', 'main', 'github', 'vazio');
`);
// I-10 e I-11 da loja com sessão em 10/10; I-12 da loja só em setembro; I-13 do site.
for (const [id, projeto, fim] of [
  ["I-10", "loja", "2026-10-10T10:30:00.000Z"],
  ["I-11", "loja", "2026-10-10T11:00:00.000Z"],
  ["I-12", "loja", "2026-09-01T11:00:00.000Z"],
  ["I-13", "site", "2026-10-10T11:00:00.000Z"],
] as const) {
  banco.exec(
    `INSERT INTO demanda VALUES ('${id}', '${projeto}', 'Título ${id}', 'problema', 'd', 'execucao', ${T}, 'f', 's', 1, 'fabriquinha/${id}');
     INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, status, status_alterado_em) VALUES ('${id}', 1, 'implementar', 'aberto', ${T});
     INSERT INTO sessao VALUES ('s-${id}', '${id}', 1, 'autonomo', 'c');
     INSERT INTO execucao_sessao (id, sessao_id, inicio, fim, falha) VALUES ('e-${id}', 's-${id}', ${T}, '${fim}', 0);`,
  );
}
mkdirSync(join(raiz, "sessoes"));
writeFileSync(
  join(raiz, "sessoes", "2026-10-10T10-00-00-000Z_s-I-10.jsonl"),
  [
    { type: "session", id: "s-I-10" },
    { type: "message", message: { role: "user", content: "faça" } },
    { type: "message", message: { role: "assistant", content: [{ type: "text", text: "feito" }] } },
  ]
    .map((l) => JSON.stringify(l))
    .join("\n") + "\n",
);

const piFalso = instalarPiFalso(raiz);
const resposta: PassoPi = {
  resposta: "ok",
  modelo: { provedor: "p", modelo: "m" },
  custo: 0.5,
  uso: { output: 5 },
  fimDoAgente: true,
  cabecalhoDaSessao: true,
};
const achados = [1, 2]
  .map(
    (numero) =>
      JSON.stringify({
        titulo: `Achado ${String(numero)}`,
        descricao: `desc ${String(numero)}`,
        evidencia: `ev ${String(numero)}`,
      }) + "\n",
  )
  .join("");

const opcoes = { ociosidadeMin: 5 };
const registro = () => piFalso.registro();
async function ate(condicao: () => boolean, oQue: string): Promise<void> {
  for (let espera = 0; !condicao(); espera += 20) {
    assert.ok(espera < 10_000, `${oQue} não aconteceu em 10 s`);
    await dormir(20);
  }
}
async function parar(id: string): Promise<void> {
  if (situacao(id)) encerrar(id);
  await ate(() => estadoDaAvaliacao(id) === "concluida" && !situacao(id), "a parada do pi");
}
const recusa = (mensagem: RegExp) => (e: unknown) => e instanceof ErroDeRegra && mensagem.test(e.message);
const escopo = { projeto: "loja", de: "2026-10-01", ate: "2026-10-31" };

test("recusa o escopo sem demanda com sessão, citando período e projeto (CA-2), e a demanda de outro projeto ou sem sessão (CA-5)", async () => {
  piFalso.roteirizar([{ ...resposta, escreve: { "achados.jsonl": achados } }, resposta]);
  await assert.rejects(
    iniciarAvaliacao(banco, { ...escopo, projeto: "vazio" }, opcoes),
    recusa(/vazio.*2026-10-01.*2026-10-31/),
  );
  await assert.rejects(iniciarAvaliacao(banco, { ...escopo, demandas: ["I-13"] }, opcoes), recusa(/I-13.*site/));
  await assert.rejects(iniciarAvaliacao(banco, { ...escopo, demandas: ["I-12"] }, opcoes), recusa(/I-12.*loja/));
  await assert.rejects(iniciarAvaliacao(banco, { ...escopo, demandas: ["I-99"] }, opcoes), recusa(/I-99/));
  await assert.rejects(iniciarAvaliacao(banco, { ...escopo, de: "2026-11-01" }, opcoes), recusa(/inválido/));
  await assert.rejects(iniciarAvaliacao(banco, { ...escopo, ate: "31/10" }, opcoes), recusa(/inválido/));
  assert.equal(registro().length, 0);
  assert.equal(banco.prepare("SELECT count(*) AS n FROM avaliacao").get()?.n, 0);
});

test("avalia: prepara a pasta, importa achados e uso, não mexe nas métricas, conversa e encaminha (CA-1, 3, 4, 7, 8, 9, 10, 13, 14, 15)", async () => {
  const antes = JSON.stringify(metricasDaDemanda(banco, "I-10"));
  piFalso.roteirizar([{ ...resposta, escreve: { "achados.jsonl": achados } }, resposta]);
  const id = await iniciarAvaliacao(banco, { ...escopo, demandas: ["I-10", "I-10"] }, opcoes);
  await ate(
    () => banco.prepare("SELECT count(*) AS n FROM achado_avaliacao").get()?.n === 2,
    "a importação dos achados",
  );
  const dir = join(raiz, "avaliacoes", id);
  assert.deepEqual(readdirSync(join(dir, "demandas")), ["I-10"]);
  assert.match(readFileSync(join(dir, "demandas", "I-10", "demanda.md"), "utf8"), /Título I-10/);
  assert.ok(existsSync(join(dir, "demandas", "I-10", "metricas.json")));
  const sessao = readFileSync(join(dir, "sessoes", "I-10-s-I-10.md"), "utf8");
  assert.match(sessao, /feito/);
  assert.match(readFileSync(join(dir, "indice.md"), "utf8"), /sessoes\/I-10-s-I-10\.md/);
  const [inicio] = registro();
  assert.equal(inicio?.cwd, dir);
  assert.ok(inicio.argv);
  assert.ok(inicio.argv.includes("achado.ts") || inicio.argv.some((a) => a.endsWith("achado.ts")));
  assert.match(inicio.argv.join(" "), /--exclude-tools edit,write,bash,powershell/);

  await ate(() => banco.prepare("SELECT count(*) AS n FROM uso_avaliacao").get()?.n === 1, "o uso");
  const av = abrirAv(banco, id);
  assert.deepEqual(av.demandas, ["I-10"]);
  assert.equal(av.pedido, "");
  assert.equal(av.achados.length, 2);
  assert.equal(av.uso[0]?.custo, 0.5);
  assert.equal(JSON.stringify(metricasDaDemanda(banco, "I-10")), antes);

  await parar(id);
  assert.equal(abrirAv(banco, id).estado, "concluida");
  assert.ok(abrirAv(banco, id).conversa.length > 1);
  const marcadas = (abrirAv(banco, id).conversa as { fabriquinha?: boolean; message?: { role?: string } }[]).filter(
    (e) => e.fabriquinha,
  );
  assert.equal(marcadas.length, 1);
  assert.equal(marcadas[0]?.message?.role, "user");

  // pergunta: sobe um pi novo na mesma sessão e o uso é regravado pela soma
  const eventos: string[] = [];
  const cancelar = abrirAv(banco, id).assinar((e) =>
    eventos.push(
      e.type === "estado" ? `estado:${String(e.estado)}` : `${String(e.type)}${e.fabriquinha ? ":fabriquinha" : ""}`,
    ),
  );
  enviarNaAvaliacao(banco, id, "e o custo?", opcoes);
  await ate(() => registro().filter((r) => r.evento === "inicio").length === 2, "o segundo pi");
  await ate(() => banco.prepare("SELECT chamadas FROM uso_avaliacao").get()?.chamadas === 2, "o uso regravado");
  assert.equal(registro().find((r) => r.comando?.message === "e o custo?")?.comando?.type, "prompt");

  const demanda = encaminharAchado(banco, id, 1);
  assert.equal(demanda.demanda.fase, "registro");
  assert.equal(demanda.demanda.titulo, "Achado 1");
  assert.equal(demanda.demanda.projeto, "loja");
  assert.match(demanda.demanda.descricao, /desc 1[\s\S]*ev 1[\s\S]*achado 1/);
  assert.equal(demanda.demanda.origem_ferramenta, "avaliacao");
  assert.equal(demanda.demanda.origem_sessao, `${id}#1`);
  assert.equal(abrirAv(banco, id).achados[0]?.demanda_id, demanda.demanda.id);
  assert.throws(() => encaminharAchado(banco, id, 1), recusa(/já foi encaminhado/));
  assert.throws(() => encaminharAchado(banco, id, 9), recusa(/não existe/));
  assert.throws(() => encaminharAchado(banco, "nada", 1), ErroDeInexistente);
  // Com o pi vivo e ocioso, a pergunta vai a ele; parando, a próxima espera ele sair.
  await ate(() => estadoDaAvaliacao(id) === "concluida" && situacao(id) !== undefined, "o pi ocioso");
  enviarNaAvaliacao(banco, id, "e o prazo?", opcoes);
  await ate(() => registro().some((r) => r.comando?.message === "e o prazo?"), "a pergunta ao pi vivo");
  await ate(() => estadoDaAvaliacao(id) === "concluida", "a resposta");
  encerrar(id);
  assert.throws(
    () => {
      enviarNaAvaliacao(banco, id, "já?", opcoes);
    },
    recusa(/ainda está parando/),
  );
  await parar(id);
  cancelar();
  assert.ok(eventos.includes("agent_start"));
  assert.ok(eventos.includes("estado:concluida"));
  assert.ok(!eventos.includes("message_end:fabriquinha")); // a pergunta do Auditor não é o prompt

  // ao vivo, a mensagem igual ao prompt.md chega marcada
  const ao_vivo: string[] = [];
  const parar_ = abrirAv(banco, id).assinar((e) => ao_vivo.push(e.fabriquinha ? "marcada" : String(e.type)));
  enviarNaAvaliacao(banco, id, readFileSync(join(dir, "prompt.md"), "utf8"), opcoes);
  await ate(() => ao_vivo.includes("marcada"), "o prompt marcado ao vivo");
  await parar(id);
  parar_();
});

test("o pedido do Auditor vai ao prompt; enviar com o agente trabalhando é recusado e abortar o para", async () => {
  piFalso.roteirizar([{ ...resposta, termina: "nunca" }]);
  const id = await iniciarAvaliacao(
    banco,
    { ...escopo, demandas: ["I-11", "I-10"], pedido: "  foque no custo  " },
    opcoes,
  );
  assert.equal(abrirAv(banco, id).pedido, "foque no custo");
  assert.deepEqual(abrirAv(banco, id).demandas, ["I-10", "I-11"]);
  assert.match(readFileSync(join(raiz, "avaliacoes", id, "prompt.md"), "utf8"), /foque no custo/);
  assert.equal(estadoDaAvaliacao(id), "rodando");
  assert.throws(
    () => {
      enviarNaAvaliacao(banco, id, "oi", opcoes);
    },
    recusa(/trabalhando/),
  );
  abortarAvaliacao(id);
  await ate(() => registro().some((r) => r.comando?.type === "abort"), "o abort");
  await parar(id);
});

test("sincronização com falha vai para o log e não para o serviço", async () => {
  piFalso.roteirizar([{ ...resposta, anexa: { "achados.jsonl": "{nao-json\n" } }]);
  const id = await iniciarAvaliacao(banco, escopo, opcoes);
  const log = join(raiz, "avaliacoes", id, "log");
  await ate(() => readFileSync(log, "utf8").includes("sincronização falhou"), "o aviso no log");
  await parar(id);
});

for (const variante of ["morre", "morre-sem-sessao"])
  test(`pi que não sobe (${variante}): some avaliação e pasta, e a causa vai ao Auditor (CA-17)`, async () => {
    const antes = readdirSync(join(raiz, "avaliacoes")).length;
    const jsonls = readdirSync(join(raiz, "sessoes")).length;
    const avaliacoes = banco.prepare("SELECT count(*) AS n FROM avaliacao").get()?.n;
    piFalso.roteirizar([
      {
        ...resposta,
        sai: {
          codigo: 3,
          stderr: "erro: nenhum modelo configurado",
          quando: variante === "morre" ? "ao_iniciar" : "antes_da_sessao",
        },
      },
    ]);
    await assert.rejects(
      iniciarAvaliacao(banco, escopo, opcoes),
      (e: unknown) => e instanceof ErroExterno && e.message.includes("nenhum modelo configurado"),
    );
    assert.equal(readdirSync(join(raiz, "avaliacoes")).length, antes);
    assert.equal(banco.prepare("SELECT count(*) AS n FROM avaliacao").get()?.n, avaliacoes);
    assert.equal(readdirSync(join(raiz, "sessoes")).length, jsonls);
  });

test("uso sem custo informado fica com custo desconhecido", async () => {
  piFalso.roteirizar([{ ...resposta, custo: null }]);
  const id = await iniciarAvaliacao(banco, escopo, opcoes);
  await ate(() => abrirAv(banco, id).uso.length === 1, "o uso");
  assert.equal(abrirAv(banco, id).uso[0]?.custo, null);
  await parar(id);
});

test("recuperarAuditorias também mata o pi das avaliações do reinício", () => {
  const dir = join(raiz, "avaliacoes", "antiga");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "pgid"), "999999999");
  recuperarAuditorias(raiz);
  assert.ok(!existsSync(join(dir, "pgid")));
});
