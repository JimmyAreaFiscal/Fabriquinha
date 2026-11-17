import assert from "node:assert/strict";
import { test } from "node:test";
import type { AmbientesEmUso } from "../../../system/api/contrato/ambientes.ts";
import { paginaDeAmbientes } from "./ambientes.ts";

const ocupado: AmbientesEmUso["containers"][number] = {
  id: "c1",
  slot: 1,
  imagem: "node:22 <img>",
  estado: "alocado",
  medido: { cpus: 1.5, memoria_mb: 512 },
  projeto: "loja",
  demanda: "I-37",
  ticket: "I-37.T1",
  worktree: "loja/I-37/rodadas/1",
  caminho_completo_da_worktree: "/dados/worktrees/loja/I-37/rodadas/1",
  branch: "fabriquinha/I-37-1",
};
const livre: AmbientesEmUso["containers"][number] = {
  ...ocupado,
  id: "c2",
  slot: 2,
  estado: "livre",
  projeto: null,
  demanda: null,
  ticket: null,
  worktree: null,
  caminho_completo_da_worktree: null,
  branch: null,
};

test("container ocupado: o nome do slot, a imagem (inteira no title), estado, uso e o que roda nele", () => {
  const html = paginaDeAmbientes({ tipo: "container", containers: [ocupado] });
  assert.match(html, /<h1>Ambientes<\/h1>/);
  assert.match(
    html,
    /<tr data-container="c1"><td>Fabriquinha - Slot 1<\/td><td class="mono corta" title="node:22 &#60;img&#62;">node:22 &#60;img&#62;<\/td><td>alocado<\/td>/,
  );
  assert.match(
    html,
    /<td class="num">1,50 CPUs<\/td><td class="num">512 MB<\/td><td>loja<\/td><td>I-37<\/td><td>I-37\.T1<\/td>/,
  );
  assert.match(
    html,
    /<td class="mono" title="\/dados\/worktrees\/loja\/I-37\/rodadas\/1">loja\/I-37\/rodadas\/1<\/td><td class="mono">fabriquinha\/I-37-1<\/td><\/tr>/,
  );
});

test("container livre: o ocupante vazio, com o mesmo traço sem fonte mono em toda coluna", () => {
  const html = paginaDeAmbientes({ tipo: "container", containers: [livre] });
  assert.match(
    html,
    /<td>livre<\/td><td class="num">1,50 CPUs<\/td><td class="num">512 MB<\/td><td>—<\/td><td>—<\/td><td>—<\/td><td>—<\/td><td>—<\/td><\/tr>/,
  );
});

test("sem medida do docker, só o uso vem com traço; o nome do slot segue", () => {
  const html = paginaDeAmbientes({ tipo: "container", containers: [{ ...livre, medido: null }] });
  assert.match(
    html,
    /<tr data-container="c2"><td>Fabriquinha - Slot 2<\/td>.*<td class="num">—<\/td><td class="num">—<\/td>/,
  );
});

test("o container de antes do slot existir vem com traço no nome", () => {
  const html = paginaDeAmbientes({ tipo: "container", containers: [{ ...livre, slot: null }] });
  assert.match(html, /<tr data-container="c2"><td>—<\/td>/);
});

test("conjunto vazio e host_local explicam em vez de ficar sem nada", () => {
  assert.match(paginaDeAmbientes({ tipo: "container", containers: [] }), /Nenhum container no conjunto/);
  const html = paginaDeAmbientes({ tipo: "host_local", containers: [] });
  assert.match(html, /O trabalho roda no host: não há containers\./);
  assert.doesNotMatch(html, /<table/);
});
