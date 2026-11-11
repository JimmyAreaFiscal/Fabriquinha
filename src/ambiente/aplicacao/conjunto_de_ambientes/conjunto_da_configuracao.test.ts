import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { instalarDockerFalso } from "../../../../apoio-testes/docker_falso.ts";
import { migrar } from "../../../compartilhado/armazenamento/banco.ts";
import { MIGRACOES } from "../../../compartilhado/armazenamento/migracoes/migracoes.ts";
import { validarESalvarConfiguracaoDoAmbiente } from "../projeto/configuracao_do_ambiente.ts";
import { ErroDeRegra } from "../../../compartilhado/nucleo/erros.ts";
import { espacoDaDemanda } from "../../nucleo/espaco_de_trabalho.ts";
import { Projeto } from "../../nucleo/projeto.ts";
import { GeradorDeAmbientes } from "../../infra/container/gerador_de_ambientes.ts";
import { montarConjuntoDoServico } from "../espaco/ambiente_do_servico.ts";
import { ConjuntoDeAmbientes } from "./conjunto.ts";
import { relogioDoSistema } from "../../../compartilhado/nucleo/relogio.ts";
import { eliminarAmbienteDoConjunto, listarAmbientesDoConjunto } from "./conjunto_da_configuracao.ts";

const base = mkdtempSync(join(tmpdir(), "fabriquinha-conjunto-configuracao-"));
after(() => {
  rmSync(base, { recursive: true, force: true });
});

const projeto = Projeto.parse({
  nome: "loja",
  raiz_git: base,
  branch_base: "main",
  hospedagem: "github",
  chave_sonarqube: "Loja",
  imagem_do_ambiente: "alpine",
});
const espaco = espacoDaDemanda(projeto, "I-1", base);

let cenarios = 0;

/** Um banco com um container alocado ao Espaço e o docker falso que o criou. */
async function conjuntoComUmAlocado() {
  const docker = instalarDockerFalso(join(base, `docker-${String(++cenarios)}`));
  const banco = new DatabaseSync(":memory:");
  migrar(banco, MIGRACOES);
  validarESalvarConfiguracaoDoAmbiente(banco, { tipo: "container" });
  const conjunto = new ConjuntoDeAmbientes(banco, new GeradorDeAmbientes(), relogioDoSistema, {
    raiz: base,
    porta_da_api: 4999,
    home_do_usuario: base,
  });
  const ambiente = await conjunto.alocar(espaco, projeto);
  return { docker, banco, conjunto, ambiente };
}

test("sem conjunto montado (host_local), a eliminação cria um e remove o container livre pelo docker", async () => {
  const { docker, banco, conjunto, ambiente } = await conjuntoComUmAlocado();
  await conjunto.liberar(espaco);
  assert.deepEqual(
    listarAmbientesDoConjunto(banco).map(({ id, estado }) => ({ id, estado })),
    [{ id: ambiente.id, estado: "livre" }],
  );
  await eliminarAmbienteDoConjunto(banco, ambiente.id);
  assert.deepEqual(listarAmbientesDoConjunto(banco), []);
  assert.deepEqual(docker.containers(), []);
});

test("o container alocado é recusado e continua no conjunto e no docker", async () => {
  const { docker, banco, ambiente } = await conjuntoComUmAlocado();
  await assert.rejects(eliminarAmbienteDoConjunto(banco, ambiente.id), ErroDeRegra);
  assert.equal(listarAmbientesDoConjunto(banco).length, 1);
  assert.equal(docker.containers().length, 1);
});

test("com o conjunto montado pelo serviço, a eliminação vai para ele", async () => {
  const eliminados: string[] = [];
  montarConjuntoDoServico(() => ({ eliminar: (id: string) => Promise.resolve(void eliminados.push(id)) }) as never);
  try {
    await eliminarAmbienteDoConjunto(new DatabaseSync(":memory:"), "a1");
  } finally {
    montarConjuntoDoServico(() => undefined);
  }
  assert.deepEqual(eliminados, ["a1"]);
});
