# Imagem do Ambiente (sandbox) da Fabriquinha: o pacote do pi é montado pela Fabriquinha; a imagem traz Node, Git, Python
# (para os agentes rodarem código Python) e o procps (o ps e o pkill que os testes usam).
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates python3 python3-pip python3-venv procps && rm -rf /var/lib/apt/lists/* \
    # A worktree montada tem dono diferente do usuário do container; sem isto o git recusa o repositório.
    && git config --system --add safe.directory '*' \
    # O container não tem a configuração do git do host: o commit do ticket precisa de uma identidade.
    && git config --system user.name "Fabriquinha" \
    && git config --system user.email "fabriquinha@exemplo.com" \
    # Onde o AmbienteContainer grava o grupo de processos de cada comando.
    && mkdir -p /fabriquinha/pids \
    && chown node:node /fabriquinha/pids
# O navegador do Playwright do e2e e as bibliotecas de sistema dele, na versão do package.json, numa pasta que o usuário
# node lê; sem elas o Chromium não abre (faltam libnss3, libgbm, libX11...).
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx -y playwright@1.61.1 install --with-deps chromium && rm -rf /var/lib/apt/lists/* /root/.npm /tmp/* && chmod -R a+rX /ms-playwright
# O fuso do host: sem ele, os testes de data e hora de src/server/web falham no container.
ENV TZ=America/Sao_Paulo
# Usuário não-root: o Claude Code do claude-bridge recusa --dangerously-skip-permissions como root.
USER node
