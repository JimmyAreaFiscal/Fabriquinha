// O motor das fitness de fronteira: classifica cada arquivo de src/, julga cada import pela matriz das camadas e do
// servidor e pelas regras dos domínios (MELHORIAS §3 e §4) e acha o SQL que toca tabela fora do armazenamento do dono (§5.1).
// As regras de cada domínio ficam em fitness/fronteiras/dominios/<domínio>.ts; este arquivo não cita domínio.
//
// Toda pasta de src/modulos/ é um domínio declarado em dominios/, organizado como o §3 manda. Não há exceção nem
// dependência tolerada: a violação reprova. Quem cria um subdomínio ou uma dependência entre domínios a declara no
// arquivo do domínio (`subdominios`, `dependeDe`), e as declarações também não podem fechar ciclo.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";

export interface RegraDoModulo {
  modulosPermitidos: string[];
  externoPermitido: (alvo: string) => boolean;
  /** Módulos de que só se importa tipo (`import type`), apagado na execução; o valor fica fora de `modulosPermitidos`. */
  modulosSoComoTipo?: string[];
}

// Pacote npm ou node:* de fora de src/ não é dependência entre módulos; só o núcleo e o cliente web restringem o externo.
export const QUALQUER_EXTERNO = (): boolean => true;
export const SO_NODE_SEM_SQLITE = (alvo: string): boolean => alvo.startsWith("node:") && alvo !== "node:sqlite";
export const SO_ZOD_E_PATH = (alvo: string): boolean => alvo === "zod" || alvo === "node:path";

/** O módulo da matriz que representa a fachada (`src/modulos/<domínio>/publico.ts`) de um domínio. */
export const MODULO_DAS_FACHADAS = "fachada";
const MODULO_COM_SQL = "armazenamento";
const CAMADAS_DO_SUBDOMINIO = new Set(["nucleo", "aplicacao", "armazenamento", "infra"]);
const ARQUIVO_DA_API = "publico.ts";
const DOMINIO_DO_SERVIDOR = "server";
const DOMINIO_SHARED = "shared";

export interface Achado {
  arquivo: string;
  import: string;
}

export interface RegrasDoDominio {
  /** Os domínios cuja fachada este domínio pode importar (MELHORIAS §2). */
  dependeDe: string[];
  /** Cada subdomínio (pasta em src/modulos/<domínio>/) e os subdomínios irmãos cuja API ele pode importar. */
  subdominios: Record<string, string[]>;
  /** A fitness do processo do host: quem fala com o host fora do Ambiente. */
  processoDoHost: {
    /** Pastas inteiras liberadas (o próprio Ambiente). */
    pastasLiberadas: string[];
    /** Arquivos que importam `node:child_process`. */
    importamChildProcess: string[];
    /** Arquivos que importam `infra/processo.ts`, cada um por um motivo (gh, git com credenciais, pdftotext...). */
    chamadoresDiretos: string[];
  };
}

export interface Arquitetura {
  /** A regra de cada módulo: as camadas, as partes do servidor e a fachada. */
  matriz: Record<string, RegraDoModulo>;
  /** O módulo da matriz de um arquivo de src/server/, pelo caminho dentro de server/. */
  moduloDoArquivoDoServidor: (caminhoEmServer: string) => string;
  /** O módulo da matriz de um arquivo de src/shared/, pelo caminho dentro de shared/. */
  moduloDoArquivoDoShared: (caminhoEmShared: string) => string;
  /** As regras de cada domínio, pelo nome da pasta: os de src/modulos/, `server` e `shared`. */
  dominios: Record<string, RegrasDoDominio>;
}

interface LugarDoArquivo {
  /** O domínio: um de src/modulos/ declarado, `server` ou `shared`; `undefined` fora da organização. */
  dominio?: string;
  /** O subdomínio, nos domínios de src/modulos/; `undefined` na fachada. */
  subdominio?: string;
  /** A chave da matriz para o que o arquivo importa; `undefined` na fachada e na API do subdomínio, sem matriz. */
  moduloDoImportador?: string;
  /** A chave da matriz para quem importa o arquivo; `undefined` na API do subdomínio, que só a regra do domínio julga. */
  moduloDoAlvo?: string;
  ehFachada: boolean;
  ehApiDoSubdominio: boolean;
  /** Por que o arquivo de src/modulos/ está fora da organização do §3. */
  foraDaOrganizacao?: string;
}

