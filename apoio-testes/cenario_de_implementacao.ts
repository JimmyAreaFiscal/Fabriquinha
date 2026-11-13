// O cenário das conduções do `implementar` e do `resolver_conflito`: git real temporário, banco real, pi falso que escreve
// na pasta de trabalho e a demanda I-1 com a rodada 1 em `implementar` (ou, com `conflito`, em `encerrar_demanda`).
import assert from "node:assert/strict";
import { join } from "node:path";
import type { AgregadoDemanda } from "../src/modulos/sdlc/nucleo/demanda/agregado_demanda.ts";
import { Endereco } from "../src/modulos/compartilhado/nucleo/vocabulario_do_sdlc/endereco.ts";
import { motivoDaFalhaDoTicket } from "../src/modulos/sdlc/nucleo/tentativa.ts";
import type { DepsDaConducao } from "../src/modulos/sdlc/aplicacao/despacho/despacho.ts";
import type { RegistroDaVerificacao } from "../src/modulos/ciclo_de_vida/publico.ts";
import { relogioDoSistema } from "../src/modulos/compartilhado/nucleo/relogio.ts";
import {
  condutor as condutorDoServico,
  type CondutorDeTrabalhos,
} from "../src/modulos/trabalho_agentico/aplicacao/trabalho/condutor.ts";
import { anotar } from "../src/modulos/compartilhado/infra/registro.ts";
import { registrarProjeto } from "../src/modulos/projeto/aplicacao/cadastro.ts";
import { carregarDemanda, comDemanda } from "../src/modulos/sdlc/armazenamento/demandas.ts";
import {
  garantirWorktreeDemanda,
  garantirWorktreeRodada,
} from "../src/modulos/repositorio/infra/worktree/worktree-demanda.ts";
import { AmbienteHostLocal } from "../src/modulos/sandbox/infra/host_local/ambiente_host_local.ts";
import { abrirBancoTemporario } from "./banco_temporario.ts";
import { gravarAgregadoPronto } from "./cenarios_de_demanda.ts";
import { instalarPiFalso } from "./pi_falso.ts";
import { criarRepositorioDeTeste, rodarGit } from "./repositorio_de_teste.ts";
import { verificacaoDeTeste } from "./verificacoes_de_teste.ts";

const ambiente = new AmbienteHostLocal();
const em = "2026-01-01T00:00:00.000Z";
export const DEMANDA = "I-1";
export const ref = (ticket_id: number) => ({ demanda_id: DEMANDA, ticket_id });
export const enderecoDoTicket = (ticket_id: number) => Endereco.doTicket(DEMANDA, ticket_id);

export const ticket = (ticket_id: number, etapa: string, status: string, extra: object = {}) => ({
  demanda_id: DEMANDA,
  ticket_id,
  etapa,
  estado: status,
  estado_alterado_em: em,
  criado_por: { tipo: "fabriquinha" },
  ...extra,
});

export const verif = (tipo: RegistroDaVerificacao["tipo"], passou: boolean | undefined, motivo = "falhou") =>
  verificacaoDeTeste(
    tipo,
    passou,
    motivo,
    passou === true ? undefined : [{ nome: `${tipo}.log`, texto: "a".repeat(3000) + "FIM" }],
  );
export const TIPOS = ["execucao_testes", "matriz_fitness", "relatorio_sonar"] as const;
export const todas = (passou: boolean | undefined, motivo?: string) => TIPOS.map((t) => verif(t, passou, motivo));
export const coletor = (resultado: RegistroDaVerificacao[]) => ({
  coletarVerificacoes: () => Promise.resolve(resultado),
});
export const naoColeta = {
  coletarVerificacoes: (): Promise<RegistroDaVerificacao[]> => {
    throw new Error("não devia coletar");
  },
};

interface Opcoes {
  tickets?: object[];
  /** Cria a demanda em `encerrar_demanda`, com o conflito pendente no ticket 3 (o `resolver_conflito`). */
  conflito?: boolean;
  tipo?: string;
  reprovacoesAnteriores?: number;
}

