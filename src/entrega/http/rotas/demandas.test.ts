// Rotas de leitura das demandas (CA-1 a CA-12 e CA-37) contra o servidor web de verdade.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Endereco } from "../../../nucleo/item_de_trabalho.ts";
import { guardarBytes } from "../../../armazenamento/arquivos.ts";
import { comDemanda } from "../../../armazenamento/demandas.ts";
import { gravarAnexos } from "../../../armazenamento/evidencia_demanda.ts";
import { cenarioDemandas } from "../../../../apoio-testes/servidor_web_de_teste.ts";

interface Anexo {
  nome: string;
  classe: string;
  link: string;
}
interface Evidencia {
  tipo: string;
  ticket?: string;
  anexos: Anexo[];
}
interface Pagina {
  demanda: { tipo: string; descricao: string };
  rodadas: { ref: string; ticket_atual_por_etapa: Record<string, string> }[];
  tickets: {
    ref: string;
    etapa: string;
    sessao?: string;
    pi_ativo?: true;
    titulo?: string;
    motivo?: string;
    instrucao?: string;
    elegivel: boolean;
  }[];
  decisoes: { ticket: string; resultado: string; motivo?: string; nota?: number; por: string }[];
  evidencias: Evidencia[];
  encerramento: { passos: { feito: boolean }[]; aguardando_merge?: { url: string } };
  dependencias: unknown[];
  dependentes: { demanda_id: string; titulo: string; estado: string }[];
}
interface Board {
  demandas: {
    id: string;
    projeto: string;
    titulo: string;
    estado: string;
    rodadas: unknown[];
    bloqueios: unknown[];
    falhos: unknown[];
  }[];
  trabalho: unknown[];
}
const prFinal = {
  numero: 9,
  url: "https://pr/9",
  head: "abc",
  estado: "aberto" as const,
  atualizado_em: "2026-01-01T00:00:00.000Z",
};
const comportamento = (evidencias: Evidencia[]): Evidencia => {
  const e = evidencias.find((x) => x.tipo === "comportamento");
  assert.ok(e);
  return e;
};

test("CA-1: o board traz a I-206 com o estado dela", async () => {
  const { pedir } = await cenarioDemandas();
  const r = await pedir("/api/demandas");
  assert.equal(r.status, 200);
  const i206 = r.json<Board>().demandas.find((d) => d.id === "I-206");
  assert.deepEqual([i206?.projeto, i206?.titulo, i206?.estado], ["loja", "demanda I-206", "em_execucao"]);
});

test("CA-2: sem o cookie da sessão, 401 com a orientação de rodar fabriquinha abrir", async () => {
  const { pedir } = await cenarioDemandas();
  const r = await pedir("/api/demandas", { cookie: false });
  assert.equal(r.status, 401);
  assert.match(String(r.json().erro), /fabriquinha abrir/);
});

test("CA-3: as duas rodadas da I-206 com o estado de cada uma e o PR aberto da R2", async () => {
  const { pedir } = await cenarioDemandas();
  const i206 = (await pedir("/api/demandas")).json<Board>().demandas[0];
  assert.deepEqual(i206?.rodadas, [
    { ref: "I-206.R1", estado: "concluida" },
    { ref: "I-206.R2", estado: "gate_pr", pr: { id: "7", url: "https://pr/7" } },
  ]);
});

test("CA-4: a I-207 aparece com o bloqueio da I-206 e o estado dela; integrada, deixa de bloquear", async () => {
  const { pedir, banco } = await cenarioDemandas();
  const i207 = () => pedir("/api/demandas").then((r) => r.json<Board>().demandas[1]);
  assert.deepEqual((await i207())?.bloqueios, [{ demanda_id: "I-206", estado: "em_execucao" }]);
  banco.exec("UPDATE demanda SET estado = 'concluida' WHERE id = 'I-206'");
  assert.deepEqual((await i207())?.bloqueios, []);
});

test("CA-5: o trabalho global ativo traz o ticket em execução com a etapa e a rodada", async () => {
  const { pedir } = await cenarioDemandas();
  assert.deepEqual((await pedir("/api/demandas")).json<Board>().trabalho, [
    { ref: "I-206.T3", etapa: "implementar", rodada: "I-206.R2" },
  ]);
});