const ehDominioDeModulos = (dominio: string): boolean => dominio !== DOMINIO_DO_SERVIDOR && dominio !== DOMINIO_SHARED;

function lugarNoDominio(dominio: string, regras: RegrasDoDominio, caminhoNoDominio: string[]): LugarDoArquivo {
  const [subdominio, pastaOuArquivo, ...resto] = caminhoNoDominio;
  const semMatriz = { dominio, ehFachada: false, ehApiDoSubdominio: false };
  if (subdominio === ARQUIVO_DA_API && pastaOuArquivo === undefined)
    return { dominio, moduloDoAlvo: MODULO_DAS_FACHADAS, ehFachada: true, ehApiDoSubdominio: false };
  if (subdominio === undefined || pastaOuArquivo === undefined)
    return { ...semMatriz, foraDaOrganizacao: `na raiz do domínio só fica o ${ARQUIVO_DA_API}` };
  if (!(subdominio in regras.subdominios))
    return { ...semMatriz, foraDaOrganizacao: `subdomínio ${subdominio} não declarado nas regras de ${dominio}` };
  if (pastaOuArquivo === ARQUIVO_DA_API && resto.length === 0)
    return { ...semMatriz, subdominio, ehApiDoSubdominio: true };
  if (CAMADAS_DO_SUBDOMINIO.has(pastaOuArquivo) && resto.length > 0)
    return { ...semMatriz, subdominio, moduloDoImportador: pastaOuArquivo, moduloDoAlvo: pastaOuArquivo };
  return { ...semMatriz, subdominio, foraDaOrganizacao: "fora das camadas nucleo, aplicacao, armazenamento e infra" };
}

function lugarDoArquivo(caminhoRelativoASrc: string, arquitetura: Arquitetura): LugarDoArquivo {
  const [grupo, primeiro, ...resto] = caminhoRelativoASrc.split("/");
  const caminhoNoGrupo = [primeiro, ...resto].join("/");
  const naMatriz = (modulo: string) => ({ moduloDoImportador: modulo, moduloDoAlvo: modulo });
  const semPapel = { ehFachada: false, ehApiDoSubdominio: false };
  if (grupo === DOMINIO_SHARED)
    return { dominio: DOMINIO_SHARED, ...naMatriz(arquitetura.moduloDoArquivoDoShared(caminhoNoGrupo)), ...semPapel };
  if (grupo === DOMINIO_DO_SERVIDOR)
    return {
      dominio: DOMINIO_DO_SERVIDOR,
      ...naMatriz(arquitetura.moduloDoArquivoDoServidor(caminhoNoGrupo)),
      ...semPapel,
    };
  if (grupo !== "modulos" || primeiro === undefined) return { ...naMatriz(""), ...semPapel };
  const regras = arquitetura.dominios[primeiro];
  if (regras && ehDominioDeModulos(primeiro)) return lugarNoDominio(primeiro, regras, resto);
  return { ...semPapel, foraDaOrganizacao: `domínio ${primeiro} não declarado em fitness/fronteiras/dominios/` };
}

/** O módulo da matriz de um arquivo de src/, pelo caminho relativo a src/ (o que ele pode importar). */
export const moduloDoArquivo = (caminhoRelativoASrc: string, arquitetura: Arquitetura): string | undefined =>
  lugarDoArquivo(caminhoRelativoASrc, arquitetura).moduloDoImportador;

const ehDominioDeModulosNoLugar = (lugar: LugarDoArquivo): lugar is LugarDoArquivo & { dominio: string } =>
  lugar.dominio !== undefined && ehDominioDeModulos(lugar.dominio);

const PERMITIDO_PELO_DESTINO = Symbol("permitido pelas regras dos domínios");

