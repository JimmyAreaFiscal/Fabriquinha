// Ambiente do estresse: uma Fabriquinha numa raiz temporária, na porta livre que ela mesma escolhe (FABRIQUINHA_PORTA=0,
// nunca a 4317), com o pi falso do e2e ($FABRIQUINHA_PI) e o agendador desligado (o padrão de uma raiz nova). Nada toca
// em ~/fabriquinha. Subida como a de e2e/apoio.ts, git isolado como o de integracao/apoio.ts.
import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as dormir } from "node:timers/promises";

export interface Ambiente {
  /** A raiz temporária: banco, `web.url`, sessões e execuções. */
  raiz: string;
  /** `http://127.0.0.1:<porta>`. */
  base: string;
  /** Cabeçalho `Cookie` da sessão autenticada, para as chamadas de dado. */
  cookie: string;
  /** Para o serviço, apaga a raiz e devolve o stderr que ele escreveu. */
  encerrar(): Promise<string>;
}

/** Para o serviço com SIGTERM; se não sair em 5 s, SIGKILL. */
async function parar(servico: ChildProcess): Promise<void> {
  if (servico.exitCode !== null) return;
  const saiu = once(servico, "exit");
  servico.kill("SIGTERM");
  if (await Promise.race([saiu.then(() => true), dormir(5000).then(() => false)])) return;
  servico.kill("SIGKILL");
  await saiu;
}

/** Sobe a Fabriquinha numa raiz nova e entra por `/entrar?token=`, guardando o cookie. */
export async function subirAmbiente(): Promise<Ambiente> {
  const raiz = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-estresse-")));
  // git e pi sem a configuração do usuário da máquina.
  const gitconfig = join(raiz, "gitconfig");
  writeFileSync(gitconfig, "[user]\n\tname = Estresse\n\temail = estresse@exemplo.com\n");
  // gh falso, autenticado: nada sai para a rede.
  const bin = join(raiz, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "gh"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(bin, "gh"), 0o755);

  let log = "";
  const servico = spawn(
    process.execPath,
    ["--disable-warning=ExperimentalWarning", join(import.meta.dirname, "../src/cli/fabriquinha.ts"), "servidor"],
    {
      env: {
        ...process.env,
        FABRIQUINHA_EXECUCAO: "",
        SONAR_HOST_URL: "",
        FABRIQUINHA_ROOT: raiz,
        FABRIQUINHA_PORTA: "0",
        FABRIQUINHA_PI: join(import.meta.dirname, "../e2e/pi-falso.ts"),
        PI_CODING_AGENT_DIR: join(raiz, "pi-agent"),
        GIT_CONFIG_GLOBAL: gitconfig,
        GIT_CONFIG_NOSYSTEM: "1",
        PATH: `${bin}:${process.env.PATH ?? ""}`,
      },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  servico.stderr.on("data", (parte: Buffer) => {
    log += parte.toString();
  });
  const encerrar = async (): Promise<string> => {
    await parar(servico);
    rmSync(raiz, { recursive: true, force: true });
    return log;
  };

  try {
    // O `web.url` nasce inteiro (escrito ao lado e renomeado): existir basta.
    const arquivo = join(raiz, "web.url");
    for (let i = 0; !existsSync(arquivo); i++) {
      if (servico.exitCode !== null || i > 200) throw new Error(`a Fabriquinha não subiu:\n${log}`);
      await dormir(50);
    }
    const link = readFileSync(arquivo, "utf8");
    const entrada = await fetch(link, { redirect: "manual" });
    const cookie = entrada.headers.getSetCookie()[0]?.split(";")[0];
    if (!cookie) throw new Error(`a entrada não devolveu o cookie (HTTP ${String(entrada.status)})`);
    return { raiz, base: new URL(link).origin, cookie, encerrar };
  } catch (erro) {
    await encerrar();
    throw erro;
  }
}