test("o trabalho ativo e a página marcam `pi_ativo` só quando o pi subiu, não na preparação da worktree", async () => {
  const { pedir, banco } = await cenarioDemandas();
  banco.exec(`INSERT INTO trabalho_agentico (id, demanda_id, ticket_id, modo, conversa_referencia) VALUES ('s', 'I-206', 3, 'autonomo', 'c');
    INSERT INTO processo_do_trabalho (id, trabalho_id, inicio, fim, falha) VALUES ('e', 's', '2026-01-01T00:00:00.000Z', NULL, 0)`);
  // Execução aberta sem o grupo do pi: a preparação da worktree, que é o sistema.
  assert.deepEqual((await pedir("/api/demandas")).json<Board>().trabalho, [
    { ref: "I-206.T3", etapa: "implementar", rodada: "I-206.R2" },
  ]);
  banco.exec("UPDATE processo_do_trabalho SET grupo_processo = 4242 WHERE id = 'e'");
  assert.deepEqual((await pedir("/api/demandas")).json<Board>().trabalho, [
    { ref: "I-206.T3", etapa: "implementar", rodada: "I-206.R2", pi_ativo: true },
  ]);
  const { tickets } = (await pedir("/api/demandas/I-206")).json<Pagina>();
  assert.deepEqual(
    tickets.filter((t) => t.pi_ativo).map((t) => t.ref),
    ["I-206.T3"],
  );
});

test("o board não mostra a demanda arquivada", async () => {
  const { pedir, banco } = await cenarioDemandas();
  banco.exec("UPDATE demanda SET estado = 'arquivada' WHERE id = 'I-207'");
  const ids = (await pedir("/api/demandas")).json<Board>().demandas.map((d: { id: string }) => d.id);
  assert.deepEqual(ids, ["I-206"]);
});

test("CA-3 (T-1289): o board traz os tickets falhos com o endereço público e a etapa", async () => {
  const { pedir, banco } = await cenarioDemandas();
  const falhosDe = async () => (await pedir("/api/demandas")).json<Board>().demandas[0]?.falhos;
  assert.deepEqual(await falhosDe(), []);
  comDemanda(banco, "I-206", (ag) => ({
    ...ag,
    tickets: ag.tickets.map((t) => (t.ticket_id === 3 ? { ...t, estado: "falhou" } : t)),
  }));
  assert.deepEqual(await falhosDe(), [{ ref: "I-206.T3", etapa: "implementar" }]);
});

test("a página traz o tipo e a descrição da demanda, que o Auditor lê na aprovação", async () => {
  const { pedir } = await cenarioDemandas();
  const { demanda } = (await pedir("/api/demandas/I-206")).json<Pagina>();
  assert.deepEqual([demanda.tipo, demanda.descricao], ["funcionalidade", "d"]);
});

test("CA-6: a página traz cada ticket com o endereço público e a etapa", async () => {
  const { pedir } = await cenarioDemandas();
  const { tickets } = (await pedir("/api/demandas/I-206")).json<Pagina>();
  assert.deepEqual(
    tickets.map((t) => [t.ref, t.etapa]),
    [
      ["I-206.T1", "implementar"],
      ["I-206.T2", "encerrar_rodada"],
      ["I-206.T3", "implementar"],
      ["I-206.T4", "encerrar_rodada"],
      ["I-206.T5", "planejar"],
    ],
  );
  assert.equal(tickets[2]?.titulo, "implementa");
});

test("a página entrega, em cada rodada, o endereço do ticket atual de cada etapa: o de maior id", async () => {
  const { pedir, banco } = await cenarioDemandas();
  const atuais = async () =>
    (await pedir("/api/demandas/I-206")).json<Pagina>().rodadas.map((r) => r.ticket_atual_por_etapa.implementar);
  assert.deepEqual(await atuais(), ["I-206.T1", "I-206.T3"]);
  comDemanda(banco, "I-206", (ag) => ({
    ...ag,
    tickets: ag.tickets.flatMap((t) => (t.ticket_id === 3 ? [t, { ...t, ticket_id: 6 }] : [t])),
  }));
  assert.deepEqual(await atuais(), ["I-206.T1", "I-206.T6"]);
});