/**
 * A regra dos domínios para um import entre arquivos de src/: o motivo da violação, `PERMITIDO_PELO_DESTINO` quando a
 * regra libera (a matriz ainda julga as camadas) ou `undefined` quando não tem o que dizer (só a matriz julga).
 * O import de tipo não tem exceção: importar um tipo de pasta interna também é violação (§3.3).
 */
function julgarPelasRegrasDeDestino(
  de: LugarDoArquivo,
  para: LugarDoArquivo,
  arquitetura: Arquitetura,
): string | typeof PERMITIDO_PELO_DESTINO | undefined {
  if (de.dominio === DOMINIO_SHARED)
    return para.dominio === DOMINIO_SHARED ? undefined : "o shared não importa domínio nem o servidor";
  if (para.dominio === DOMINIO_SHARED) return PERMITIDO_PELO_DESTINO;
  const regrasDoImportador = de.dominio === undefined ? undefined : arquitetura.dominios[de.dominio];
  if (ehDominioDeModulosNoLugar(para) && para.dominio !== de.dominio) {
    if (!para.ehFachada) return `de fora do domínio ${para.dominio}, só pela fachada ${ARQUIVO_DA_API}`;
    if (regrasDoImportador && !regrasDoImportador.dependeDe.includes(para.dominio))
      return `o domínio ${String(de.dominio)} não depende de ${para.dominio}`;
    return PERMITIDO_PELO_DESTINO;
  }
  if (!ehDominioDeModulosNoLugar(de) || !regrasDoImportador) return undefined;
  if (para.dominio === DOMINIO_DO_SERVIDOR) return "um domínio não importa src/server/";
  if (para.dominio !== de.dominio) return "um domínio não importa arquivo fora da organização";
  if (para.ehFachada) return `dentro do domínio, use a API do subdomínio, não a fachada`;
  if (de.ehFachada)
    return para.ehApiDoSubdominio ? PERMITIDO_PELO_DESTINO : `a fachada importa só o ${ARQUIVO_DA_API} dos subdomínios`;
  if (de.subdominio === para.subdominio) return undefined;
  if (!para.ehApiDoSubdominio) return `entre subdomínios, só pelo ${ARQUIVO_DA_API} do subdomínio`;
  const dependenciasDeclaradas =
    de.subdominio === undefined ? [] : (regrasDoImportador.subdominios[de.subdominio] ?? []);
  if (para.subdominio === undefined || !dependenciasDeclaradas.includes(para.subdominio))
    return `o subdomínio ${String(de.subdominio)} não depende de ${String(para.subdominio)}`;
  return PERMITIDO_PELO_DESTINO;
}

export function listarArquivosDeProducao(src: string): string[] {
  return readdirSync(src, { recursive: true, encoding: "utf8" })
    .filter((arquivo) => /\.tsx?$/.test(arquivo) && !/\.test\.tsx?$/.test(arquivo))
    .sort();
}

const lerFonte = (src: string, arquivo: string): ts.SourceFile =>
  ts.createSourceFile(join(src, arquivo), readFileSync(join(src, arquivo), "utf8"), ts.ScriptTarget.Latest);

// Especificadores que só aparecem em `import type` / `export type … from` (nunca num import de valor).
export function acharEspecificadoresSoDeTipo(fonte: ts.SourceFile): Set<string> {
  const deTipo = new Set<string>();
  const deValor = new Set<string>();
  for (const declaracao of fonte.statements) {
    let especificador: ts.Expression | undefined;
    let ehSoDeTipo = false;
    if (ts.isImportDeclaration(declaracao)) {
      especificador = declaracao.moduleSpecifier;
      ehSoDeTipo = declaracao.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword;
    } else if (ts.isExportDeclaration(declaracao)) {
      especificador = declaracao.moduleSpecifier;
      ehSoDeTipo = declaracao.isTypeOnly;
    }
    if (especificador && ts.isStringLiteral(especificador)) (ehSoDeTipo ? deTipo : deValor).add(especificador.text);
  }
  return new Set([...deTipo].filter((alvo) => !deValor.has(alvo)));
}

