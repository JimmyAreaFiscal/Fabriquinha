// Apoio de teste: `gh` e `az` falsos para a frente do PATH (F5 §9), importados pelos testes de PR. O nome termina em
// .test.ts para ficar fora da cobertura, como todo código de teste; o teste próprio confere o formato de cada CLI.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";

/** Um PR guardado pela hospedagem falsa, no vocabulário da Fabriquinha. */
export interface PRFalso {
  id: number;
  head: string;
  base: string;
  titulo: string;
  corpo: string;
  estado: "aberto" | "fechado" | "mergeado";
  /** A branch de origem vem de um fork. */
  fork?: boolean;
  /** Padrão: sem conflito. */
  conflito?: boolean | "calculando";
  /** Padrão: um check `ci` aprovado. */
  checks?: { nome: string; estado: "aprovado" | "falho" | "andamento" }[];
}

interface Estado {
  prs: PRFalso[];
  chamadas: { cli: string; args: string[]; cwd: string; token: string | null }[];
  /** Comando (`pr create`, `repos pr list`…) → stderr com que ele falha. */
  falha: Record<string, string>;
  /** Comando → stdout que ele imprime no lugar do de verdade. */
  saida: Record<string, string>;
}

/** O PR guardado como cada CLI o mostra; `az repos pr update` recusa PR fechado e a API REST do gh, não, como o PR real. */
const SCRIPT = `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
const cli = basename(process.argv[1]);
const args = process.argv.slice(2);
const arquivo = process.env.FALSO_HOSPEDAGEM;
const estado = JSON.parse(readFileSync(arquivo, "utf8"));
const salvar = () => writeFileSync(arquivo, JSON.stringify(estado));
estado.chamadas.push({ cli, args, cwd: process.cwd(), token: process.env.GH_TOKEN ?? null });
salvar();
const opcao = (nome) => args[args.indexOf(nome) + 1];
const comando = args.slice(0, cli === "gh" ? 2 : args.findIndex((a) => a.startsWith("--"))).join(" ");
if (estado.falha[comando] !== undefined) {
  process.stderr.write(estado.falha[comando]);
  process.exit(1);
}
if (estado.saida[comando] !== undefined) {
  process.stdout.write(estado.saida[comando]);
  process.exit(0);
}
const gh = (p) => ({
  number: p.id,
  url: "https://github.com/org/loja/pull/" + p.id,
  state: { aberto: "OPEN", fechado: "CLOSED", mergeado: "MERGED" }[p.estado],
  body: p.corpo,
  baseRefName: p.base,
  isCrossRepository: p.fork === true,
});
const az = (p) => ({
  pullRequestId: p.id,
  status: { aberto: "active", fechado: "abandoned", mergeado: "completed" }[p.estado],
  description: p.corpo === "" ? null : p.corpo,
  targetRefName: "refs/heads/" + p.base,
  // Como o az real: os campos sem valor vêm como null, não ausentes.
  forkSource: p.fork ? { name: "refs/heads/" + p.head } : null,
  closedDate: p.estado === "aberto" ? null : "2026-10-11T13:00:00.1234567Z",
  mergeStatus: { true: "conflicts", false: "succeeded", calculando: "queued" }[String(conflito(p))],
  url: "https://dev.azure.com/org/_apis/git/pullRequests/" + p.id,
  repository: { webUrl: "https://dev.azure.com/org/loja/_git/loja" },
});
const conflito = (p) => p.conflito ?? false;
const checks = (p) => p.checks ?? [{ nome: "ci", estado: "aprovado" }];
// O rollup do gh: CheckRun para os checks de nome com "/" e StatusContext para os demais.
const rollup = (p) =>
  checks(p).map((c) =>
    c.nome.includes("/")
      ? { __typename: "StatusContext", context: c.nome, state: { aprovado: "SUCCESS", falho: "FAILURE", andamento: "PENDING" }[c.estado], targetUrl: "https://ci.exemplo.com/" + c.nome }
      : {
          __typename: "CheckRun",
          name: c.nome,
          status: c.estado === "andamento" ? "IN_PROGRESS" : "COMPLETED",
          conclusion: { aprovado: "SUCCESS", falho: "FAILURE", andamento: "" }[c.estado],
          detailsUrl: "https://ci.exemplo.com/" + c.nome,
        },
  );
// As políticas do az: as de CI (Build) com o nome e as que a Fabriquinha ignora (revisores, build que não se aplica).
const politicas = (p) => [
  { status: "rejected", configuration: { type: { displayName: "Minimum number of reviewers" }, settings: {} } },
  { status: "notApplicable", configuration: { type: { displayName: "Build" }, settings: { displayName: "so-na-main" } } },
  ...checks(p).map((c) => ({
    status: { aprovado: "approved", falho: "rejected", andamento: "running" }[c.estado],
    configuration: { type: { displayName: "Build" }, settings: { displayName: c.nome } },
  })),
];
const pr = (id) => estado.prs.find((p) => p.id === Number(id));
/** Quando o PR mergeado foi mergeado, como o gh o mostra. */
const MERGE = "2026-10-11T13:00:00Z";
const novo = (head, base, titulo, corpo) => {
  const p = { id: estado.prs.length + 1, head, base, titulo, corpo, estado: "aberto" };
  estado.prs.push(p);
  return p;
};
const editar = (p, titulo, corpo) => {
  if (cli === "az" && p.estado === "fechado") {
    process.stderr.write("o PR está fechado");
    process.exit(1);
  }
  Object.assign(p, { titulo, corpo });
};
let resposta;
switch (comando) {
  case "pr list":
    resposta = JSON.stringify(estado.prs.filter((p) => p.head === opcao("--head")).map(gh));
    break;
  case "pr create":
    resposta = gh(novo(opcao("--head"), opcao("--base"), opcao("--title"), readFileSync(opcao("--body-file"), "utf8"))).url;
    break;
  case "api repos/{owner}/{repo}/pulls/" + args[1].split("/").at(-1):
    // Só a edição do PR: gh api repos/{owner}/{repo}/pulls/<id> --method PATCH -f title=… -F body=@arquivo.
    if (opcao("--method") !== "PATCH") {
      process.stderr.write("chamada desconhecida: " + args.join(" "));
      process.exit(2);
    }
    editar(pr(args[1].split("/").at(-1)), opcao("-f").slice("title=".length), readFileSync(opcao("-F").slice("body=@".length), "utf8"));
    resposta = "";
    break;
  case "pr view":
    resposta = JSON.stringify({
      state: gh(pr(args[2])).state,
      url: gh(pr(args[2])).url,
      mergedAt: pr(args[2]).estado === "mergeado" ? MERGE : null,
      mergeCommit: pr(args[2]).estado === "mergeado" ? { oid: "abc" } : null,
      mergeable: { true: "CONFLICTING", false: "MERGEABLE", calculando: "UNKNOWN" }[String(conflito(pr(args[2])))],
      statusCheckRollup: rollup(pr(args[2])),
    });
    break;
  case "pr reopen":
    pr(args[2]).estado = "aberto";
    resposta = "";
    break;
  case "repos pr list":
    resposta = JSON.stringify(estado.prs.filter((p) => p.head === opcao("--source-branch")).map(az));
    break;
  case "repos pr create":
    resposta = JSON.stringify(
      az(novo(opcao("--source-branch"), opcao("--target-branch"), opcao("--title"), opcao("--description"))),
    );
    break;
  case "repos pr show":
    resposta = JSON.stringify(az(pr(opcao("--id"))));
    break;
  case "repos pr policy list":
    resposta = JSON.stringify(politicas(pr(opcao("--id"))));
    break;
  case "repos pr update":
    if (opcao("--status") === "active") pr(opcao("--id")).estado = "aberto";
    else editar(pr(opcao("--id")), opcao("--title"), opcao("--description"));
    resposta = JSON.stringify(az(pr(opcao("--id"))));
    break;
  default:
    process.stderr.write("comando desconhecido: " + comando);
    process.exit(2);
}
salvar();
console.log(resposta);
`;

