// A evidência que o agente submete ao próprio ticket, contra banco real e uma worktree de verdade: valida na entrada,
// reconfere dentro da transação e recusa por erro síncrono, sem gravar nada e sem Tentativa (D10-1).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { fabricaDeBancosTemporarios } from "../../../../../../apoio-testes/banco_temporario.ts";
import {
  abrirTrabalhoDoAgente,
  cadastrarProjetoLoja,
  gravarAgregadoPronto,
  INSTANTE_DO_CENARIO as em,
  montarAgregadoDemanda,
  montarRodada,
  montarTicket,
} from "../../../../../../apoio-testes/cenarios_de_demanda.ts";
import { carregarDemanda } from "../../../processo/publico.ts";
import { createHash } from "node:crypto";
import { adicionarEvidenciaComAnexosEnviados } from "./adicionar_evidencia.ts";

const abrirBancoTemporario = fabricaDeBancosTemporarios();

const PLANO = {
  demanda_id: "I-206",
  criterios: ["CA-1"],
  rodadas: [{ demanda_id: "I-206", rodada_id: 1, titulo: "r1", e2e: false, criterios: ["CA-1"], depende: [] }],
  tickets: [
    { demanda_id: "I-206", ticket_id: 1, rodada_id: 1, titulo: "t", descricao: "d", caminhos: [], depende: [] },
  ],
};
const ESTRESSE = {
  aplicavel: true,
  cenarios: [{ nome: "carga", objetivo: "o", comando: "npm test", resultado: "passou", observado: "ok" }],
};
const TRECHO = (inicio: number, fim: number) => ({
  trechos: [{ arquivo: "a.ts", inicio, fim, oQueFaz: "f", porQue: "p", decisaoDoDesenho: "d" }],
});

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8" }).trim();

/** A worktree da rodada 1 de verdade: a.ts tem 3 linhas, 2 delas mudadas entre base e head. */
function worktreeDaRodada(raiz: string): object {
  const dir = join(raiz, "worktrees", "loja", "I-206", "rodadas", "1");
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q");
  writeFileSync(join(dir, "a.ts"), "x\ny\nz\n");
  git(dir, "add", ".");
  git(dir, "commit", "-qm", "base");
  const base = git(dir, "rev-parse", "HEAD");
  writeFileSync(join(dir, "a.ts"), "x\nY\nZ\n");
  git(dir, "commit", "-qam", "head");
  return {
    base,
    head: git(dir, "rev-parse", "HEAD"),
    arquivos: [{ caminho: "a.ts", status: "M", adicionadas: 2, removidas: 2, previsto: "src/**" }],
    previstosNaoTocados: [],
  };
}

/** I-206 em planejamento com o planejar (T1), a revisão integral (T5) e o encerrar rodada (T7) em execução. */
function cenario() {
  const { raiz, banco } = abrirBancoTemporario();
  const alterados = worktreeDaRodada(raiz);
  cadastrarProjetoLoja(banco);
  const emExecucao = { estado: "em_execucao" };
  const agente = (ticket_id: number) => ({ tipo: "agente", trabalho_id: `e-I-206-T${String(ticket_id)}` });
  gravarAgregadoPronto(
    banco,
    montarAgregadoDemanda("I-206", "planejar", {
      rodadas: [montarRodada("I-206", 1, "revisar_rodada")],
      criterios_citados: [{ demanda_id: "I-206", rodada_id: 1, criterio_id: "CA-1" }],
      tickets: [
        montarTicket("I-206", 1, "planejar", emExecucao),
        montarTicket("I-206", 5, "revisar_demanda", emExecucao),
        montarTicket("I-206", 7, "encerrar_rodada", { rodada_id: 1, ...emExecucao }),
        montarTicket("I-206", 8, "revisar_rodada", { rodada_id: 1, estado: "concluido" }),
      ],
      evidencias: [
        {
          demanda_id: "I-206",
          tipo: "criterios_aceite",
          autor: { tipo: "externo", ferramenta: "claude", sessao: "s1" },
          em,
          dados: { criterios: [{ id: "CA-1" }, { id: "CA-2" }] },
        },
        {
          demanda_id: "I-206",
          ticket_id: 8,
          tipo: "arquivos_alterados",
          autor: agente(8),
          em,
          dados: alterados,
        },
      ],
    }),
  );
  const processo = (ticket_id: number) => ({
    id: abrirTrabalhoDoAgente(banco, { demanda_id: "I-206", ticket_id }).trabalho_id,
  });
  const lerJson = (valor: string) => Promise.resolve(JSON.parse(valor) as unknown);
  const adicionar = (ticket_id: number, tipo: string, dados: unknown, ...caminhos: string[]) =>
    adicionarEvidenciaComAnexosEnviados(
      banco,
      processo(ticket_id),
      {
        ticket: `I-206.T${String(ticket_id)}`,
        tipo,
        dados: JSON.stringify(dados),
        anexos: caminhos.map(anexoLidoDe),
      },
      lerJson,
    );
  const saida = (ticket_id: number, nome: string, conteudo: string) => {
    const pasta = join(raiz, "execucoes", `E-e-I-206-T${String(ticket_id)}`, "saida");
    mkdirSync(pasta, { recursive: true });
    writeFileSync(join(pasta, nome), conteudo);
    return join(pasta, nome);
  };
  return { raiz, banco, processo, adicionar, saida, lerJson };
}