/** Os especificadores dos `import` e `export … from` do topo do arquivo. */
export function acharEspecificadoresDe(src: string, arquivo: string): string[] {
  return lerFonte(src, arquivo).statements.flatMap((declaracao) =>
    (ts.isImportDeclaration(declaracao) || ts.isExportDeclaration(declaracao)) &&
    declaracao.moduleSpecifier &&
    ts.isStringLiteral(declaracao.moduleSpecifier)
      ? [declaracao.moduleSpecifier.text]
      : [],
  );
}

export function acharImportadoresDe(src: string, ehAlvo: (alvo: string) => boolean): string[] {
  return listarArquivosDeProducao(src).filter((arquivo) => acharEspecificadoresDe(src, arquivo).some(ehAlvo));
}

// shortcut: sem checker de tipos, `.prepare(` é sempre SQL e `.exec(` só conta com literal de texto (SQL); RegExp.exec recebe variável.
function acharChamadasDeSql(fonte: ts.SourceFile): string[] {
  const chamadas = new Set<string>();
  const visitar = (no: ts.Node): void => {
    if (ts.isCallExpression(no) && ts.isPropertyAccessExpression(no.expression)) {
      const metodo = no.expression.name.text;
      const primeiroArgumento = no.arguments[0];
      const ehTexto = primeiroArgumento && ts.isStringLiteralLike(primeiroArgumento);
      const ehTemplate = primeiroArgumento && ts.isTemplateExpression(primeiroArgumento);
      if (metodo === "prepare" || (metodo === "exec" && (ehTexto || ehTemplate))) chamadas.add(`.${metodo}(`);
    }
    ts.forEachChild(no, visitar);
  };
  visitar(fonte);
  return [...chamadas];
}

interface Aresta {
  de: string;
  para: string;
  arquivo: string;
  achado: Achado;
}

interface ImportEntreArquivos {
  arquivo: string;
  alvo: string;
  lugarDoImportador: LugarDoArquivo;
  /** `undefined` no import de pacote ou de `node:*`. */
  lugarDoAlvo?: LugarDoArquivo;
  ehSoDeTipo: boolean;
}

function acharImports(
  src: string,
  arquitetura: Arquitetura,
): { imports: ImportEntreArquivos[]; fontes: Map<string, ts.SourceFile> } {
  const imports: ImportEntreArquivos[] = [];
  const fontes = new Map<string, ts.SourceFile>();
  for (const arquivo of listarArquivosDeProducao(src)) {
    const caminho = join(src, arquivo);
    const texto = readFileSync(caminho, "utf8");
    const fonte = ts.createSourceFile(caminho, texto, ts.ScriptTarget.Latest);
    fontes.set(arquivo, fonte);
    const lugarDoImportador = lugarDoArquivo(arquivo, arquitetura);
    const soDeTipo = acharEspecificadoresSoDeTipo(fonte);
    for (const { fileName: alvo } of ts.preProcessFile(texto, true, true).importedFiles) {
      const lugarDoAlvo = alvo.startsWith(".")
        ? lugarDoArquivo(relative(src, resolve(dirname(caminho), alvo)), arquitetura)
        : undefined;
      imports.push({ arquivo, alvo, lugarDoImportador, lugarDoAlvo, ehSoDeTipo: soDeTipo.has(alvo) });
    }
  }
  return { imports, fontes };
}

function julgarPelaMatriz(
  { alvo, lugarDoImportador, lugarDoAlvo, ehSoDeTipo }: ImportEntreArquivos,
  regra: RegraDoModulo,
): boolean {
  if (lugarDoAlvo === undefined) return regra.externoPermitido(alvo);
  const moduloAlvo = lugarDoAlvo.moduloDoAlvo;
  if (moduloAlvo === undefined || moduloAlvo === lugarDoImportador.moduloDoImportador) return true;
  if (regra.modulosPermitidos.includes(moduloAlvo)) return true;
  return regra.modulosSoComoTipo?.includes(moduloAlvo) === true && ehSoDeTipo;
}

