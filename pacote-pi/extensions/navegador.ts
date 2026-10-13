// Extensão `navegador` do pacote P1 `pi-fabriquinha` (I-10, Simulação): dá ao pi olhos e mãos no produto. As
// ferramentas dirigem um Chromium headless aberto em `$FABRIQUINHA_LINK`; cada uma faz a ação e devolve o print e o
// endereço atual. `relatar` grava o `relatorio.json` em `$FABRIQUINHA_SAIDA`. O erro do Playwright (navegador ausente,
// página que não carrega) sobe como exceção: o pi o devolve ao modelo como erro da ferramenta. Não importa o pacote do pi.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";

type Parametros = Record<string, unknown>;
type Conteudo = { type: "image"; data: string; mimeType: string } | { type: "text"; text: string };

/** O pedaço da API de extensões do pi que a extensão usa. */
interface Pi {
  on(evento: "session_shutdown", tratador: () => Promise<void>): void;
  registerTool(ferramenta: {
    name: string;
    label: string;
    description: string;
    parameters: object;
    execute(id: string, parametros: Parametros): Promise<{ content: Conteudo[]; details: undefined }>;
  }): void;
}

const numero = { type: "number" } as const;
const texto = { type: "string" } as const;
const lista = { type: "array", items: texto } as const;
const objeto = (propriedades: Record<string, object>) => ({
  type: "object",
  properties: propriedades,
  required: Object.keys(propriedades),
});

export default function navegador(pi: Pi): void {
  let aberto: Promise<{ browser: Browser; page: Page }> | undefined;

  const abrir = () => {
    aberto ??= (async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
        await page.goto(String(process.env.FABRIQUINHA_LINK));
        return { browser, page };
      } catch (error_) {
        await browser.close();
        throw error_;
      }
    })();
    // Falha ao abrir não fica guardada: a próxima chamada tenta de novo.
    aberto.catch(() => (aberto = undefined));
    return aberto;
  };

  pi.on("session_shutdown", async () => {
    const atual = aberto;
    aberto = undefined;
    await (await atual)?.browser.close();
  });

  /** Registra a ferramenta que age na página e devolve o print e o endereço. */
  const agir = (
    name: string,
    description: string,
    props: Record<string, object>,
    acao: (p: Page, a: Parametros) => Promise<unknown>,
  ): void => {
    pi.registerTool({
      name,
      label: name,
      description,
      parameters: objeto(props),
      async execute(_id, parametros) {
        const { page } = await abrir();
        await acao(page, parametros);
        await page.waitForTimeout(300);
        const png = await page.screenshot({ type: "png" });
        return {
          content: [
            { type: "image", data: png.toString("base64"), mimeType: "image/png" },
            { type: "text", text: `Endereço atual: ${page.url()}` },
          ],
          details: undefined,
        };
      },
    });
  };

  agir("ver_tela", "Mostra a tela atual do produto.", {}, () => Promise.resolve());
  agir(
    "clicar",
    "Clica na coordenada (x, y) da tela, em pixels (a tela tem 1280×800).",
    { x: numero, y: numero },
    (page, a) => page.mouse.click(Number(a.x), Number(a.y)),
  );
  agir("digitar", "Digita o texto no campo em foco.", { texto }, (page, a) => page.keyboard.type(String(a.texto)));
  agir("tecla", "Aperta uma tecla, como Enter, Tab ou ArrowDown.", { tecla: texto }, (page, a) =>
    page.keyboard.press(String(a.tecla)),
  );
  agir("rolar", "Rola a página na vertical: dy positivo desce, negativo sobe, em pixels.", { dy: numero }, (page, a) =>
    page.mouse.wheel(0, Number(a.dy)),
  );

  pi.registerTool({
    name: "relatar",
    label: "relatar",
    description:
      "Entrega o relatório final: os problemas de usabilidade e os bugs encontrados. Chame uma vez, ao terminar.",
    parameters: objeto({ usabilidade: lista, bugs: lista }),
    async execute(_id, parametros) {
      const saida = String(process.env.FABRIQUINHA_SAIDA);
      await mkdir(saida, { recursive: true });
      const { usabilidade, bugs } = parametros;
      await writeFile(join(saida, "relatorio.json"), JSON.stringify({ usabilidade, bugs }, null, 2));
      return { content: [{ type: "text", text: "Relatório gravado." }], details: undefined };
    },
  });
}