/** O anexo como o cliente do agente o manda: o caminho, os bytes lidos e o SHA-256 deles. */
const anexoLidoDe = (caminho: string) => {
  const conteudo = readFileSync(caminho);
  return { caminho, conteudo, sha256: createHash("sha256").update(conteudo).digest("hex") };
};

const gravadas = (banco: DatabaseSync) =>
  banco
    .prepare("SELECT ticket_id, tipo FROM evidencia_demanda WHERE em <> ?")
    .all(em)
    .map((l) => ({ ...l }));

test("o plano válido fica registrado com o agente como autor, e a demanda vai ao gate de planejamento", async () => {
  const { banco, adicionar } = cenario();
  assert.deepEqual(await adicionar(1, "plano", PLANO), { ticket: "I-206.T1", tipo: "plano", veredito: undefined });
  assert.deepEqual(gravadas(banco), [{ ticket_id: 1, tipo: "plano" }]);
  const agregado = carregarDemanda(banco, "I-206");
  assert.deepEqual(agregado.evidencias.find((e) => e.tipo === "plano")?.autor, {
    tipo: "agente",
    trabalho_id: "e-I-206-T1",
  });
  assert.equal(agregado.demanda.estado, "gate_planejamento");
});

test("plano com campo inválido é recusado com o caminho do campo e não grava", async () => {
  const { banco, adicionar } = cenario();
  await assert.rejects(adicionar(1, "plano", { ...PLANO, criterios: "CA-1" }), {
    name: "ErroDeRegra",
    message: /dados\.criterios/,
  });
  assert.deepEqual(gravadas(banco), []);
});

test("testes_estresse válido, com anexo da saída, fica no ticket com o veredito derivado", async () => {
  const { banco, adicionar, saida } = cenario();
  const log = saida(5, "estresse.log", "tudo certo\n");
  assert.deepEqual(await adicionar(5, "testes_estresse", ESTRESSE, log), {
    ticket: "I-206.T5",
    tipo: "testes_estresse",
    veredito: "atende",
  });
  assert.deepEqual(gravadas(banco), [{ ticket_id: 5, tipo: "testes_estresse" }]);
  assert.deepEqual(
    banco
      .prepare("SELECT caminho, mime FROM arquivo_evidencia")
      .all()
      .map((a) => ({ ...a })),
    [{ caminho: "estresse.log", mime: "text/plain; charset=utf-8" }],
  );
});

test("anexo fora da worktree e da saída é recusado sem gravar", async () => {
  const { raiz, banco, adicionar } = cenario();
  const fora = join(raiz, "fora.log");
  writeFileSync(fora, "x");
  await assert.rejects(
    adicionar(5, "testes_estresse", ESTRESSE, fora),
    /está fora da worktree do ticket e do diretório de saída/,
  );
  assert.deepEqual(gravadas(banco), []);
});

test("ticket alheio, T-5 e rodada não gravam nada e mostram a forma certa", async () => {
  const { banco, processo, lerJson } = cenario();
  const dados = JSON.stringify(ESTRESSE);
  const adicionar = (ticket: string) =>
    adicionarEvidenciaComAnexosEnviados(
      banco,
      processo(5),
      { ticket, tipo: "testes_estresse", dados, anexos: [] },
      lerJson,
    );
  await assert.rejects(adicionar("I-206.T4"), { message: "o agente só age no próprio ticket (aja em I-206.T5)" });
  await assert.rejects(adicionar("T-5"), /I-206\.T5/);
  await assert.rejects(adicionar("I-206.R1"), /I-206\.T5/);
  assert.deepEqual(gravadas(banco), []);
});