function acharViolacoesEArestas(
  src: string,
  arquitetura: Arquitetura,
): { violacoes: Achado[]; arestas: Aresta[]; arestasEntreSubdominios: Aresta[] } {
  const violacoes: Achado[] = [];
  const arestas: Aresta[] = [];
  const arestasEntreSubdominios: Aresta[] = [];
  const { imports, fontes } = acharImports(src, arquitetura);
  for (const [arquivo, fonte] of fontes) {
    const lugar = lugarDoArquivo(arquivo, arquitetura);
    if (lugar.foraDaOrganizacao) violacoes.push({ arquivo, import: `fora da organização: ${lugar.foraDaOrganizacao}` });
    else if (lugar.moduloDoImportador !== undefined && !arquitetura.matriz[lugar.moduloDoImportador])
      violacoes.push({ arquivo, import: `módulo desconhecido: ${lugar.moduloDoImportador}` });
    if (lugar.moduloDoImportador !== MODULO_COM_SQL)
      for (const chamada of acharChamadasDeSql(fonte)) violacoes.push({ arquivo, import: `SQL ${chamada}` });
  }
  for (const importEntreArquivos of imports) {
    const { arquivo, alvo, lugarDoImportador: de, lugarDoAlvo: para } = importEntreArquivos;
    const julgamentoDoDestino = para === undefined ? undefined : julgarPelasRegrasDeDestino(de, para, arquitetura);
    const motivoDaViolacao = typeof julgamentoDoDestino === "string" ? julgamentoDoDestino : undefined;
    const achado = { arquivo, import: motivoDaViolacao === undefined ? alvo : `${alvo} (${motivoDaViolacao})` };
    const regra = de.moduloDoImportador === undefined ? undefined : arquitetura.matriz[de.moduloDoImportador];
    if (motivoDaViolacao !== undefined || (regra && !julgarPelaMatriz(importEntreArquivos, regra)))
      violacoes.push(achado);
    const moduloAlvo = para?.moduloDoAlvo;
    if (de.moduloDoImportador !== undefined && moduloAlvo !== undefined && moduloAlvo !== de.moduloDoImportador)
      arestas.push({ de: de.moduloDoImportador, para: moduloAlvo, arquivo, achado });
    if (para && ehDominioDeModulosNoLugar(de) && para.dominio === de.dominio && para.subdominio !== de.subdominio) {
      const noDoSubdominio = (lugar: LugarDoArquivo) =>
        [`modulos/${de.dominio}`, lugar.subdominio].filter(Boolean).join("/");
      arestasEntreSubdominios.push({ de: noDoSubdominio(de), para: noDoSubdominio(para), arquivo, achado });
    }
  }
  return { violacoes, arestas, arestasEntreSubdominios };
}

export function acharCiclosEntreModulos(arestas: Aresta[]): Achado[] {
  const vizinhos = new Map<string, Aresta[]>();
  for (const aresta of arestas) vizinhos.set(aresta.de, [...(vizinhos.get(aresta.de) ?? []), aresta]);
  const ciclos: Achado[] = [];
  const emVisita: Aresta[] = [];
  const concluidos = new Set<string>();
  const visitar = (modulo: string): void => {
    for (const aresta of vizinhos.get(modulo) ?? []) {
      const inicioDoCiclo = emVisita.findIndex((passo) => passo.de === aresta.para);
      if (inicioDoCiclo >= 0 || aresta.para === modulo) {
        const volta = [...emVisita.slice(Math.max(inicioDoCiclo, 0)), aresta];
        const caminho = [...volta.map((passo) => passo.de), aresta.para].join(" → ");
        ciclos.push({ arquivo: volta[0]?.arquivo ?? aresta.arquivo, import: `ciclo entre módulos: ${caminho}` });
      } else if (!concluidos.has(aresta.para)) {
        emVisita.push(aresta);
        visitar(aresta.para);
        emVisita.pop();
      }
    }
    concluidos.add(modulo);
  };
  for (const modulo of vizinhos.keys()) if (!concluidos.has(modulo)) visitar(modulo);
  return ciclos;
}