test("o ticket é elegível só se a seleção o escolheria agora", async () => {
  const { pedir, banco } = await cenarioDemandas();
  const elegiveis = async (id: string) =>
    (await pedir(`/api/demandas/${id}`)).json<Pagina>().tickets.map((t) => [t.ref, t.elegivel]);
  // Estado sem seleção: nenhum ticket da I-206 (R2 aguarda o PR).
  assert.ok((await elegiveis("I-206")).every(([, e]) => e === false));
  // Dois abertos na mesma rodada: só o de menor id.
  comDemanda(banco, "I-206", (ag) => ({
    ...ag,
    rodadas: ag.rodadas.map((r) => (r.rodada_id === 2 ? { ...r, estado: "implementar" } : r)),
    tickets: ag.tickets.flatMap((t) =>
      t.ticket_id === 3
        ? [
            { ...t, estado: "aberto" as const },
            { ...t, ticket_id: 6, estado: "aberto" as const },
          ]
        : [t],
    ),
  }));
  const execucao = await elegiveis("I-206");
  assert.deepEqual(
    execucao.filter(([, e]) => e).map(([r]) => r),
    ["I-206.T3"],
  );
  assert.deepEqual(
    execucao.find(([r]) => r === "I-206.T6"),
    ["I-206.T6", false],
  );
  // Predecessora pendente bloqueia o planejamento; concluída, libera.
  comDemanda(banco, "I-207", (ag) => ({
    ...ag,
    tickets: [
      {
        demanda_id: "I-207",
        ticket_id: 1,
        etapa: "planejar",
        criado_por: { tipo: "fabriquinha" },
        estado: "aberto",
        estado_alterado_em: "2026-01-01T00:00:00.000Z",
      },
    ],
  }));
  assert.deepEqual(await elegiveis("I-207"), [["I-207.T1", false]]);
  banco.exec("UPDATE demanda SET estado = 'concluida' WHERE id = 'I-206'");
  assert.deepEqual(await elegiveis("I-207"), [["I-207.T1", true]]);
});

test("CA-16 e CA-17: a página traz a sessão mais recente só nos tickets que têm sessão", async () => {
  const { pedir, banco } = await cenarioDemandas();
  const nova = banco.prepare(
    "INSERT INTO trabalho_agentico (id, demanda_id, ticket_id, modo, conversa_referencia) VALUES (?, 'I-206', 3, 'autonomo', 'c')",
  );
  nova.run("s-antiga");
  nova.run("s-nova");
  const { tickets } = (await pedir("/api/demandas/I-206")).json<Pagina>();
  assert.deepEqual(
    tickets.map((t) => t.sessao),
    [undefined, undefined, "s-nova", undefined, undefined],
  );
});

test("a página traz o motivo da falha e a instrução do ticket", async () => {
  const { pedir, banco } = await cenarioDemandas();
  comDemanda(banco, "I-206", (ag) => ({
    ...ag,
    tickets: ag.tickets.map((t) => (t.ticket_id === 1 ? { ...t, estado: "falhou", instrucao: "tente de novo" } : t)),
  }));
  comDemanda(banco, "I-206", (ag) => ({
    ...ag,
    tentativas: [
      {
        ticket: Endereco.doTicket("I-206", 1),
        numero: 1,
        inicio: "2026-01-01T00:00:00.000Z",
        fim: "2026-01-01T00:01:00.000Z",
        resultado: { tipo: "interrompida", por: { tipo: "fabriquinha" }, motivo: "quebrou" },
      },
    ],
  }));
  const t1 = (await pedir("/api/demandas/I-206")).json<Pagina>().tickets[0];
  assert.deepEqual([t1?.motivo, t1?.instrucao], ["quebrou", "tente de novo"]);
});

test("CA-7: as decisões na ordem em que foram tomadas", async () => {
  const { pedir } = await cenarioDemandas();
  const { decisoes } = (await pedir("/api/demandas/I-206")).json<Pagina>();
  assert.deepEqual(
    decisoes.map((d) => [d.ticket, d.resultado, d.motivo ?? d.nota, d.por]),
    [
      ["I-206.T5", "reprovado", "refaça", "auditor"],
      ["I-206.T5", "aprovado", 4, "auditor"],
    ],
  );
});

test("CA-8: a evidência com o nome e a classe de cada anexo", async () => {
  const { pedir } = await cenarioDemandas();
  const { evidencias } = (await pedir("/api/demandas/I-206")).json<Pagina>();
  const e = comportamento(evidencias);
  assert.equal(e.ticket, "I-206.T3");
  assert.deepEqual(
    e.anexos.map((a) => [a.nome, a.classe]),
    [
      ["um.txt", "texto"],
      ["dois.html", "html"],
    ],
  );
  assert.deepEqual(evidencias.find((x) => x.tipo === "pr_aberto")?.anexos, []);
});