/** Instala `gh` e `az` falsos em `<dir>/bin`, na frente do PATH, com o estado em `<dir>/hospedagem.json`. */
export function hospedagemFalsa(dir: string) {
  const bin = join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  for (const cli of ["gh", "az"]) {
    writeFileSync(join(bin, cli), SCRIPT);
    chmodSync(join(bin, cli), 0o755);
  }
  const arquivo = join(dir, "hospedagem.json");
  const ler = (): Estado => JSON.parse(readFileSync(arquivo, "utf8")) as Estado;
  const gravar = (estado: Estado) => {
    writeFileSync(arquivo, JSON.stringify(estado));
  };
  if (!process.env.PATH?.startsWith(bin)) process.env.PATH = `${bin}${delimiter}${String(process.env.PATH)}`;
  return {
    /** Esvazia a hospedagem e passa a usá-la: o arquivo de estado vem pelo ambiente, que o CLI herda. */
    zerar() {
      process.env.FALSO_HOSPEDAGEM = arquivo;
      gravar({ prs: [], chamadas: [], falha: {}, saida: {} });
    },
    prs: () => ler().prs,
    chamadas: () => ler().chamadas,
    /** Acrescenta um PR, como se alguém o tivesse aberto na plataforma. */
    abrir(pr: Omit<PRFalso, "id">) {
      const estado = ler();
      estado.prs.push({ ...pr, id: estado.prs.length + 1 });
      gravar(estado);
    },
    mudar(id: number, mudanca: Partial<PRFalso>) {
      const estado = ler();
      Object.assign(estado.prs[id - 1] ?? {}, mudanca);
      gravar(estado);
    },
    falhar(comando: string, stderr: string) {
      const estado = ler();
      estado.falha[comando] = stderr;
      gravar(estado);
    },
    responder(comando: string, stdout: string) {
      const estado = ler();
      estado.saida[comando] = stdout;
      gravar(estado);
    },
  };
}