test("ticket já concluído, execução terminada e execução inexistente não gravam nada", async () => {
  const { banco, processo, adicionar } = cenario();
  banco.prepare("UPDATE ticket_demanda SET estado = 'concluido' WHERE ticket_id = 5").run();
  await assert.rejects(adicionar(5, "testes_estresse", ESTRESSE), {
    message: "o ticket I-206.T5 está concluido e não recebe evidência (siga com o seu ticket)",
  });
  banco.prepare("UPDATE ticket_demanda SET estado = 'em_execucao' WHERE ticket_id = 5").run();
  banco.prepare("UPDATE processo_do_trabalho SET fim = ? WHERE id = ?").run(em, processo(5).id);
  await assert.rejects(adicionar(5, "testes_estresse", ESTRESSE), {
    name: "ErroDeEscopo",
    message: "a execução e-I-206-T5 já terminou (peça ao Auditor uma nova execução)",
  });
  await assert.rejects(
    adicionarEvidenciaComAnexosEnviados(
      banco,
      { id: "exec-x" },
      { ticket: "I-206.T5", tipo: "plano", dados: "{}", anexos: [] },
      () => Promise.resolve({}),
    ),
    { message: "a execução exec-x não existe (confira a execução)" },
  );
  assert.deepEqual(gravadas(banco), []);
});

test("tipo que o agente não submete, ou de outra etapa, é recusado", async () => {
  const { adicionar } = cenario();
  await assert.rejects(adicionar(5, "pr_aberto", ESTRESSE), {
    message:
      "pr_aberto não é evidência que o agente submete (use um de plano, explicacao_fitness, comprovacao_criterios, mensagem_pr, aula_codigo, video_demonstracao, testes_estresse, analise_seguranca)",
  });
  await assert.rejects(adicionar(7, "plano", PLANO), /T-7 \(encerrar_rodada\) não aceita evidência plano/);
});

test("sem dados, ou com dados que o leitor não lê, a evidência é recusada antes de gravar", async () => {
  const { banco, processo } = cenario();
  const sem = adicionarEvidenciaComAnexosEnviados(
    banco,
    processo(5),
    { ticket: "I-206.T5", tipo: "testes_estresse", dados: undefined, anexos: [] },
    () => Promise.resolve({}),
  );
  await assert.rejects(sem, { message: "falta --dados (passe --dados <arquivo.json|->)" });
  const ruim = adicionarEvidenciaComAnexosEnviados(
    banco,
    processo(5),
    { ticket: "I-206.T5", tipo: "testes_estresse", dados: "{", anexos: [] },
    (valor) => Promise.reject(new SyntaxError(`${valor} não é um JSON válido`)),
  );
  await assert.rejects(ruim, SyntaxError);
  assert.deepEqual(gravadas(banco), []);
});

test("aula_codigo: o agente envia só trechos e a Fabriquinha gera o HTML; anexo do agente, schema ruim e trecho fora do diff são recusados", async () => {
  const { banco, adicionar, saida } = cenario();
  await assert.rejects(adicionar(7, "aula_codigo", TRECHO(2, 3), saida(7, "x.html", "<html>")), {
    message: "aula_codigo não aceita anexo do agente (a Fabriquinha gera o HTML; submeta só --dados)",
  });
  await assert.rejects(adicionar(7, "aula_codigo", { trechos: "a.ts" }), { name: "ZodError" });
  await assert.rejects(adicionar(7, "aula_codigo", TRECHO(1, 1)), /não toca nenhuma linha alterada/);
  assert.deepEqual(gravadas(banco), []);
  assert.deepEqual(await adicionar(7, "aula_codigo", TRECHO(2, 3)), {
    ticket: "I-206.T7",
    tipo: "aula_codigo",
    veredito: undefined,
  });
  assert.deepEqual(
    banco
      .prepare("SELECT caminho FROM arquivo_evidencia")
      .all()
      .map((a) => a.caminho),
    ["aula.html"],
  );
  assert.deepEqual(gravadas(banco), [{ ticket_id: 7, tipo: "aula_codigo" }]);
});
