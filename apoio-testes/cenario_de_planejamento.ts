// O cenário do planejamento: banco real, git real em repositório temporário e pi falso mínimo, com a demanda I-1 (ticket
// `planejar` e, se pedido, o plano submetido) e uma predecessora I-2.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after } from "node:test";
import { AUDITOR } from "../src/sdlc/nucleo/ator.ts";
import type { AgregadoDemanda } from "../src/sdlc/nucleo/demanda/agregado_demanda.ts";
import { Endereco } from "../src/sdlc/nucleo/item_de_trabalho/item_de_trabalho.ts";
import { ConducaoDePlanejar } from "../src/etapas/planejar/conducao_de_planejar.ts";
import { decidirGate } from "../src/sdlc/aplicacao/gates/decidir_gate.ts";
import { registrarProjeto } from "../src/projeto/aplicacao/cadastro.ts";
import { relogioDoSistema } from "../src/compartilhado/nucleo/relogio.ts";
import { condutor } from "../src/trabalho_agentico/aplicacao/trabalho/condutor.ts";
import { carregarDemanda, comDemanda } from "../src/sdlc/armazenamento/demandas.ts";
import { registrarDependenciaDemanda } from "../src/sdlc/aplicacao/gestao_demandas.ts";
import { carregarTrabalhosDoTicket } from "../src/trabalho_agentico/armazenamento/trabalho_agentico.ts";
import { anotar } from "../src/compartilhado/infra/registro.ts";
import { abrirBancoTemporario } from "./banco_temporario.ts";
import { comPlanoSubmetido, gravarAgregadoPronto } from "./cenarios_de_demanda.ts";
import { limitarTempoDoPi } from "./limite_do_pi.ts";
import { instalarPiFalso } from "./pi_falso.ts";
import { criarRepositorioDeTeste } from "./repositorio_de_teste.ts";

const em = "2026-01-01T00:00:00.000Z";
const temporario = mkdtempSync(join(tmpdir(), "fabriquinha-planejamento-"));
process.env.PI_CODING_AGENT_DIR = join(temporario, "pi-agent");
delete process.env.FABRIQUINHA_PORTA;

const abertos: DatabaseSync[] = [];
after(() => {
  for (const b of abertos) b.close();
});

export const CRITERIOS = ["CA-1", "CA-2"];
export const plano = (criterios = CRITERIOS) => ({
  demanda_id: "I-1",
  criterios,
  rodadas: [1, 2].map((rodada_id) => ({
    demanda_id: "I-1",
    rodada_id,
    titulo: `r${String(rodada_id)}`,
    e2e: false,
    criterios: [criterios[0]],
    depende: rodada_id === 2 ? [{ demanda_id: "I-1", rodada_id: 1 }] : [],
  })),
  tickets: [1, 2].map((n) => ({
    demanda_id: "I-1",
    ticket_id: n,
    rodada_id: n,
    titulo: `t${String(n)}`,
    descricao: "d",
  })),
});

/** Preparação: marca `preparado`; com o arquivo `quebra` na raiz, falha só em rodadas/1. */
function preparacao(raiz: string): string {
  return `[ -e ${raiz}/quebra ] && [ "$(basename "$PWD")" = 1 ] && exit 1; touch preparado; true`;
}

function demanda(id: string, estado: string, extra: object = {}) {
  return {
    id,
    projeto: "loja",
    titulo: "t",
    tipo: "funcionalidade",
    descricao: "d",
    estado,
    estado_alterado_em: em,
    criada_por: { tipo: "externo", ferramenta: "claude", sessao: "s1" },
    enviada: true,
    branch: `fabriquinha/${id}`,
    ...extra,
  };
}

