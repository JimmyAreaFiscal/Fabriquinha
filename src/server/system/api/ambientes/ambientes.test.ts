import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { abrirBancoTemporario } from "../../../../../apoio-testes/banco/banco_temporario.ts";
import {
  cadastrarProjetoLoja,
  gravarAgregadoPronto,
  montarAgregadoDemanda,
  montarRodada,
  montarTicket,
} from "../../../../../apoio-testes/cenarios/cenarios_de_demanda.ts";
import { inserirAmbienteAlocado, liberarAmbiente } from "../../../../../apoio-testes/falsos/ambiente_falso.ts";
import { instalarDockerFalso } from "../../../../../apoio-testes/falsos/docker_falso.ts";
import { noLog } from "../../../../shared/infra/registro.ts";
import { salvarConfiguracaoDoAmbiente } from "../../../../shared/armazenamento/configuracao_do_ambiente.ts";
import { ConfiguracaoDoAmbiente } from "../../../../shared/nucleo/configuracao_do_ambiente.ts";
import { montarAmbientesDoServico } from "../../ambientes_do_servico.ts";
import { montarCicloDeVidaDoBanco, montarDemandasDoBanco } from "../../banco_da_fabriquinha.ts";
import { AmbientesEmUso } from "../contrato/ambientes.ts";
import { montarRepositorio } from "../../../../modulos/repositorio/publico.ts";
import { relogioDoSistema } from "../../../../shared/nucleo/relogio.ts";
import { ROTAS } from "../servidor.ts";
import { consultarAmbientesEmUso } from "./consulta_ambientes.ts";

const pastaDoDockerFalso = mkdtempSync(join(tmpdir(), "fabriquinha-ambientes-"));
after(() => {
  rmSync(pastaDoDockerFalso, { recursive: true, force: true });
});

/** O Ambiente em `container` e a demanda I-1 do projeto `loja`, com o T3 em execução na rodada R1. */
async function montarCenarioDaDemandaEmExecucao(
  tipo: "container" | "host_local" = "container",
  outrosTickets: object[] = [],
) {
  const { banco, raiz } = abrirBancoTemporario();
  salvarConfiguracaoDoAmbiente(banco, ConfiguracaoDoAmbiente.parse({ tipo }));
  cadastrarProjetoLoja(banco);
  gravarAgregadoPronto(
    banco,
    montarAgregadoDemanda("I-1", "em_execucao", {
      tickets: [
        montarTicket("I-1", 1, "entender_e_desenhar", { estado: "concluido" }),
        montarTicket("I-1", 3, "implementar", { rodada_id: 1, estado: "em_execucao" }),
        ...outrosTickets,
      ],
      rodadas: [montarRodada("I-1", 1, "implementar")],
    }),
  );
  const docker = instalarDockerFalso(mkdtempSync(join(pastaDoDockerFalso, "docker-")));
  const ambientes = await montarAmbientesDoServico({ banco, raiz, porta: 0, registrarErro: noLog });
  const chamarRota = () => {
    const rota = ROTAS.find(({ metodo, caminho }) => metodo === "GET" && caminho === "/api/ambientes");
    assert.ok(rota?.resposta, "GET /api/ambientes não está na tabela de rotas, com o schema da resposta");
    return rota.tratar({
      banco,
      cicloDeVida: montarCicloDeVidaDoBanco(banco),
      ambientes,
      demandas: montarDemandasDoBanco(banco),
      repositorio: montarRepositorio({ banco, ambientes: ambientes.gestao }),
      relogio: relogioDoSistema,
      params: {},
      query: new URLSearchParams(),
      corpo: undefined,
      cabecalhos: {},
      resposta: undefined as unknown as ServerResponse,
    });
  };
  const consultarAmbientesDoCenario = (demandas = montarDemandasDoBanco(banco)) =>
    consultarAmbientesEmUso(banco, montarCicloDeVidaDoBanco(banco), ambientes, demandas);
  const semearContainerAlocado = (id: string, alocadoPara: string, uso?: { cpu: string; memoria: string }) => {
    const container = docker.semearContainer({ rotulos: { "fabriquinha.ambiente": id }, ...(uso && { uso }) });
    inserirAmbienteAlocado(banco, {
      id,
      container_id: container.id,
      imagem: "alpine",
      slot: Number(id.slice(-1)),
      alocado_para: alocadoPara,
      criado_em: `2026-11-09T10:00:0${id.slice(-1)}.000Z`,
    });
    return container;
  };
  return { banco, raiz, docker, consultarAmbientesDoCenario, chamarRota, semearContainerAlocado };
}

test("CA-1: o container ocupado traz nome, imagem, estado, uso e o projeto, a demanda, o ticket, a worktree e a branch", async () => {
  const { raiz, consultarAmbientesDoCenario, semearContainerAlocado } = await montarCenarioDaDemandaEmExecucao();
  semearContainerAlocado("a-1", "I-1.R1", { cpu: "37.50%", memoria: "300MiB / 2GiB" });

  const resposta = await consultarAmbientesDoCenario();

  assert.deepEqual(resposta, {
    tipo: "container",
    containers: [
      {
        id: "a-1",
        slot: 1,
        imagem: "alpine",
        estado: "alocado",
        medido: { cpus: 0.375, memoria_mb: 300 },
        projeto: "loja",
        demanda: "I-1",
        ticket: "I-1.T3",
        worktree: join("loja", "I-1", "rodadas", "1"),
        caminho_completo_da_worktree: join(raiz, "worktrees", "loja", "I-1", "rodadas", "1"),
        branch: "fabriquinha/I-1-1",
      },
    ],
  });
  assert.deepEqual(AmbientesEmUso.parse(resposta), resposta);
});

