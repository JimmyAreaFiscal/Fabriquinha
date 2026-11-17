import assert from "node:assert/strict";
import { test } from "node:test";
import type { AmbientesEmUso } from "../../../system/api/contrato/ambientes.ts";
import { paginaDeAmbientes } from "./ambientes.ts";

const ocupado: AmbientesEmUso["containers"][number] = {
  id: "c1",
  nome_do_container: "fabriquinha-sandbox-1",
  imagem: "node:22 <img>",
  estado: "alocado",
  medido: { cpus: 1.5, memoria_mb: 512 },
  projeto: "loja",
  demanda: "I-37",
  ticket: "I-37.T1",
  worktree: "/wt/I-37",
  branch: "I-37/t1",
};
const livre: AmbientesEmUso["containers"][number] = {
  ...ocupado,
  id: "c2",
  nome_do_container: "fabriquinha-sandbox-2",
  estado: "livre",
  projeto: null,
  demanda: null,
  ticket: null,
  worktree: null,
  branch: null,
};

test("container ocupado: nome no docker, imagem, estado, uso e o que roda nele", () => {
  const html = paginaDeAmbientes({ tipo: "container", containers: [ocupado] });
  assert.match(html, /<h1>Ambientes<\/h1>/);
  assert.match(
    html,
    /<tr data-container="c1"><td class="mono">fabriquinha-sandbox-1<\/td><td class="mono">node:22 &#60;img&#62;<\/td><td>alocado<\/td>/,
  );
  assert.match(
    html,
    /<td class="num">1,50 CPUs<\/td><td class="num">512 MB<\/td><td>loja<\/td><td>I-37<\/td><td>I-37\.T1<\/td>/,
  );
  assert.match(html, /<td class="mono">\/wt\/I-37<\/td><td class="mono">I-37\/t1<\/td><\/tr>/);
});

test("container livre: o ocupante vazio, com traço", () => {
  const html = paginaDeAmbientes({ tipo: "container", containers: [livre] });
  assert.match(
    html,
    /<td>livre<\/td><td class="num">1,50 CPUs<\/td><td class="num">512 MB<\/td><td>—<\/td><td>—<\/td><td>—<\/td><td class="mono">—<\/td><td class="mono">—<\/td>/,
  );
});

test("sem medida do docker, o uso e o nome vêm com traço", () => {
  const html = paginaDeAmbientes({
    tipo: "container",
    containers: [{ ...livre, nome_do_container: null, medido: null }],
  });
  assert.match(
    html,
    /<tr data-container="c2"><td class="mono">—<\/td>.*<td class="num">—<\/td><td class="num">—<\/td>/,
  );
});

test("conjunto vazio e host_local explicam em vez de ficar sem nada", () => {
  assert.match(paginaDeAmbientes({ tipo: "container", containers: [] }), /Nenhum container no conjunto/);
  const html = paginaDeAmbientes({ tipo: "host_local", containers: [] });
  assert.match(html, /O trabalho roda no host: não há containers\./);
  assert.doesNotMatch(html, /<table/);
});
