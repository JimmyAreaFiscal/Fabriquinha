// Agregados de demanda prontos em cada estado do Ciclo de Vida, para os testes que partem de uma demanda já avançada.
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { AgregadoDemanda } from "../src/nucleo/agregado_demanda.ts";
import type { Ator } from "../src/nucleo/ator.ts";
import type { EstadoDemanda } from "../src/nucleo/primitivos.ts";
import { gravarProjeto } from "../src/armazenamento/projetos.ts";
import { Projeto } from "../src/nucleo/projeto.ts";
import { criarDemandaNova } from "../src/armazenamento/demandas.ts";
import { garantirWorktreeDemanda } from "../src/infra/repositorio/worktree-demanda.ts";
import { abrirBancoTemporario } from "./banco_temporario.ts";
import { instalarPiFalso } from "./pi_falso.ts";
import { criarRepositorioDeTeste } from "./repositorio_de_teste.ts";
import { AmbienteHostLocal } from "../src/infra/ambiente/ambiente_host_local.ts";

const ambiente = new AmbienteHostLocal();

export const INSTANTE_DO_CENARIO = "2026-01-01T00:00:00.000Z";

/** O ticket aberto da `etapa`; `extra` sobrescreve qualquer campo. */
export const montarTicket = (demanda_id: string, ticket_id: number, etapa: string, extra: object = {}) => ({
  demanda_id,
  ticket_id,
  etapa,
  estado: "aberto",
  estado_alterado_em: INSTANTE_DO_CENARIO,
  criado_por: { tipo: "fabriquinha" },
  ...extra,
});

export const montarRodada = (demanda_id: string, rodada_id: number, estado: string) => ({
  demanda_id,
  rodada_id,
  titulo: `rodada ${String(rodada_id)}`,
  estado,
  estado_alterado_em: "2026-01-01T00:00:00.000Z",
  e2e: false,
  branch: `fabriquinha/${demanda_id}-${String(rodada_id)}`,
});

/** Uma demanda `estado` do projeto `loja`, sem rodadas nem tickets além dos de `resto`. */
export const montarAgregadoDemanda = (id: string, estado: string, resto: object = {}): AgregadoDemanda =>
  ({
    demanda: {
      id,
      projeto: "loja",
      titulo: `demanda ${id}`,
      tipo: "funcionalidade",
      descricao: "d",
      estado,
      estado_alterado_em: INSTANTE_DO_CENARIO,
      criada_por: { tipo: "externo", ferramenta: "claude", sessao: id },
      enviada: estado !== "entender_e_desenhar",
      branch: `fabriquinha/${id}`,
    },
    tickets: [],
    tentativas: [],
    decisoes: [],
    evidencias: [],
    rodadas: [],
    dependencias_rodada: [],
    criterios_citados: [],
    dependencias_ticket: [],
    caminhos_ticket: [],
    pull_requests: [],
    ...resto,
  }) as unknown as AgregadoDemanda;

const concluido = { estado: "concluido" };

/**
 * A demanda `id` como o Ciclo de Vida a deixa em `estado`: T1 `demanda`, T2 `planejar`, T3 `implementar` da R1, T4
 * `revisar_demanda` e T5 `encerrar_demanda`, cada um aberto na sua estado e concluído nas seguintes; a R1 nasce em
 * `implementar` e fica `concluida` quando a revisão da demanda começa. Cancelada, tem o T5 cancelado.
 */
export function agregadoNoEstado(id: string, estado: EstadoDemanda): AgregadoDemanda {
  const indice = (f: EstadoDemanda) => ESTADOS_DO_CICLO.indexOf(f);
  const adiante = (limite: EstadoDemanda) => indice(estado) > indice(limite);
  const tickets = [
    montarTicket(
      id,
      1,
      "entender_e_desenhar",
      estado === "entender_e_desenhar" ? { estado: "em_execucao" } : concluido,
    ),
    ...(indice(estado) >= indice("planejar")
      ? [montarTicket(id, 2, "planejar", adiante("planejar") ? concluido : {})]
      : []),
    ...(indice(estado) >= indice("em_execucao")
      ? [montarTicket(id, 3, "implementar", { rodada_id: 1, ...(adiante("em_execucao") && concluido) })]
      : []),
    ...(indice(estado) >= indice("revisar_demanda")
      ? [montarTicket(id, 4, "revisar_demanda", adiante("revisar_demanda") ? concluido : {})]
      : []),
    ...(indice(estado) >= indice("encerrar_demanda")
      ? [
          montarTicket(
            id,
            5,
            "encerrar_demanda",
            estado === "cancelada" ? { estado: "cancelado" } : adiante("encerrar_demanda") ? concluido : {},
          ),
        ]
      : []),
  ];
  const rodadas =
    indice(estado) >= indice("em_execucao")
      ? [montarRodada(id, 1, adiante("em_execucao") ? "concluida" : "implementar")]
      : [];
  return montarAgregadoDemanda(id, estado, { tickets, rodadas });
}

