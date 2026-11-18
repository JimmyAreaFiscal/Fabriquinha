// As credenciais dos agentes nos containers do conjunto (CONCEITOS.md §7): só o host renova, e cada container recebe a
// cópia enxuta dele (`credenciaisParaOContainer`) quando é alocado, antes de cada comando e, de minuto em minuto, quando a
// do host muda. A Gestão de Ambientes chama a manutenção em segundo plano, então a renovação nunca segura o agendador.
import { createHash } from "node:crypto";
import { ErroExterno } from "../../../../shared/nucleo/erros.ts";
import type { Relogio } from "../../../../shared/nucleo/relogio.ts";
import {
  type AgenteComCredencial,
  comoEntrarNoHost,
  credenciaisParaOContainer,
  type HostDasCredenciais,
  renovarNoHost,
} from "../infra/credenciais_dos_agentes.ts";
import type { GeradorDeAmbientes } from "../infra/gerador_de_ambientes.ts";

/** Depois de uma renovação que falhou, quanto o host espera para tentar de novo o mesmo token. */
const ESPERA_DEPOIS_DA_FALHA_MS = 30 * 60_000;

type RenovarNoHost = (agente: AgenteComCredencial, provedor: string, host: HostDasCredenciais) => Promise<boolean>;

const resumoDoConteudo = (conteudo: string) => createHash("sha256").update(conteudo).digest("hex");

export class CredenciaisDosContainers {
  readonly #gerador: Pick<GeradorDeAmbientes, "gravarCredencial">;
  readonly #host: HostDasCredenciais;
  readonly #relogio: Relogio;
  readonly #renovarNoHost: RenovarNoHost;
  /** O resumo do que cada container recebeu, por caminho: só o que mudou no host é copiado de novo. */
  readonly #copiadoPorContainer = new Map<string, Map<string, string>>();
  /** Quando cada token (`<agente>/<provedor>`) cuja renovação falhou pode ser tentado de novo. */
  readonly #proximaTentativaPorToken = new Map<string, number>();
  /** Os tokens cuja falha de renovação já foi registrada: o mesmo token falhando de novo não enche o log. */
  readonly #falhasRegistradas = new Set<string>();

  constructor(
    gerador: Pick<GeradorDeAmbientes, "gravarCredencial">,
    host: HostDasCredenciais,
    relogio: Relogio,
    renovar: RenovarNoHost = renovarNoHost,
  ) {
    this.#gerador = gerador;
    this.#host = host;
    this.#relogio = relogio;
    this.#renovarNoHost = renovar;
  }

  get #agoraMs(): number {
    return Date.parse(this.#relogio.agora());
  }

  /** Grava no container a credencial do host que ele ainda não tem, ou que mudou desde a última cópia. */
  async levarAoContainer(containerId: string): Promise<void> {
    const resumoCopiadoPorCaminho = this.#copiadoPorContainer.get(containerId) ?? new Map<string, string>();
    this.#copiadoPorContainer.set(containerId, resumoCopiadoPorCaminho);
    for (const { caminho_no_home, conteudo } of credenciaisParaOContainer(this.#host.copias)) {
      const resumoDaCredencial = resumoDoConteudo(conteudo);
      if (resumoCopiadoPorCaminho.get(caminho_no_home) === resumoDaCredencial) continue;
      await this.#gerador.gravarCredencial(containerId, caminho_no_home, conteudo);
      resumoCopiadoPorCaminho.set(caminho_no_home, resumoDaCredencial);
    }
  }

  /**
   * Recusa, como falha de infraestrutura, o trabalho que pegaria uma credencial vencida no host: a do agente cujos tokens
   * todos já venceram. A mensagem nomeia o agente e o provedor, nunca o token.
   */
  exigirCredenciaisValidas(): void {
    const agora = this.#agoraMs;
    const vencidas = credenciaisParaOContainer(this.#host.copias).filter(
      ({ tokens }) => tokens.length > 0 && tokens.every(({ vence_em }) => vence_em <= agora),
    );
    if (vencidas.length === 0) return;
    throw new ErroExterno(
      `a credencial do ${vencidas.map(({ agente }) => agente).join(" e do ")} no host venceu`,
      `faça login no host (${[...new Set(vencidas.flatMap(({ agente, tokens }) => tokens.map(({ provedor }) => comoEntrarNoHost(agente, provedor))))].join("; ")}) e o trabalho volta a tentar`,
    );
  }

  /** Renova no host o que está para vencer e leva a credencial que mudou aos `containersAlocados`; as falhas vão a `registrarErro`. */
  async manter(containersAlocados: readonly string[], registrarErro: (erro: unknown) => void): Promise<void> {
    await this.#renovarNoHostOQueVence(registrarErro);
    for (const containerId of this.#copiadoPorContainer.keys())
      if (!containersAlocados.includes(containerId)) this.#copiadoPorContainer.delete(containerId);
    for (const containerId of containersAlocados) await this.levarAoContainer(containerId).catch(registrarErro);
  }

  async #renovarNoHostOQueVence(registrarErro: (erro: unknown) => void): Promise<void> {
    const agora = this.#agoraMs;
    for (const { agente, tokens } of credenciaisParaOContainer(this.#host.copias))
      for (const { provedor, renovar_em } of tokens) {
        const tokenDoAgente = `${agente}/${provedor}`;
        if (renovar_em > agora || (this.#proximaTentativaPorToken.get(tokenDoAgente) ?? 0) > agora) continue;
        if ((await this.#renovarNoHost(agente, provedor, this.#host)) && this.#foiRenovado(agente, provedor, agora)) {
          this.#proximaTentativaPorToken.delete(tokenDoAgente);
          this.#falhasRegistradas.delete(tokenDoAgente);
          continue;
        }
        this.#proximaTentativaPorToken.set(tokenDoAgente, agora + ESPERA_DEPOIS_DA_FALHA_MS);
        if (this.#falhasRegistradas.has(tokenDoAgente)) continue;
        this.#falhasRegistradas.add(tokenDoAgente);
        registrarErro(
          new ErroExterno(
            `a renovação da credencial do ${agente} (${provedor}) no host não a renovou`,
            `faça login no host (${comoEntrarNoHost(agente, provedor)}); a Fabriquinha tenta de novo em 30 min`,
          ),
        );
      }
  }

  /** Depois da renovação, o token do host já não está para vencer? */
  #foiRenovado(agente: AgenteComCredencial, provedor: string, agora: number): boolean {
    return credenciaisParaOContainer(this.#host.copias).some(
      (credencial) =>
        credencial.agente === agente &&
        credencial.tokens.some((token) => token.provedor === provedor && token.renovar_em > agora),
    );
  }
}