/** Projeto `loja`, demanda I-1 no estado dado com o ticket `planejar` (e o plano, se submetido) e uma predecessora I-2. */
export function cenarioDePlanejamento({
  estado = "planejar",
  estadoDoTicket = "aberto",
  comPlano = false,
  predecessora = "concluida",
} = {}) {
  const c = criarRepositorioDeTeste();
  const { banco } = abrirBancoTemporario(c.raiz);
  abertos.push(banco);
  registrarProjeto(banco, {
    nome: "loja",
    branch_base: "integracao",
    chave_sonarqube: "k",
    raiz_git: c.repo,
    hospedagem: "github",
    etapas: [],
    verificacoes: {
      preparacao: [preparacao(c.raiz)],
      fitness: [{ nome: "f", comando: "true", descricao: "d" }],
      linguagens: [{ caminho: ".", linguagem: "ts", comando_teste: "true" }],
    },
  });
  const base = {
    tentativas: [],
    rodadas: [],
    dependencias_rodada: [],
    criterios_citados: [],
    dependencias_ticket: [],
    caminhos_ticket: [],
    arquivos_previstos_rodada: [],
    arquivos_previstos_demanda: [],
    versoes_plano: [],
  };
  gravarAgregadoPronto(banco, {
    demanda: demanda("I-2", predecessora),
    tickets: [],
    decisoes: [],
    evidencias: [],
    ...base,
  } as unknown as AgregadoDemanda);
  gravarAgregadoPronto(banco, {
    demanda: demanda("I-1", estado, { enviada: false }),
    tickets: [
      {
        demanda_id: "I-1",
        ticket_id: 1,
        etapa: "planejar",
        estado: estadoDoTicket,
        estado_alterado_em: em,
        criado_por: { tipo: "fabriquinha" },
      },
    ],
    decisoes: [],
    evidencias: [
      {
        demanda_id: "I-1",
        tipo: "criterios_aceite",
        autor: { tipo: "externo", ferramenta: "claude", sessao: "s1" },
        dados: { criterios: CRITERIOS.map((id) => ({ id, dado: "d", quando: "q", entao: "e" })) },
        em,
      },
      ...(comPlano
        ? [
            {
              demanda_id: "I-1",
              ticket_id: 1,
              tipo: "plano",
              autor: { tipo: "agente", trabalho_id: "1" },
              dados: plano(),
              em,
            },
          ]
        : []),
    ],
    ...base,
  } as unknown as AgregadoDemanda);
  registrarDependenciaDemanda(banco, "I-1", "I-2"); // só antes do envio
  banco.exec("UPDATE demanda SET enviada = 1 WHERE id = 'I-1'");
  const piFalso = instalarPiFalso(c.dir);
  return {
    c,
    banco,
    piFalso,
    prompts: () => piFalso.prompts().map((entrada) => entrada.prompt),
    sessoes: () => carregarTrabalhosDoTicket(banco, { demanda_id: "I-1", ticket_id: 1 }),
    status: () => carregarDemanda(banco, "I-1").tickets[0]?.estado,
  };
}

export const agente = { tipo: "agente", trabalho_id: "1" } as const;
const APROVACAO_SEM_NOTA = { resultado: "aprovado" };
export const aprovarGateDoPlanejamento = (banco: DatabaseSync, entrada: unknown = APROVACAO_SEM_NOTA) =>
  decidirGate(banco, "gate_planejamento", Endereco.daDemanda("I-1"), entrada, AUDITOR);
export const reprovarGateDoPlanejamento = (banco: DatabaseSync, motivo: string) =>
  aprovarGateDoPlanejamento(banco, { resultado: "reprovado", motivo });
export const proporPlanoDoAgente = (banco: DatabaseSync, demandaId: string, planoEntrada: unknown) =>
  comDemanda(banco, demandaId, (ag) => comPlanoSubmetido(ag, planoEntrada, agente, new Date().toISOString()));

/** Conduz o `planejar` da demanda I-1 até o fim da execução, com a ociosidade do pi limitada a `minutos`. */
export function planejar(banco: DatabaseSync, minutos: number): Promise<void> {
  limitarTempoDoPi(banco, minutos);
  return new ConducaoDePlanejar({ banco, relogio: relogioDoSistema, condutor, registro: anotar }).conduzir(
    Endereco.doTicket("I-1", 1),
  );
}
