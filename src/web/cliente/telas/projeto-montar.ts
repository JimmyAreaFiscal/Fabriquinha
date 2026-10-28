// Página do projeto (F7 §4.4) no DOM: escolhe o projeto, lê o mês corrente dele e desenha com as funções puras de
// projeto.ts. Os testes de ponta a ponta (e2e/) a exercitam.
import type { MetricasMesDemanda } from "../../../metricas/periodo_demanda.ts";
import type { Parametros } from "../caminhos.ts";
import { api, irPara } from "../dom.ts";
import type { ProjetoListado } from "./configuracao.ts";
import { mesDe } from "./metricas.ts";
import { caminhoDoProjeto, escolherProjeto, paginaDoProjeto, projetoNaoEncontrado, SEM_PROJETOS } from "./projeto.ts";

/** O último projeto visto neste navegador (F7 §4.4). */
const CHAVE = "fabriquinha.projeto";

// O armazenamento do navegador pode faltar (bloqueado, modo privado): a página segue sem lembrar.
export function ultimoVisto(): string | undefined {
  try {
    return localStorage.getItem(CHAVE) ?? undefined;
  } catch {
    return undefined;
  }
}
export function lembrar(nome: string): void {
  try {
    localStorage.setItem(CHAVE, nome);
  } catch {
    // sem armazenamento, sem lembrança
  }
}

/** A página `/projects` e `/projects/:projeto`. */
export async function montarProjeto(main: HTMLElement, params: Parametros, signal: AbortSignal): Promise<void> {
  const projetos = await api<ProjetoListado[]>("/api/projetos", { signal });
  const nome = params.projeto ?? escolherProjeto(projetos, ultimoVisto());
  if (nome === undefined) {
    main.innerHTML = SEM_PROJETOS;
    return;
  }
  if (params.projeto === undefined) history.replaceState(null, "", caminhoDoProjeto(nome));
  if (!projetos.some((p) => p.nome === nome)) {
    main.innerHTML = projetoNaoEncontrado(nome);
    return;
  }
  lembrar(nome);
  const atual = mesDe(new Date());
  const [mes] = await api<[MetricasMesDemanda]>(
    `/api/metricas?projeto=${encodeURIComponent(nome)}&de=${atual}&ate=${atual}`,
    { signal },
  );
  main.innerHTML = paginaDoProjeto(projetos, nome, mes);
  main.querySelector<HTMLSelectElement>("[data-projeto]")?.addEventListener("change", (evento) => {
    const seletor = evento.currentTarget as HTMLSelectElement;
    // Sem o foco, que seguraria o desenho da página do projeto escolhido.
    seletor.blur();
    irPara(caminhoDoProjeto(seletor.value));
  });
}
