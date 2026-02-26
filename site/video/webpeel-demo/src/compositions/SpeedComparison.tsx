import React from "react";
import {
  AbsoluteFill,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  Easing,
} from "remotion";
import { COLORS } from "../constants";

// ── Data ───────────────────────────────────────────────────────────────────────
const SPEED_DATA = [
  { name: "WebPeel", ms: 164, color: "#e2e8f0", bold: true },
  { name: "Exa", ms: 1870, color: COLORS.tools.Exa, bold: false },
  { name: "Firecrawl", ms: 2340, color: COLORS.tools.Firecrawl, bold: false },
  { name: "Tavily", ms: 3200, color: COLORS.tools.Tavily, bold: false },
  { name: "Jina", ms: 4100, color: COLORS.tools.Jina, bold: false },
];

const MAX_MS = 4100;
const BAR_MAX_WIDTH = 900; // px

// ── Scene 1: Title (frames 0-89) ──────────────────────────────────────────────
const TitleScene: React.FC = () => {
  const frame = useCurrentFrame();

  const titleOpacity = interpolate(frame, [0, 25], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const titleY = interpolate(frame, [0, 25], [30, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  const subtitleOpacity = interpolate(frame, [20, 45], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 20,
      }}
    >
      <div
        style={{
          opacity: titleOpacity,
          transform: `translateY(${titleY}px)`,
          fontSize: 80,
          fontWeight: 800,
          color: COLORS.text,
          fontFamily: '"Inter", sans-serif',
          letterSpacing: -2,
          textAlign: "center",
        }}
      >
        Fetch Speed Comparison
      </div>
      <div
        style={{
          opacity: subtitleOpacity,
          fontSize: 36,
          color: COLORS.textMuted,
          fontFamily: '"Inter", sans-serif',
          textAlign: "center",
        }}
      >
        30 real-world URLs · average latency
      </div>
    </AbsoluteFill>
  );
};

// ── Single animated bar row ────────────────────────────────────────────────────
const BarRow: React.FC<{
  item: (typeof SPEED_DATA)[number];
  rank: number;
  animStart: number;
  highlight?: boolean;
}> = ({ item, rank, animStart, highlight }) => {
  const frame = useCurrentFrame();

  const progress = interpolate(frame, [animStart, animStart + 45], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  const barWidth = (item.ms / MAX_MS) * BAR_MAX_WIDTH * progress;

  const rowOpacity = interpolate(frame, [animStart - 5, animStart + 5], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const highlightGlow = highlight
    ? `0 0 24px rgba(168,255,120,0.5), 0 0 48px rgba(168,255,120,0.2)`
    : "none";

  const barColor = highlight ? "#a8ff78" : item.color;

  return (
    <div
      style={{
        opacity: rowOpacity,
        display: "flex",
        alignItems: "center",
        gap: 24,
        marginBottom: 20,
      }}
    >
      {/* Tool name */}
      <div
        style={{
          width: 160,
          textAlign: "right",
          fontFamily: '"Inter", sans-serif',
          fontSize: item.bold ? 28 : 26,
          fontWeight: item.bold ? 700 : 400,
          color: highlight ? "#a8ff78" : item.bold ? COLORS.text : COLORS.textMuted,
          flexShrink: 0,
        }}
      >
        {item.name}
      </div>

      {/* Bar */}
      <div
        style={{
          height: item.bold ? 52 : 44,
          width: Math.max(barWidth, 4),
          background: barColor,
          borderRadius: 6,
          boxShadow: highlightGlow,
          transition: "none",
          flexShrink: 0,
        }}
      />

      {/* Value label */}
      <div
        style={{
          fontFamily: '"Inter", sans-serif',
          fontSize: item.bold ? 28 : 24,
          fontWeight: item.bold ? 700 : 400,
          color: highlight ? "#a8ff78" : item.bold ? COLORS.text : COLORS.textMuted,
          minWidth: 120,
        }}
      >
        {progress > 0.9 ? `${item.ms.toLocaleString()}ms` : ""}
      </div>
    </div>
  );
};

// ── Scene 2: Bar chart animation (frames 90-359) ───────────────────────────────
const BarChartScene: React.FC<{ highlighted?: boolean }> = ({ highlighted = false }) => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "60px 160px",
      }}
    >
      {/* Section label */}
      <div
        style={{
          fontFamily: '"Inter", sans-serif',
          fontSize: 28,
          color: COLORS.textMuted,
          marginBottom: 48,
          letterSpacing: 2,
          textTransform: "uppercase",
        }}
      >
        Average Response Latency
      </div>

      {/* Bars */}
      {SPEED_DATA.map((item, i) => (
        <BarRow
          key={item.name}
          item={item}
          rank={i}
          animStart={i * 20}
          highlight={highlighted && item.name === "WebPeel"}
        />
      ))}

      {/* X-axis tick labels */}
      <div
        style={{
          display: "flex",
          marginLeft: 184,
          marginTop: 12,
          width: BAR_MAX_WIDTH,
          justifyContent: "space-between",
          fontFamily: '"Inter", sans-serif',
          fontSize: 18,
          color: COLORS.textMuted,
        }}
      >
        {[0, 1000, 2000, 3000, 4000].map((v) => (
          <div key={v}>{v === 0 ? "0" : `${v / 1000}s`}</div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

// ── Scene 3: Highlight + outro (frames 360-449) ────────────────────────────────
const HighlightScene: React.FC = () => {
  const frame = useCurrentFrame();

  const badgeOpacity = interpolate(frame, [10, 35], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const badgeScale = interpolate(frame, [10, 35], [0.7, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.back(2)),
  });

  const logoOpacity = interpolate(frame, [55, 80], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "60px 160px",
        position: "relative",
      }}
    >
      {/* Highlighted bar chart (same layout, WebPeel glowing) */}
      <BarChartScene highlighted />

      {/* "3x faster" badge */}
      <div
        style={{
          position: "absolute",
          top: 200,
          right: 140,
          opacity: badgeOpacity,
          transform: `scale(${badgeScale})`,
          background: "rgba(168,255,120,0.12)",
          border: "2px solid #a8ff78",
          borderRadius: 16,
          padding: "20px 40px",
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontFamily: '"Inter", sans-serif',
            fontSize: 60,
            fontWeight: 800,
            color: "#a8ff78",
            lineHeight: 1.1,
          }}
        >
          25×
        </div>
        <div
          style={{
            fontFamily: '"Inter", sans-serif',
            fontSize: 24,
            color: COLORS.textMuted,
            marginTop: 4,
          }}
        >
          faster than Jina
        </div>
      </div>

      {/* Logo fade-in */}
      <div
        style={{
          position: "absolute",
          bottom: 60,
          right: 160,
          opacity: logoOpacity,
          fontFamily: '"Inter", sans-serif',
          fontSize: 42,
          fontWeight: 800,
          color: COLORS.text,
          letterSpacing: -1,
        }}
      >
        web<span style={{ color: "#a8ff78" }}>peel</span>
        <span style={{ fontSize: 22, fontWeight: 400, color: COLORS.textMuted, marginLeft: 16 }}>
          webpeel.dev
        </span>
      </div>
    </AbsoluteFill>
  );
};

// ── Root composition ───────────────────────────────────────────────────────────
export const SpeedComparison: React.FC = () => {
  return (
    <AbsoluteFill
      style={{
        background: COLORS.bg,
        fontFamily: '"Inter", -apple-system, sans-serif',
        overflow: "hidden",
      }}
    >
      {/* Subtle radial glow */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse 70% 50% at 50% 50%, rgba(168,255,120,0.03) 0%, transparent 70%)",
        }}
      />

      {/* Scene 1: Title (0-3s = frames 0-89) */}
      <Sequence from={0} durationInFrames={90}>
        <TitleScene />
      </Sequence>

      {/* Scene 2: Bar chart (3-12s = frames 90-359) */}
      <Sequence from={90} durationInFrames={270}>
        <BarChartScene />
      </Sequence>

      {/* Scene 3: Highlight + outro (12-15s = frames 360-449) */}
      <Sequence from={360} durationInFrames={90}>
        <HighlightScene />
      </Sequence>
    </AbsoluteFill>
  );
};
