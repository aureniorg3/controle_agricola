/** @type {import('next').NextConfig} */
const nextConfig = {
  // A planilha oficial da safra passa dos 10 MB padrão do Next 16 — sem
  // isso, o corpo da requisição de /api/ordens-corte/importar é cortado
  // (o proxy/middleware precisa bufferizar o corpo inteiro para poder lê-lo).
  experimental: {
    proxyClientMaxBodySize: "50mb",
  },
};

module.exports = nextConfig;