export async function cenarioDeImplementacao({
  tickets,
  conflito,
  tipo = "funcionalidade",
  reprovacoesAnteriores = 0,
}: Opcoes = {}) {
  const c = criarRepositorioDeTeste();
  process.env.PI_CODING_AGENT_DIR = join(c.dir, "pi-agent");
  delete process.env.FABRIQUINHA_PORTA;
  const { banco } = abrirBancoTemporario(c.raiz);
  registrarProjeto(banco, {
    nome: "loja",
    branch_base: "integracao",
    chave_sonarqube: "k",
    raiz_git: c.repo,
    hospedagem: "github",
    etapas: [],
    verificacoes: {
      fitness: [{ nome: "f", comando: "true", descricao: "d" }],
      linguagens: [{ caminho: ".", linguagem: "ts", comando_teste: "true" }],
    },
  });
  gravarAgregadoPronto(banco, {
    demanda: {
      id: DEMANDA,
      projeto: "loja",
      titulo: "Cache",
      tipo,
      descricao: "d",
      estado: conflito ? "encerrar_demanda" : "em_execucao",
      estado_alterado_em: em,
      criada_por: { tipo: "externo", ferramenta: "claude", sessao: "s1" },
      enviada: true,
      branch: "fabriquinha/I-1",
    },
    rodadas: [
      {
        demanda_id: DEMANDA,
        rodada_id: 1,
        titulo: "r1",
        estado: "implementar",
        estado_alterado_em: em,
        e2e: false,
        branch: "fabriquinha/I-1-1",
      },
    ],
    dependencias_rodada: [],
    criterios_citados: [],
    tickets: conflito
      ? [
          ticket(1, "entender_e_desenhar", "concluido"),
          ticket(2, "encerrar_demanda", "aberto"),
          ticket(3, "resolver_conflito", "aberto"),
        ]
      : (tickets ?? [ticket(1, "implementar", "aberto", { rodada_id: 1, titulo: "Cachear" })]),
    tentativas: Array.from({ length: reprovacoesAnteriores }, (_, indice) => ({
      ticket: enderecoDoTicket(conflito ? 3 : 1),
      numero: indice + 1,
      inicio: em,
      fim: em,
      resultado: { tipo: "reprovacao", motivo: "corrija" },
    })),
    dependencias_ticket: [],
    caminhos_ticket: [],
    arquivos_previstos_rodada: [],
    arquivos_previstos_demanda: [],
    versoes_plano: [],
    decisoes: [],
    evidencias: [],
    ...(conflito && {
      encerramento: {
        demanda_id: DEMANDA,
        branch: "fabriquinha/I-1",
        base: "integracao",
        pr: { numero: 7, url: "https://h/pr/7" },
        sha_verificado: "s1",
        limpeza_pendente: [],
        conflito_pendente: { ticket_id: 3 },
      },
    }),
  } as unknown as AgregadoDemanda);
  await garantirWorktreeDemanda(ambiente, c.raiz, c.projeto, DEMANDA, c.log);
  const worktree = conflito
    ? join(c.raiz, "worktrees", "loja", DEMANDA, "demanda")
    : await garantirWorktreeRodada(ambiente, c.raiz, c.projeto, { demanda_id: DEMANDA, rodada_id: 1 }, c.log);
  // O agente do cenário escreve um arquivo de duas linhas na pasta de trabalho do ticket.
  const piFalso = instalarPiFalso(c.dir);
  piFalso.roteirizar([{ escreve: { "novo.txt": "x\ny\n" } }]);
  const evidencias = (n: number) =>
    banco
      .prepare("SELECT tipo FROM evidencia_demanda WHERE ticket_id = ? ORDER BY tipo")
      .all(n)
      .map((l) => l.tipo);
  const status = (n: number) => carregarDemanda(banco, DEMANDA).tickets.find((t) => t.ticket_id === n);
  const commits = () => rodarGit(worktree, "log", "--format=%s", "--grep", "\\[I-1\\.T").split("\n").filter(Boolean);
  const motivo = (n: number) => {
    const ticketDoCenario = status(n);
    assert.ok(ticketDoCenario);
    return motivoDaFalhaDoTicket(carregarDemanda(banco, DEMANDA).tentativas, ticketDoCenario);
  };
  const reprovacoes = (n: number) =>
    carregarDemanda(banco, DEMANDA).tentativas.filter(
      (tentativa) => tentativa.ticket.ticket_id === n && tentativa.resultado?.tipo === "reprovacao",
    ).length;
  const reprovarDuasVezes = (n: number) =>
    comDemanda(banco, DEMANDA, (ag) => ({
      ...ag,
      tentativas: [1, 2].map((numero) => ({
        ticket: enderecoDoTicket(n),
        numero,
        inicio: em,
        fim: em,
        resultado: { tipo: "reprovacao" as const, motivo: "corrija" },
      })),
    }));
  /** As dependências da condução; `condutor` troca o do serviço (a parada do serviço, por exemplo). */
  const deps = (condutor: CondutorDeTrabalhos = condutorDoServico): DepsDaConducao => ({
    banco,
    relogio: relogioDoSistema,
    condutor,
    registro: anotar,
  });
  return {
    c,
    banco,
    piFalso,
    worktree,
    deps,
    evidencias,
    status,
    commits,
    motivo,
    reprovacoes,
    reprovarDuasVezes,
    ag: () => carregarDemanda(banco, DEMANDA),
  };
}

export type CenarioDeImplementacao = Awaited<ReturnType<typeof cenarioDeImplementacao>>;