// A ordem do Ciclo de Vida; os estados terminais vêm por último, na ordem em que se alcançam a partir do encerramento.
const ESTADOS_DO_CICLO: readonly EstadoDemanda[] = [
  "entender_e_desenhar",
  "gate_demanda",
  "planejar",
  "gate_planejamento",
  "em_execucao",
  "revisar_demanda",
  "encerrar_demanda",
  "concluida",
  "arquivada",
  "cancelada",
];

/**
 * I-1 em execução, como a revisão a encontra: R1 em `revisar_rodada` (implementar T1 concluído, revisar_rodada T2 aberto) e
 * o revisar_demanda T3 aberto. Com `integral`: em `revisar_demanda`, R1 concluída e o T2 concluído.
 */
export function agregadoEmRevisao({ integral = false } = {}): AgregadoDemanda {
  return montarAgregadoDemanda("I-1", integral ? "revisar_demanda" : "em_execucao", {
    rodadas: [montarRodada("I-1", 1, integral ? "concluida" : "revisar_rodada")],
    tickets: [
      montarTicket("I-1", 1, "implementar", { rodada_id: 1, ...concluido }),
      montarTicket("I-1", 2, "revisar_rodada", { rodada_id: 1, ...(integral && concluido) }),
      montarTicket("I-1", 3, "revisar_demanda"),
    ],
  });
}

/**
 * Em execução com a R1 concluída (T1, T2) e a R2 com o PR 7 aberto (T3 em execução, T4 encerrar_rodada concluído), o
 * T5 de planejamento concluído com uma decisão reprovada e outra aprovada do Auditor, e a evidência `comportamento` do T3.
 */
export function agregadoComPullRequestAberto(id: string): AgregadoDemanda {
  const decisao = (decisao_id: number, resto: object) => ({
    demanda_id: id,
    ticket_id: 5,
    decisao_id,
    gate: "gate_planejamento",
    por: { tipo: "auditor" },
    em: INSTANTE_DO_CENARIO,
    ...resto,
  });
  return montarAgregadoDemanda(id, "em_execucao", {
    rodadas: [montarRodada(id, 1, "concluida"), montarRodada(id, 2, "gate_pr")],
    tickets: [
      montarTicket(id, 1, "implementar", { rodada_id: 1, ...concluido }),
      montarTicket(id, 2, "encerrar_rodada", { rodada_id: 1, ...concluido }),
      montarTicket(id, 3, "implementar", { rodada_id: 2, estado: "em_execucao", titulo: "implementa" }),
      montarTicket(id, 4, "encerrar_rodada", { rodada_id: 2, ...concluido }),
      montarTicket(id, 5, "planejar", concluido),
    ],
    decisoes: [
      decisao(1, { resultado: "reprovado", motivo: "refaça" }),
      decisao(2, { resultado: "aprovado", nota: 4 }),
    ],
    evidencias: [
      {
        demanda_id: id,
        ticket_id: 4,
        tipo: "pr_aberto",
        dados: { id: "7", url: "https://pr/7" },
        autor: { tipo: "fabriquinha" },
        em: INSTANTE_DO_CENARIO,
      },
      {
        demanda_id: id,
        ticket_id: 3,
        tipo: "comportamento",
        dados: { resumo: "ok" },
        autor: { tipo: "fabriquinha" },
        em: INSTANTE_DO_CENARIO,
      },
    ],
    pull_requests: [
      {
        rodada_id: 1,
        numero: 6,
        url: "https://pr/6",
        head: "abc",
        estado: "integrado",
        atualizado_em: INSTANTE_DO_CENARIO,
      },
      {
        rodada_id: 2,
        numero: 7,
        url: "https://pr/7",
        head: "abc",
        estado: "aberto",
        atualizado_em: INSTANTE_DO_CENARIO,
      },
    ],
  });
}

/** Cadastra o projeto `loja`, de que toda demanda de cenário depende. */
export function cadastrarProjetoLoja(banco: DatabaseSync, repo = "/repos/loja", branchBase = "main"): void {
  banco
    .prepare(
      `INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube)
       VALUES ('loja', ?, ?, 'github', 'k')`,
    )
    .run(repo, branchBase);
}

