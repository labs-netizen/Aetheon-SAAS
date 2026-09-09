import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/modules/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/features/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        border: "var(--border)",
        card: {
          DEFAULT: "var(--card)",
          foreground: "var(--card-foreground)",
        },
        primary: {
          DEFAULT: "#0f766e", // Teal / Deep Emerald industrial
          hover: "#0d9488",
          foreground: "#ffffff",
        },
        secondary: {
          DEFAULT: "#1e293b",
          hover: "#334155",
          foreground: "#f8fafc",
        },
        energy: {
          grid: "#0284c7", // Sky blue for grid
          solar: "#f59e0b", // Amber for solar
          bess: "#8b5cf6", // Purple for storage
          dsm: "#ef4444", // Red for deviation
          oa: "#10b981", // Emerald for open access
        },
        status: {
          normal: "#10b981",
          watch: "#f59e0b",
          high: "#f97316",
          critical: "#ef4444",
          stale: "#64748b",
        },
      },
    },
  },
  plugins: [],
};

export default config;