test("CA-9: o link do anexo devolve o mesmo conteúdo, com os cabeçalhos de segurança", async () => {
  const { pedir, conteudos } = await cenarioDemandas();
  const { evidencias } = (await pedir("/api/demandas/I-206")).json<Pagina>();
  const [um, dois] = comportamento(evidencias).anexos;
  const r = await pedir(um?.link ?? "");
  assert.equal(r.status, 200);
  assert.equal(r.corpo.toString(), conteudos[0]);
  assert.equal(r.headers["content-type"], "text/plain");
  assert.equal(r.headers["content-security-policy"], "sandbox allow-scripts");
  assert.equal(r.headers["content-disposition"], undefined);
  const baixado = await pedir(`${String(dois?.link)}&baixar`);
  assert.equal(baixado.corpo.toString(), conteudos[1]);
  assert.equal(baixado.headers["content-disposition"], "attachment; filename*=UTF-8''dois.html");
});

test("o anexo de dono errado ou sem o tipo é reprovado", async () => {
  const { pedir } = await cenarioDemandas();
  const { evidencias } = (await pedir("/api/demandas/I-206")).json<Pagina>();
  const link = comportamento(evidencias).anexos[0]?.link ?? "";
  assert.equal((await pedir(link.replace("ticket=3", "ticket=4"))).status, 409);
  assert.equal((await pedir(link.slice(0, link.indexOf("?")))).status, 422);
});

test("CA-10: o progresso do encerramento com os passos feitos e o pendente", async () => {
  const { pedir, banco } = await cenarioDemandas();
  comDemanda(banco, "I-206", (ag) => ({
    ...ag,
    demanda: { ...ag.demanda, estado: "encerrar_demanda" },
    encerramento: {
      demanda_id: "I-206",
      branch: "fabriquinha/I-206",
      base: "main",
      sha_verificado: "abc",
      limpeza_pendente: [],
      falha: { etapa: "integracao", motivo: "conflito" },
    },
    pull_requests: [prFinal],
  }));
  const { encerramento } = (await pedir("/api/demandas/I-206")).json<Pagina>();
  assert.deepEqual(encerramento, {
    passos: [
      { passo: "verificacao", feito: true },
      { passo: "pr", feito: true },
      { passo: "integracao", feito: false },
    ],
    limpeza_pendente: [],
    falha: { etapa: "integracao", motivo: "conflito" },
  });
});

test("o PR final à espera do merge humano vem no encerramento e marca a demanda no quadro", async () => {
  const { pedir, banco } = await cenarioDemandas();
  comDemanda(banco, "I-206", (ag) => ({
    ...ag,
    demanda: { ...ag.demanda, estado: "encerrar_demanda" },
    rodadas: ag.rodadas.map((r) => ({ ...r, estado: "concluida" as const })),
    tickets: [
      ...ag.tickets.map((t) => ({ ...t, estado: "concluido" as const })),
      {
        demanda_id: "I-206",
        ticket_id: 99,
        etapa: "encerrar_demanda",
        criado_por: { tipo: "fabriquinha" },
        estado: "aberto",
        estado_alterado_em: "2026-01-01T00:00:00.000Z",
      },
    ],
    encerramento: {
      demanda_id: "I-206",
      branch: "fabriquinha/I-206",
      base: "main",
      sha_verificado: "abc",
      aguardando_merge_humano: true,
      limpeza_pendente: [],
    },
    pull_requests: [prFinal],
  }));
  const { encerramento, tickets } = (await pedir("/api/demandas/I-206")).json<Pagina>();
  assert.deepEqual(encerramento.aguardando_merge, { url: "https://pr/9" });
  // A seleção o escolheria, mas ele pede o merge na plataforma, não a execução.
  assert.equal(tickets.find((t) => t.etapa === "encerrar_demanda")?.elegivel, false);
  const { demandas } = (await pedir("/api/demandas")).json<{ demandas: { id: string; aguarda_merge: boolean }[] }>();
  assert.deepEqual(
    demandas.map((d) => [d.id, d.aguarda_merge]),
    [
      ["I-206", true],
      ["I-207", false],
    ],
  );
});

