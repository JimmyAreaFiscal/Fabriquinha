// Agregados de demanda prontos em cada estado do Ciclo de Vida, para os testes que partem de uma demanda já avançada.
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { AgregadoDemanda } from "../src/nucleo/agregado_demanda.ts";
import type { FaseDemanda } from "../src/nucleo/primitivos.ts";
import { gravarConfiguracaoProjeto, substituirPreparacaoDoProjeto } from "../src/armazenamento/configuracao_projeto.ts";
import { criarDemandaNova } from "../src/armazenamento/demandas.ts";
import { garantirWorktreeDemanda } from "../src/infra/repositorio/worktree-demanda.ts";
import { abrirBancoTemporario } from "./banco_temporario.ts";
import { instalarPiFalso } from "./pi_falso.ts";
import { criarRepositorioDeTeste } from "./repositorio_de_teste.ts";

export const INSTANTE_DO_CENARIO = "2026-01-01T00:00:00.000Z";

/** O ticket aberto da `etapa`; `extra` sobrescreve qualquer campo. */
export const montarTicket = (demanda_id: string, ticket_id: number, etapa: string, extra: object = {}) => ({
  demanda_id,
  ticket_id,
  etapa,
  status: "aberto",
  status_alterado_em: INSTANTE_DO_CENARIO,
  criado_por: { tipo: "fabriquinha" },
  devolucoes: 0,
  ...extra,
});

export const montarRodada = (demanda_id: string, rodada_id: number, fase: string) => ({
  demanda_id,
  rodada_id,
  titulo: `rodada ${String(rodada_id)}`,
  fase,
  e2e: false,
  branch: `fabriquinha/${demanda_id}-${String(rodada_id)}`,
});

/** Uma demanda `fase` do projeto `loja`, sem rodadas nem tickets além dos de `resto`. */
export const montarAgregadoDemanda = (id: string, fase: string, resto: object = {}): AgregadoDemanda =>
  ({
    demanda: {
      id,
      projeto: "loja",
      titulo: `demanda ${id}`,
      tipo: "funcionalidade",
      descricao: "d",
      fase,
      fase_alterada_em: INSTANTE_DO_CENARIO,
      criada_por: { tipo: "externo", ferramenta: "claude", sessao: id },
      enviada: fase !== "registro",
      branch: `fabriquinha/${id}`,
    },
    tickets: [],
    decisoes: [],
    evidencias: [],
    rodadas: [],
    dependencias_rodada: [],
    criterios_citados: [],
    dependencias_ticket: [],
    caminhos_ticket: [],
    ...resto,
  }) as unknown as AgregadoDemanda;

const concluido = { status: "concluido" };

/**
 * A demanda `id` como o Ciclo de Vida a deixa em `fase`: T1 `demanda`, T2 `planejar`, T3 `implementar` da R1, T4
 * `revisar_demanda` e T5 `encerrar_demanda`, cada um aberto na sua fase e concluído nas seguintes; a R1 nasce em
 * `desenvolvimento` e fica `concluida` quando a revisão da demanda começa. Cancelada, tem o T5 cancelado.
 */
export function agregadoNaFase(id: string, fase: FaseDemanda): AgregadoDemanda {
  const indice = (f: FaseDemanda) => FASES_DO_CICLO.indexOf(f);
  const adiante = (limite: FaseDemanda) => indice(fase) > indice(limite);
  const tickets = [
    montarTicket(id, 1, "demanda", fase === "registro" ? { status: "em_execucao" } : concluido),
    ...(indice(fase) >= indice("planejamento")
      ? [montarTicket(id, 2, "planejar", adiante("planejamento") ? concluido : {})]
      : []),
    ...(indice(fase) >= indice("execucao")
      ? [montarTicket(id, 3, "implementar", { rodada_id: 1, ...(adiante("execucao") && concluido) })]
      : []),
    ...(indice(fase) >= indice("revisao_demanda")
      ? [montarTicket(id, 4, "revisar_demanda", adiante("revisao_demanda") ? concluido : {})]
      : []),
    ...(indice(fase) >= indice("encerramento")
      ? [
          montarTicket(
            id,
            5,
            "encerrar_demanda",
            fase === "cancelada" ? { status: "cancelado" } : adiante("encerramento") ? concluido : {},
          ),
        ]
      : []),
  ];
  const rodadas =
    indice(fase) >= indice("execucao")
      ? [montarRodada(id, 1, adiante("execucao") ? "concluida" : "desenvolvimento")]
      : [];
  return montarAgregadoDemanda(id, fase, { tickets, rodadas });
}