/** Abre (uma vez só) a execução do ticket e devolve o Agente dela: o `trabalho_id` é o `processo_do_trabalho.id`. */
export function abrirTrabalhoDoAgente(banco: DatabaseSync, ref: { demanda_id: string; ticket_id: number }): Ator {
  const trabalho_id = `e-${ref.demanda_id}-T${String(ref.ticket_id)}`;
  banco
    .prepare(
      "INSERT OR IGNORE INTO trabalho_agentico (id, demanda_id, ticket_id, modo, conversa_referencia) VALUES (?, ?, ?, 'autonomo', 'c')",
    )
    .run(`s-${trabalho_id}`, ref.demanda_id, ref.ticket_id);
  banco
    .prepare("INSERT OR IGNORE INTO processo_do_trabalho (id, trabalho_id, inicio, falha) VALUES (?, ?, ?, 0)")
    .run(trabalho_id, `s-${trabalho_id}`, INSTANTE_DO_CENARIO);
  return { tipo: "agente", trabalho_id };
}

/**
 * Grava o agregado pronto com o ID que ele traz e devolve-o. A produção só grava demanda com o ID da sequência; aqui a
 * sequência é posta no ID anterior durante a gravação e volta ao que era, para o próximo ID alocado não mudar.
 */
export function gravarAgregadoPronto(banco: DatabaseSync, agregado: AgregadoDemanda): AgregadoDemanda {
  const numero = Number(agregado.demanda.id.replace("I-", ""));
  const anterior = banco.prepare("SELECT valor FROM sequencia WHERE nome = 'demanda'").get() as
    { valor: number } | undefined;
  banco
    .prepare(
      "INSERT INTO sequencia (nome, valor) VALUES ('demanda', ?) ON CONFLICT (nome) DO UPDATE SET valor = excluded.valor",
    )
    .run(numero - 1);
  try {
    return criarDemandaNova(banco, () => ({
      ...agregado,
      pull_requests: (agregado as Partial<AgregadoDemanda>).pull_requests ?? [],
    })); // os cenários prontos não trazem PR
  } finally {
    if (anterior) banco.prepare("UPDATE sequencia SET valor = ? WHERE nome = 'demanda'").run(anterior.valor);
    else banco.exec("DELETE FROM sequencia WHERE nome = 'demanda'");
  }
}

export const REF_RODADA = { demanda_id: "I-1", ticket_id: 2 };
export const REF_GLOBAL = { demanda_id: "I-1", ticket_id: 3 };

// Os testes não precisam fechar o banco: o que sobrar é fechado ao fim do processo de teste, como os repositórios.
const bancosDeRevisaoAbertos = new Set<() => void>();
process.on("exit", () => {
  for (const fechar of bancosDeRevisaoAbertos) fechar();
});

/**
 * Git real temporário, banco real e um pi falso que só registra onde rodou, com o projeto `loja` e a demanda I-1 de
 * {@link agregadoEmRevisao} (`integral` como lá), a worktree da demanda já criada.
 */
export async function cenarioRevisao({ integral = false } = {}) {
  const c = criarRepositorioDeTeste();
  process.env.PI_CODING_AGENT_DIR = join(c.dir, "pi-agent");
  delete process.env.FABRIQUINHA_PORTA;
  const { banco, fechar } = abrirBancoTemporario(c.raiz);
  bancosDeRevisaoAbertos.add(fechar);
  cadastrarProjetoLoja(banco, c.repo, "integracao");
  gravarProjeto(
    banco,
    Projeto.parse({
      nome: "loja",
      branch_base: "integracao",
      chave_sonarqube: "k",
      raiz_git: c.repo,
      hospedagem: "github",
      etapas: [],
      verificacoes: {
        preparacao: ["true"],
        fitness: [{ nome: "f", comando: "true", descricao: "d" }],
        linguagens: [{ caminho: ".", linguagem: "ts", comando_teste: "true" }],
      },
    }),
  );
  gravarAgregadoPronto(banco, agregadoEmRevisao({ integral }));
  await garantirWorktreeDemanda(ambiente, c.raiz, c.projeto, "I-1", c.log);
  const piFalso = instalarPiFalso(c.dir);
  return {
    c,
    banco,
    piFalso,
    /** As pastas em que o pi falso rodou. */
    pastas: () =>
      piFalso
        .registro()
        .filter((entrada) => entrada.evento === "inicio")
        .map((entrada) => entrada.cwd),
  };
}