test("sem encerramento, todos os passos estão pendentes", async () => {
  const { pedir } = await cenarioDemandas();
  const { encerramento } = (await pedir("/api/demandas/I-207")).json<Pagina>();
  assert.deepEqual(
    encerramento.passos.map((p) => p.feito),
    [false, false, false],
  );
});

test("CA-11: a I-207 traz a I-206 como dependência, com a situação dela", async () => {
  const { pedir } = await cenarioDemandas();
  const r = (await pedir("/api/demandas/I-207")).json<Pagina>();
  assert.deepEqual(r.dependencias, [{ demanda_id: "I-206", estado: "em_execucao" }]);
  assert.deepEqual(r.rodadas, []);
});

test("CA-27: a I-206 traz a I-207 como dependente que vai junto no cancelamento", async () => {
  const { pedir } = await cenarioDemandas();
  const r = (await pedir("/api/demandas/I-206")).json<Pagina>();
  assert.equal(r.dependentes.length, 1);
  assert.equal(r.dependentes[0]?.demanda_id, "I-207");
  assert.equal(typeof r.dependentes[0].titulo, "string");
  assert.deepEqual((await pedir("/api/demandas/I-207")).json<Pagina>().dependentes, []);
});

test("CA-12: a I-999 não existe, 404 com a mensagem", async () => {
  const { pedir } = await cenarioDemandas();
  const r = await pedir("/api/demandas/I-999");
  assert.equal(r.status, 404);
  assert.match(String(r.json().erro), /I-999 não existe/);
});

test("a classe do anexo pelo mime", async () => {
  const { pedir, banco } = await cenarioDemandas();
  banco.exec(`UPDATE arquivo_evidencia SET mime = 'image/png' WHERE ordem = 1;
    UPDATE arquivo_evidencia SET mime = 'video/mp4' WHERE ordem = 2`);
  const mudar = (mime: string) => banco.prepare("UPDATE arquivo_evidencia SET mime = ? WHERE ordem = 2").run(mime);
  const classes = async () =>
    (await pedir("/api/demandas/I-206")).json<Pagina>().evidencias.flatMap((e) => e.anexos.map((a) => a.classe));
  assert.deepEqual(await classes(), ["imagem", "video"]);
  // O HTML que o F3 grava leva o charset (MIME_HTML).
  mudar("text/html; charset=utf-8");
  assert.equal((await classes())[1], "html");
  mudar("application/json");
  assert.equal((await classes())[1], "texto");
  mudar("application/zip");
  assert.equal((await classes())[1], "outro");
});

test("o anexo de evidência da rodada leva a rodada no link e na evidência", async () => {
  const { pedir, banco } = await cenarioDemandas();
  comDemanda(
    banco,
    "I-206",
    (ag) => ({
      ...ag,
      evidencias: [
        ...ag.evidencias,
        {
          demanda_id: "I-206",
          rodada_id: 2,
          ticket_id: undefined,
          tipo: "comportamento",
          autor: { tipo: "fabriquinha" },
          dados: {},
          em: "2026-01-02T00:00:00.000Z",
        },
      ],
    }),
    () => {
      gravarAnexos(banco, { demanda_id: "I-206", rodada_id: 2, ticket_id: undefined, tipo: "comportamento" }, [
        { caminho: "r.txt", mime: "text/plain", ...guardarBytes(banco, Buffer.from("da rodada")) },
      ]);
    },
  );
  const { evidencias } = (await pedir("/api/demandas/I-206")).json<Pagina>();
  const e = evidencias.find((x) => (x as { rodada?: string }).rodada === "I-206.R2");
  const link = e?.anexos[0]?.link ?? "";
  assert.match(link, /rodada=2/);
  assert.equal((await pedir(link)).corpo.toString(), "da rodada");
});

test("o nome do anexo baixado sai codificado (RFC 5987)", async () => {
  const { pedir, banco } = await cenarioDemandas();
  banco.exec("UPDATE arquivo_evidencia SET caminho = 'a''b (1).txt' WHERE ordem = 1");
  const { evidencias } = (await pedir("/api/demandas/I-206")).json<Pagina>();
  const r = await pedir(`${comportamento(evidencias).anexos[0]?.link ?? ""}&baixar`);
  assert.equal(r.headers["content-disposition"], "attachment; filename*=UTF-8''a%27b%20%281%29.txt");
});