// A ordem do Ciclo de Vida; as fases terminais vêm por último, na ordem em que se alcançam a partir do encerramento.
const FASES_DO_CICLO: readonly FaseDemanda[] = [
  "registro",
  "aprovacao_demanda",
  "planejamento",
  "aprovacao_planejamento",
  "execucao",
  "revisao_demanda",
  "encerramento",
  "concluida",
  "arquivada",
  "cancelada",
];

/**
 * I-1 em execução, como a revisão a encontra: R1 em `revisao` (implementar T1 concluído, revisar_rodada T2 aberto) e
 * o revisar_demanda T3 aberto. Com `integral`: em `revisao_demanda`, R1 concluída e o T2 concluído.
 */
export function agregadoEmRevisao({ integral = false } = {}): AgregadoDemanda {
  return montarAgregadoDemanda("I-1", integral ? "revisao_demanda" : "execucao", {
    rodadas: [montarRodada("I-1", 1, integral ? "concluida" : "revisao")],
    tickets: [
      montarTicket("I-1", 1, "implementar", { rodada_id: 1, ...concluido }),
      montarTicket("I-1", 2, "revisar_rodada", { rodada_id: 1, ...(integral && concluido) }),
      montarTicket("I-1", 3, "revisar_demanda"),
    ],
  });
}

/**
 * Em execução com a R1 concluída (T1, T2) e a R2 com o PR 7 aberto (T3 em execução, T4 encerrar_rodada concluído), o
 * T5 de planejamento concluído com uma decisão recusada e outra aprovada do Auditor, e a evidência `comportamento` do T3.
 */
export function agregadoComPullRequestAberto(id: string): AgregadoDemanda {
  const decisao = (decisao_id: number, resto: object) => ({
    demanda_id: id,
    ticket_id: 5,
    decisao_id,
    por: { tipo: "auditor" },
    em: INSTANTE_DO_CENARIO,
    ...resto,
  });
  return montarAgregadoDemanda(id, "execucao", {
    rodadas: [montarRodada(id, 1, "concluida"), montarRodada(id, 2, "aprovacao_pull_request")],
    tickets: [
      montarTicket(id, 1, "implementar", { rodada_id: 1, ...concluido }),
      montarTicket(id, 2, "encerrar_rodada", { rodada_id: 1, ...concluido }),
      montarTicket(id, 3, "implementar", { rodada_id: 2, status: "em_execucao", titulo: "implementa" }),
      montarTicket(id, 4, "encerrar_rodada", { rodada_id: 2, ...concluido }),
      montarTicket(id, 5, "planejar", concluido),
    ],
    decisoes: [decisao(1, { resultado: "recusado", motivo: "refaça" }), decisao(2, { resultado: "aprovado", nota: 4 })],
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
  });
}

/** Cadastra o projeto `loja`, de que toda demanda de cenário depende. */
export function cadastrarProjetoLoja(banco: DatabaseSync, repo = "/repos/loja", branchBase = "main"): void {
  banco
    .prepare(
      `INSERT INTO projeto (nome, repo, branch_base, hospedagem, sonar_project_key)
       VALUES ('loja', ?, ?, 'github', 'k')`,
    )
    .run(repo, branchBase);
}

/**
 * Grava o agregado pronto com o ID que ele traz e devolve-o. A produção só grava demanda com o ID da sequência; aqui a
 * sequência é posta no ID anterior durante a gravação e volta ao que era, para o próximo ID alocado não mudar.
 */
export function gravarAgregadoPronto(banco: DatabaseSync, agregado: AgregadoDemanda): AgregadoDemanda {
  const numero = Number(agregado.demanda.id.replace("I-", ""));
  const anterior = banco.prepare("SELECT valor FROM sequencia WHERE nome = 'issue'").get() as
    { valor: number } | undefined;
  banco
    .prepare(
      "INSERT INTO sequencia (nome, valor) VALUES ('issue', ?) ON CONFLICT (nome) DO UPDATE SET valor = excluded.valor",
    )
    .run(numero - 1);
  try {
    return criarDemandaNova(banco, () => agregado);
  } finally {
    if (anterior) banco.prepare("UPDATE sequencia SET valor = ? WHERE nome = 'issue'").run(anterior.valor);
    else banco.exec("DELETE FROM sequencia WHERE nome = 'issue'");
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
  gravarConfiguracaoProjeto(banco, {
    nome: "loja",
    branch_base: "integracao",
    chave_sonarqube: "k",
    raiz_git: c.repo,
    hospedagem: "github",
    etapas: [],
    fitness: [{ nome: "f", comando: "true", descricao: "d" }],
    linguagens: [{ caminho: ".", linguagem: "ts", comando_teste: "true" }],
  });
  substituirPreparacaoDoProjeto(banco, "loja", ["true"]);
  gravarAgregadoPronto(banco, agregadoEmRevisao({ integral }));
  await garantirWorktreeDemanda(c.raiz, c.projeto, "I-1", c.log, () => Promise.resolve());
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
