import assert from "node:assert/strict";
import { test } from "node:test";
import { type DemandaDoQuadro, quadro } from "./demandas.ts";

const demanda = (id: string, resto: Partial<DemandaDoQuadro> = {}): DemandaDoQuadro => ({
  id,
  projeto: "loja",
  titulo: `Demanda ${id}`,
  fase: "execucao",
  rodadas: [],
  bloqueios: [],
  falhos: [],
  ...resto,
});

test("sem trabalho nem demandas, o quadro diz que não há nada em vez de ficar vazio (CA-7)", () => {
  const html = quadro({ demandas: [], trabalho: [] });
  assert.match(html, /Não há trabalho em andamento\./);
  assert.match(html, /Nenhuma demanda em andamento\./);
});

test("o trabalho ativo traz o ticket, a etapa e a rodada, quando há (CA-6)", () => {
  const html = quadro({
    demandas: [],
    trabalho: [
      { ref: "I-206.T3", etapa: "implementar", rodada: "I-206.R2" },
      { ref: "I-206.T5", etapa: "planejar" },
    ],
  });
  assert.match(html, /I-206\.T3<\/span> Implementação · rodada <span class="id">I-206\.R2/);
  assert.match(html, /I-206\.T5<\/span> Planejamento<\/li>/);
});

test("o cartão traz o título, a fase, as rodadas e o link do PR só na rodada que tem PR (CA-1, CA-2)", () => {
  const html = quadro({
    demandas: [
      demanda("I-206", {
        rodadas: [
          { ref: "I-206.R1", fase: "aprovacao_pull_request", pr: { id: "7", url: "https://pr/7?a=1&b=2" } },
          { ref: "I-206.R2", fase: "desenvolvimento" },
        ],
      }),
    ],
    trabalho: [],
  });
  assert.match(html, /Demanda I-206<\/h3>/);
  assert.match(html, /Execução/);
  assert.match(
    html,
    /I-206\.R1<\/span> <span class="pill pill-aguarda">Aprovação do PR<\/span> <a [^>]*href="https:\/\/pr\/7\?a=1&#38;b=2" target="_blank" rel="noopener">/,
  );
  assert.match(html, /I-206\.R2<\/span> <span class="pill pill-rodando">Desenvolvimento<\/span><\/li>/);
  assert.equal(html.match(/target="_blank"/g)?.length, 1);
  assert.match(html, /aguarda a decisão do Auditor/);
  assert.match(html, /href="\/demandas\/I-206">abrir a demanda →/);
});

test("as marcas: gate da demanda, ticket falho e bloqueio com título e fase (CA-3 a CA-5)", () => {
  const html = quadro({
    demandas: [
      demanda("I-206"),
      demanda("I-207", {
        falhos: [{ ref: "I-207.T1", etapa: "implementar" }],
        bloqueios: [
          { demanda_id: "I-206", fase: "execucao" },
          { demanda_id: "I-300", fase: "planejamento" },
        ],
      }),
      demanda("I-208", { fase: "aprovacao_demanda" }),
      demanda("I-209", { fase: "aprovacao_planejamento" }),
    ],
    trabalho: [],
  });
  assert.match(html, /ticket falho I-207\.T1/);
  assert.match(html, /aguarda I-206 · Demanda I-206 · Execução/);
  assert.match(html, /aguarda I-300 · Planejamento</);
  assert.equal(html.match(/aguarda a decisão do Auditor/g)?.length, 2);
  assert.equal(html.match(/class="cartao dm-cartao aguarda"/g)?.length, 2);
});

test("o texto do servidor é escapado", () => {
  const html = quadro({ demandas: [demanda("I-1", { titulo: "<img onerror=x>" })], trabalho: [] });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&#60;img onerror=x&#62;/);
});
