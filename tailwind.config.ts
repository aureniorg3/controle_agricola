import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // azul CRV (#23396B) no 900: barra superior, botões principais, cabeçalho e total das tabelas;
        // o 800 é o mesmo azul um tom abaixo (passar o mouse), o 950 o mais escuro (sub-cabeçalhos, fundo de modal)
        navy: {
          950: "#16264A",
          900: "#23396B",
          800: "#1C2F5A",
          700: "#2D4A85",
          600: "#3B5C9C",
        },
        // identidade CRV: azul da marca, verde do filete e as cores de significado dos relatórios
        crv: {
          azul: "#23396B",
          verde: "#2D8A5A",
          "verde-claro": "#5D9E48",
          laranja: "#D77B38",
          cinza: "#5C6777",
          vermelho: "#BE3132",
          acao: "#2E5FA8",
        },
        brand: {
          50: "#eef4fd",
          100: "#dce8fb",
          200: "#b3cdf5",
          300: "#7fabef",
          400: "#4d89e6",
          500: "#2a6bd6",
          600: "#1976D2",
          700: "#194795",
          800: "#173a78",
          900: "#152f5f",
        },
        surface: "rgb(var(--c-surface) / <alpha-value>)",
        card: "rgb(var(--c-card) / <alpha-value>)",
        line: "rgb(var(--c-line) / <alpha-value>)",
        ink: "rgb(var(--c-ink) / <alpha-value>)",
        muted: "rgb(var(--c-muted) / <alpha-value>)",
        // fundo de item ao passar o mouse (menu, barra de comandos)
        hover: "rgb(var(--c-hover) / <alpha-value>)",
        alert: {
          50: "#FFEBEE",
          500: "#c94a37",
          600: "#b23c2b",
        },
        amber: {
          50: "#FFF4D6",
          500: "#D9A21B",
          600: "#9A6A00",
        },
        good: {
          50: "#E8F5E9",
          500: "#1f7a3d",
          600: "#166430",
        },
      },
      fontFamily: {
        sans: ["Inter", "Segoe UI", "ui-sans-serif", "system-ui", "sans-serif"],
        // títulos de tela, números dos indicadores e nome do sistema (padrão CRV: Barlow Condensed)
        display: ["Barlow Condensed", "Arial Narrow", "Inter", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(16, 24, 40, 0.06), 0 0 1px rgba(16, 24, 40, 0.05)",
        pop: "0 12px 32px rgba(16, 24, 40, 0.16), 0 2px 6px rgba(16, 24, 40, 0.08)",
      },
      borderRadius: {
        // cantos discretos, como nos sistemas corporativos: campos 4px, botões 6px, painéis 8px
        md: "4px",
        lg: "6px",
        xl2: "8px",
      },
    },
  },
  plugins: [],
};

export default config;
