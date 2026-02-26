export const COLORS = {
  bg: "#09090B",
  text: "#FAFAF8",
  textMuted: "rgba(250, 250, 248, 0.6)",
  accent: "#18181B",
  gridLine: "rgba(255, 255, 255, 0.1)",
  tools: {
    WebPeel: "#18181B",
    Firecrawl: "#F97316",
    Exa: "#2563EB",
    Tavily: "#06B6D4",
    LinkUp: "#10B981",
    ScrapingBee: "#F59E0B",
    Jina: "#EF4444",
  },
} as const;

export const SUCCESS_RATE_DATA = [
  { name: "WebPeel", value: 100, color: COLORS.tools.WebPeel },
  { name: "Firecrawl", value: 93.3, color: COLORS.tools.Firecrawl },
  { name: "Exa", value: 93.3, color: COLORS.tools.Exa },
  { name: "LinkUp", value: 93.3, color: COLORS.tools.LinkUp },
  { name: "Tavily", value: 83.3, color: COLORS.tools.Tavily },
  { name: "ScrapingBee", value: 80, color: COLORS.tools.ScrapingBee },
  { name: "Jina", value: 53.3, color: COLORS.tools.Jina },
];

export const QUALITY_SCORE_DATA = [
  { name: "WebPeel", value: 92.3, color: COLORS.tools.WebPeel },
  { name: "Exa", value: 83.2, color: COLORS.tools.Exa },
  { name: "LinkUp", value: 81.3, color: COLORS.tools.LinkUp },
  { name: "Tavily", value: 81.2, color: COLORS.tools.Tavily },
  { name: "Firecrawl", value: 77.9, color: COLORS.tools.Firecrawl },
  { name: "ScrapingBee", value: 74.4, color: COLORS.tools.ScrapingBee },
  { name: "Jina", value: 69.1, color: COLORS.tools.Jina },
];

export const STATS = [
  { icon: "🔧", label: "MCP Tools", value: "18" },
  { icon: "💰", label: "Per Page", value: "$0.002" },
  { icon: "✅", label: "Success Rate", value: "100%" },
  { icon: "🔓", label: "License", value: "AGPL-3.0" },
];
