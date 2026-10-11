# 02 — Cadastro de projeto

**What to build:** o Auditor (via função de módulo; a tela é F7) cadastra e edita um projeto, e a Fabriquinha recusa repositório, remoto, CLI de hospedagem ou modelo inválidos com mensagem que diz o que fazer. Specs: F1 §3.3, C19, §3.10; F2 §4 (`projeto`), interface `salvarProjeto`/`projeto`/`projetos`; F5 §2 (`conferirProjeto`); F4 §9 (`conferirModelo`).

**Blocked by:** 01

**Status:** done

- [x] Schema `Projeto` (F1 §3.3) com todas as regras, incluindo fitness com nome único e `modelos` por etapa.
- [x] Tabela `projeto` com os CHECKs do F2; C19 grava e edita.
- [x] `conferirProjeto` faz as 5 conferências do F5 §2 em ordem, parando na primeira, e deduz `hospedagem` pelos padrões de URL do §2.1; outros hosts recusados.
- [x] Todo comando externo via `spawn` com argumentos em lista, sem shell.
- [x] `conferirModelo` usa `pi --list-models "<provedor>/<modelo>"` (binário em `$FABRIQUINHA_PI`, padrão `pi`) e exige correspondência exata.
- [x] Testes com repositório git real em diretório temporário e `origin` bare local; `gh`, `az` e `pi` falsos na frente do `PATH`/via variável.