test("o container do Espaço da demanda traz a worktree e a branch da demanda, e sem ticket em execução nela o ticket vem vazio", async () => {
  const { raiz, consultarAmbientesDoCenario, semearContainerAlocado } = await montarCenarioDaDemandaEmExecucao();
  semearContainerAlocado("a-1", "I-1");

  const [container] = (await consultarAmbientesDoCenario()).containers;

  assert.deepEqual(
    container && [
      container.demanda,
      container.ticket,
      container.worktree,
      container.caminho_completo_da_worktree,
      container.branch,
    ],
    ["I-1", null, join("loja", "I-1", "demanda"), join(raiz, "worktrees", "loja", "I-1", "demanda"), "fabriquinha/I-1"],
  );
});

test("os tickets em execução no mesmo Espaço saem juntos", async () => {
  const { consultarAmbientesDoCenario, semearContainerAlocado } = await montarCenarioDaDemandaEmExecucao("container", [
    montarTicket("I-1", 4, "revisar_rodada", { rodada_id: 1, estado: "em_execucao" }),
  ]);
  semearContainerAlocado("a-1", "I-1.R1");

  const [container] = (await consultarAmbientesDoCenario()).containers;

  assert.equal(container?.ticket, "I-1.T3, I-1.T4");
});

test("CA-3: o container livre traz nome, imagem, estado e uso, com projeto, demanda, ticket, worktree e branch vazios", async () => {
  const { banco, consultarAmbientesDoCenario, semearContainerAlocado } = await montarCenarioDaDemandaEmExecucao();
  semearContainerAlocado("a-1", "I-1.R1");
  liberarAmbiente(banco, "a-1", "livre", "2026-11-09T11:00:00.000Z");

  assert.deepEqual((await consultarAmbientesDoCenario()).containers, [
    {
      id: "a-1",
      slot: 1,
      imagem: "alpine",
      estado: "livre",
      medido: { cpus: 0, memoria_mb: 0 },
      projeto: null,
      demanda: null,
      ticket: null,
      worktree: null,
      caminho_completo_da_worktree: null,
      branch: null,
    },
  ]);
});

test("o ocupante que o Ciclo de Vida não reconhece (endereço fora do formato ou demanda que não existe) fica sem projeto, demanda, ticket, worktree e branch", async () => {
  const { consultarAmbientesDoCenario, semearContainerAlocado } = await montarCenarioDaDemandaEmExecucao();
  semearContainerAlocado("a-1", "ocupante-estranho");
  semearContainerAlocado("a-2", "I-99");

  const { containers } = await consultarAmbientesDoCenario();

  assert.equal(containers.length, 2);
  for (const container of containers) {
    assert.equal(container.estado, "alocado");
    assert.deepEqual(
      [
        container.projeto,
        container.demanda,
        container.ticket,
        container.worktree,
        container.caminho_completo_da_worktree,
        container.branch,
      ],
      [null, null, null, null, null, null],
    );
  }
});

test("o docker que não responde deixa só o uso vazio: o slot e o resto da linha seguem", async () => {
  const { docker, consultarAmbientesDoCenario, semearContainerAlocado } = await montarCenarioDaDemandaEmExecucao();
  semearContainerAlocado("a-1", "I-1.R1");
  docker.falharComando("stats", "Cannot connect to the Docker daemon");

  const [container] = (await consultarAmbientesDoCenario()).containers;

  assert.deepEqual(container && [container.slot, container.medido, container.demanda], [1, null, "I-1"]);
});

test("CA-4: no host_local a consulta diz o tipo, sem containers e sem chamar o docker", async () => {
  const { docker, consultarAmbientesDoCenario, semearContainerAlocado } =
    await montarCenarioDaDemandaEmExecucao("host_local");
  semearContainerAlocado("a-1", "I-1.R1");
  const chamadasAntes = docker.registro().length;

  const resposta = await consultarAmbientesDoCenario();

  assert.deepEqual(resposta, { tipo: "host_local", containers: [] });
  assert.equal(docker.registro().length, chamadasAntes);
  assert.deepEqual(AmbientesEmUso.parse(resposta), resposta);
});

test("GET /api/ambientes está na tabela de rotas e devolve a consulta", async () => {
  const { chamarRota, consultarAmbientesDoCenario, semearContainerAlocado } = await montarCenarioDaDemandaEmExecucao();
  semearContainerAlocado("a-1", "I-1.R1");

  assert.deepEqual(await chamarRota(), await consultarAmbientesDoCenario());
});

test("a falha que não é de regra, como a do banco, não vira ocupante vazio", async () => {
  const { banco, consultarAmbientesDoCenario, semearContainerAlocado } = await montarCenarioDaDemandaEmExecucao();
  semearContainerAlocado("a-1", "I-1.R1");
  const demandasQueFalham = { ...montarDemandasDoBanco(banco), projeto: () => assert.fail("banco indisponível") };

  await assert.rejects(consultarAmbientesDoCenario(demandasQueFalham), /banco indisponível/);
});
