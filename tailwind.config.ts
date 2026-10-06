import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: {
          950: "#082442",
          900: "#0F3D66",
          800: "#122c50",
          700: "#1a3a63",
          600: "#274a78",
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
        surface: "#F7F8FA",
        card: "#ffffff",
        line: "#E8EBF0",
        ink: "#1C2430",
        muted: "#6B7586",
        alert: {
          50: "#FFEBEE",
          500: "#c94a37",
          600: "#b23c2b",
        },
        amber: {
          50: "#FFF3E0",
          500: "#c98a1f",
          600: "#a76e13",
        },
        good: {
          50: "#E8F5E9",
          500: "#1f7a3d",
          600: "#166430",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "Segoe UI",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(16, 24, 40, 0.03)",
        pop: "0 16px 40px rgba(16, 24, 40, 0.10), 0 0 0 1px rgba(16, 24, 40, 0.04)",
      },
      borderRadius: {
        xl2: "12px",
      },
    },
  },
  plugins: [],
};

export default config;
