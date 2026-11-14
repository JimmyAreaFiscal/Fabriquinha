# Imagem do Ambiente (sandbox) da Fabriquinha: o pacote do pi é montado pela Fabriquinha; a imagem só traz Node e Git.
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
