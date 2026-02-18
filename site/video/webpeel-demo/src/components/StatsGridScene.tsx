import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLORS, STATS } from "../constants";

function AnimatedCounter({
  value,
  frame,
  fps,
  delay,
}: {
  value: string;
  frame: number;
  fps: number;
  delay: number;
}) {
  // For numeric values, animate the counter
  const isNumeric = /\d+/.test(value);

  const progress = spring({
    frame: frame - delay,
    fps,
    config: { damping: 16, stiffness: 100, mass: 0.6 },
    durationInFrames: 50,
  });

  if (!isNumeric) return <>{value}</>;

  // Extract prefix/suffix and numeric part
  const match = value.match(/^([^0-9]*)(\d+(?:\.\d+)?)(.*)$/);
  if (!match) return <>{value}</>;

  const [, prefix, numStr, suffix] = match;
  const num = parseFloat(numStr);
  const animated = Math.round(num * progress * 10) / 10;

  return (
    <>
      {prefix}
      {Number.isInteger(num) ? Math.round(animated) : animated.toFixed(3).replace(/\.?0+$/, "")}
      {suffix}
    </>
  );
}

export const StatsGridScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const titleOpacity = interpolate(frame, [0, 20], [0, 1], {
    extrapolateRight: "clamp",
  });
  const titleY = spring({
    frame,
    fps,
    config: { damping: 14, stiffness: 150, mass: 0.5 },
    durationInFrames: 25,
  });

  const fadeOut = interpolate(
    frame,
    [durationInFrames - 25, durationInFrames - 5],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <AbsoluteFill
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "60px 80px",
        opacity: fadeOut,
        background: `radial-gradient(ellipse at bottom right, rgba(139, 92, 246, 0.08) 0%, ${COLORS.bg} 60%)`,
      }}
    >
      {/* Header */}
      <div
        style={{
          textAlign: "center",
          marginBottom: 60,
          transform: `translateY(${(1 - titleY) * 20}px)`,
          opacity: titleOpacity,
        }}
      >
        <h2
          style={{
            fontSize: 52,
            fontWeight: 800,
            margin: 0,
            letterSpacing: "-0.03em",
            color: COLORS.text,
          }}
        >
          Why{" "}
          <span style={{ color: COLORS.accent }}>WebPeel</span>
          {" "}Wins
        </h2>
        <p
          style={{
            fontSize: 22,
            color: COLORS.textMuted,
            marginTop: 8,
            marginBottom: 0,
            fontWeight: 400,
          }}
        >
          Open-source, affordable, and the most capable
        </p>
      </div>

      {/* Stats grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 24,
          width: "100%",
          maxWidth: 1200,
        }}
      >
        {STATS.map((stat, index) => {
          const delay = 20 + index * 15;

          const cardProgress = spring({
            frame: frame - delay,
            fps,
            config: { damping: 14, stiffness: 180, mass: 0.5 },
            durationInFrames: 30,
          });

          const cardOpacity = interpolate(
            frame,
            [delay - 5, delay + 10],
            [0, 1],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
          );

          return (
            <div
              key={stat.label}
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 16,
                padding: "36px 24px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                textAlign: "center",
                opacity: cardOpacity,
                transform: `translateY(${(1 - cardProgress) * 30}px)`,
                boxShadow: "0 4px 24px rgba(0,0,0,0.3)",
              }}
            >
              {/* Icon */}
              <div
                style={{
                  fontSize: 40,
                  marginBottom: 16,
                  filter: "drop-shadow(0 0 8px rgba(139, 92, 246, 0.4))",
                }}
              >
                {stat.icon}
              </div>

              {/* Value */}
              <div
                style={{
                  fontSize: 44,
                  fontWeight: 800,
                  color: COLORS.accent,
                  letterSpacing: "-0.03em",
                  lineHeight: 1,
                  marginBottom: 10,
                }}
              >
                <AnimatedCounter
                  value={stat.value}
                  frame={frame}
                  fps={fps}
                  delay={delay}
                />
              </div>

              {/* Label */}
              <div
                style={{
                  fontSize: 18,
                  color: COLORS.textMuted,
                  fontWeight: 500,
                }}
              >
                {stat.label}
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