export function descrever({ arquivo, import: alvo }: Achado): string {
  return `${arquivo} importa ${alvo}`;
}

/** As violações da matriz e das regras dos domínios, os ciclos entre módulos da matriz e os ciclos entre subdomínios. */
export function acharViolacoes(src: string, arquitetura: Arquitetura): Achado[] {
  const { violacoes, arestas, arestasEntreSubdominios } = acharViolacoesEArestas(src, arquitetura);
  const ciclos = [...acharCiclosEntreModulos(arestas), ...acharCiclosEntreModulos(arestasEntreSubdominios)];
  return [...new Map([...violacoes, ...ciclos].map((achado) => [descrever(achado), achado])).values()];
}

const descreverDependencia = ({ de, para }: { de: string; para: string }): string => `${de} → ${para}`;

// O nó de cada arquivo no grafo entre domínios: o shared inteiro, cada módulo da matriz do servidor
// (`server/<módulo>`: a web, o contrato, a API, o CLI, a montagem…) e, no resto, as duas primeiras pastas
// (`modulos/<domínio>`).
function dominioDoArquivoNosCiclos(caminhoRelativoASrc: string, arquitetura: Arquitetura): string {
  const [grupo, ...resto] = caminhoRelativoASrc.split("/");
  if (grupo === DOMINIO_SHARED) return DOMINIO_SHARED;
  if (grupo === DOMINIO_DO_SERVIDOR)
    return `${DOMINIO_DO_SERVIDOR}/${arquitetura.moduloDoArquivoDoServidor(resto.join("/"))}`;
  return caminhoRelativoASrc.split("/").slice(0, 2).join("/");
}

// Uma aresta por par de domínios, com o primeiro arquivo que a cria. De valor ou de tipo, tanto faz.
function acharDependenciasEntreDominios(src: string, arquitetura: Arquitetura): Aresta[] {
  const dependencias = new Map<string, Aresta>();
  for (const arquivo of listarArquivosDeProducao(src)) {
    const caminho = join(src, arquivo);
    const de = dominioDoArquivoNosCiclos(arquivo, arquitetura);
    for (const { fileName: alvo } of ts.preProcessFile(readFileSync(caminho, "utf8"), true, true).importedFiles) {
      if (!alvo.startsWith(".")) continue;
      const para = dominioDoArquivoNosCiclos(relative(src, resolve(dirname(caminho), alvo)), arquitetura);
      const descricao = descreverDependencia({ de, para });
      if (para !== de && !dependencias.has(descricao))
        dependencias.set(descricao, { de, para, arquivo, achado: { arquivo, import: alvo } });
    }
  }
  return [...dependencias.values()];
}

/** Os ciclos de import entre os domínios de src/, de valor ou de tipo. */
export const acharCiclosEntreDominios = (src: string, arquitetura: Arquitetura): string[] =>
  acharCiclosEntreModulos(acharDependenciasEntreDominios(src, arquitetura)).map(({ import: ciclo }) => ciclo);

/** Os ciclos das dependências declaradas: entre os domínios (`dependeDe`) e entre os subdomínios de cada domínio. */
export function acharCiclosDeclarados(arquitetura: Arquitetura): string[] {
  const arestaDeclarada = (de: string, para: string): Aresta => ({
    de,
    para,
    arquivo: "",
    achado: { arquivo: "", import: "" },
  });
  const entreDominios = Object.entries(arquitetura.dominios).flatMap(([dominio, regras]) =>
    regras.dependeDe.map((dependencia) => arestaDeclarada(dominio, dependencia)),
  );
  const entreSubdominios = Object.entries(arquitetura.dominios).flatMap(([dominio, regras]) =>
    Object.entries(regras.subdominios).flatMap(([subdominio, dependencias]) =>
      dependencias.map((dependencia) => arestaDeclarada(`${dominio}/${subdominio}`, `${dominio}/${dependencia}`)),
    ),
  );
  return [...acharCiclosEntreModulos(entreDominios), ...acharCiclosEntreModulos(entreSubdominios)].map(
    ({ import: ciclo }) => ciclo,
  );
}