// Só quando o runner roda este arquivo: importado por outro teste, ele não repete o teste lá.
if (import.meta.main) {
  test("gh e az falsos: o mesmo PR no formato de cada CLI, e PR fechado não é editado", () => {
    const dir = mkdtempSync(join(tmpdir(), "fabriquinha-hospedagem-"));
    try {
      const h = hospedagemFalsa(dir);
      h.zerar();
      h.abrir({ head: "b", base: "main", titulo: "t", corpo: "", estado: "fechado", fork: true });
      const rodar = (cli: string, ...args: string[]) => execFileSync(cli, args, { stdio: "pipe" }).toString();
      assert.deepEqual(JSON.parse(rodar("gh", "pr", "list", "--head", "b")), [
        {
          number: 1,
          url: "https://github.com/org/loja/pull/1",
          state: "CLOSED",
          body: "",
          baseRefName: "main",
          isCrossRepository: true,
        },
      ]);
      assert.deepEqual(JSON.parse(rodar("az", "repos", "pr", "list", "--source-branch", "b")), [
        {
          pullRequestId: 1,
          status: "abandoned",
          description: null,
          targetRefName: "refs/heads/main",
          forkSource: { name: "refs/heads/b" },
          closedDate: "2026-10-11T13:00:00.1234567Z",
          mergeStatus: "succeeded",
          url: "https://dev.azure.com/org/_apis/git/pullRequests/1",
          repository: { webUrl: "https://dev.azure.com/org/loja/_git/loja" },
        },
      ]);
      assert.throws(() => rodar("az", "repos", "pr", "update", "--id", "1", "--title", "x", "--description", "y"));
      assert.deepEqual(
        h.chamadas().map((c) => c.cli),
        ["gh", "az", "az"],
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