// ---- Posse das tabelas (MELHORIAS §5.1) ----

/** O dono de uma tabela: `<domínio>/<subdomínio>` de src/modulos/, ou `shared` (o mecanismo técnico, como a sequência de IDs). */
export const pastaDoArmazenamentoDoDono = (dono: string): string =>
  dono === DOMINIO_SHARED ? `${DOMINIO_SHARED}/` : `modulos/${dono}/armazenamento/`;

export interface ToqueForaDoDono {
  arquivo: string;
  tabela: string;
  dono: string;
}

export const descreverToque = ({ arquivo, tabela, dono }: ToqueForaDoDono): string =>
  `${arquivo} toca ${tabela} (dono: ${dono})`;

const TABELA_DEPOIS_DE_PALAVRA_DO_SQL =
  /\b(?:FROM|JOIN|INTO|UPDATE|TABLE|REFERENCES)\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?["`]?(\w+)/gi;

// shortcut: sem executar o SQL, a tabela é o nome depois de FROM/JOIN/INTO/UPDATE/TABLE/REFERENCES num texto, ou um
// literal que é exatamente o nome de uma tabela num arquivo que fala SQL (o nome passado a um montador, como
// `apagar("rodada", …)`). Escapam o nome interpolado (`FROM ${tabela}` sem literal) e a segunda tabela de `FROM a, b`.
function acharTabelasTocadas(fonte: ts.SourceFile, tabelas: ReadonlySet<string>): Set<string> {
  const falaSql = acharChamadasDeSql(fonte).length > 0;
  const tocadas = new Set<string>();
  const visitar = (no: ts.Node): void => {
    const ehTexto =
      ts.isStringLiteralLike(no) || ts.isTemplateHead(no) || ts.isTemplateMiddle(no) || ts.isTemplateTail(no);
    if (ehTexto) {
      for (const [, nome] of no.text.matchAll(TABELA_DEPOIS_DE_PALAVRA_DO_SQL))
        if (nome !== undefined && tabelas.has(nome)) tocadas.add(nome);
      if (falaSql && ts.isStringLiteral(no) && tabelas.has(no.text)) tocadas.add(no.text);
    }
    ts.forEachChild(no, visitar);
  };
  visitar(fonte);
  return tocadas;
}

/**
 * Cada ponto em que um arquivo de produção de src/ toca uma tabela fora do armazenamento do dono dela.
 * `pastasIgnoradas` (o histórico do esquema, as migrações congeladas) fica de fora: guarda o passado de todas as tabelas.
 */
export function acharToquesForaDoDono(
  src: string,
  donoDeCadaTabela: Record<string, string>,
  pastasIgnoradas: string[],
): ToqueForaDoDono[] {
  const tabelas = new Set(Object.keys(donoDeCadaTabela));
  return listarArquivosDeProducao(src)
    .filter((arquivo) => !pastasIgnoradas.some((pasta) => arquivo.startsWith(pasta)))
    .flatMap((arquivo) =>
      [...acharTabelasTocadas(lerFonte(src, arquivo), tabelas)]
        .sort()
        .map((tabela) => ({ arquivo, tabela, dono: donoDeCadaTabela[tabela] ?? "" }))
        .filter(({ dono }) => !arquivo.startsWith(pastaDoArmazenamentoDoDono(dono))),
    );
}

/** O dono declarado que não existe: nem `shared`, nem `<domínio>/<subdomínio>` declarado nas regras do domínio. */
export function acharDonosNaoDeclarados(donoDeCadaTabela: Record<string, string>, arquitetura: Arquitetura): string[] {
  return Object.entries(donoDeCadaTabela)
    .filter(([, dono]) => {
      if (dono === DOMINIO_SHARED) return false;
      const [dominio, subdominio, ...resto] = dono.split("/");
      const regras = dominio === undefined || !ehDominioDeModulos(dominio) ? undefined : arquitetura.dominios[dominio];
      return !regras || subdominio === undefined || resto.length > 0 || !(subdominio in regras.subdominios);
    })
    .map(([tabela, dono]) => `${tabela}: ${dono}`);
}
