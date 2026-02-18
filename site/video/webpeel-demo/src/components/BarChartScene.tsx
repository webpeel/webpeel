import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLORS } from "../constants";

interface BarData {
  name: string;
  value: number;
  color: string;
}

interface BarChartSceneProps {
  title: string;
  subtitle: string;
  data: BarData[];
  highlight: string;
  highlightBadge: string;
  compact?: boolean;
}

const BAR_STAGGER = 8; // frames between each bar starting

export const BarChartScene: React.FC<BarChartSceneProps> = ({
  title,
  subtitle,
  data,
  highlight,
  highlightBadge,
  compact = false,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // Title entrance
  const titleOpacity = interpolate(frame, [0, 20], [0, 1], {
    extrapolateRight: "clamp",
  });
  const titleY = spring({
    frame,
    fps,
    config: { damping: 14, stiffness: 150, mass: 0.5 },
    durationInFrames: 25,
  });

  // Fade out near end
  const fadeOut = interpolate(
    frame,
    [durationInFrames - 30, durationInFrames - 5],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const barHeight = compact ? 36 : 52;
  const barGap = compact ? 8 : 14;
  const fontSize = compact ? 14 : 20;
  const valueFontSize = compact ? 14 : 18;
  const labelWidth = compact ? 120 : 180;
  const badgeFontSize = compact ? 11 : 16;

  const maxBarWidth = compact ? 420 : 700;

  return (
    <AbsoluteFill
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: compact ? "30px 40px" : "60px 100px",
        opacity: fadeOut,
        background: `radial-gradient(ellipse at top left, rgba(139, 92, 246, 0.07) 0%, ${COLORS.bg} 60%)`,
      }}
    >
      {/* Header */}
      <div
        style={{
          textAlign: "center",
          marginBottom: compact ? 24 : 48,
          transform: `translateY(${(1 - titleY) * 20}px)`,
          opacity: titleOpacity,
        }}
      >
        <h2
          style={{
            fontSize: compact ? 32 : 52,
            fontWeight: 800,
            margin: 0,
            letterSpacing: "-0.03em",
            color: COLORS.text,
          }}
        >
          {title}
        </h2>
        <p
          style={{
            fontSize: compact ? 14 : 22,
            color: COLORS.textMuted,
            marginTop: 8,
            marginBottom: 0,
            fontWeight: 400,
          }}
        >
          {subtitle}
        </p>
      </div>

      {/* Bar chart */}
      <div style={{ width: "100%", maxWidth: compact ? 700 : 1200 }}>
        {data.map((item, index) => {
          const isHighlight = item.name === highlight;
          const delay = 15 + index * BAR_STAGGER;

          const barProgress = spring({
            frame: frame - delay,
            fps,
            config: { damping: 18, stiffness: 80, mass: 0.8 },
            durationInFrames: 45,
          });

          const barWidth = interpolate(barProgress, [0, 1], [0, maxBarWidth * (item.value / 100)]);

          const rowOpacity = interpolate(frame, [delay - 5, delay + 10], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });

          const badgeProgress = spring({
            frame: frame - delay - 30,
            fps,
            config: { damping: 14, stiffness: 200, mass: 0.4 },
            durationInFrames: 20,
          });

          return (
            <div
              key={item.name}
              style={{
                display: "flex",
                alignItems: "center",
                marginBottom: barGap,
                opacity: rowOpacity,
                gap: 12,
              }}
            >
              {/* Label */}
              <div
                style={{
                  width: labelWidth,
                  textAlign: "right",
                  fontSize,
                  fontWeight: isHighlight ? 700 : 500,
                  color: isHighlight ? COLORS.accent : COLORS.text,
                  flexShrink: 0,
                }}
              >
                {item.name}
              </div>

              {/* Bar track */}
              <div
                style={{
                  flex: 1,
                  height: barHeight,
                  background: "rgba(255,255,255,0.06)",
                  borderRadius: 6,
                  overflow: "hidden",
                  border: isHighlight
                    ? `1px solid rgba(139, 92, 246, 0.4)`
                    : "1px solid rgba(255,255,255,0.08)",
                  position: "relative",
                }}
              >
                {/* Bar fill */}
                <div
                  style={{
                    width: barWidth,
                    maxWidth: maxBarWidth * (item.value / 100),
                    height: "100%",
                    background: isHighlight
                      ? `linear-gradient(90deg, ${item.color}, rgba(139, 92, 246, 0.7))`
                      : item.color,
                    borderRadius: 5,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    paddingRight: 10,
                    boxSizing: "border-box",
                    boxShadow: isHighlight
                      ? `0 0 20px rgba(139, 92, 246, 0.4)`
                      : undefined,
                  }}
                >
                  {barProgress > 0.4 && (
                    <span
                      style={{
                        fontSize: valueFontSize,
                        fontWeight: 700,
                        color: "white",
                        opacity: interpolate(barProgress, [0.4, 0.8], [0, 1], {
                          extrapolateLeft: "clamp",
                          extrapolateRight: "clamp",
                        }),
                      }}
                    >
                      {item.value}%
                    </span>
                  )}
                </div>
              </div>

              {/* Badge for highlighted item */}
              {isHighlight && (
                <div
                  style={{
                    flexShrink: 0,
                    opacity: badgeProgress,
                    transform: `scale(${badgeProgress})`,
                    background: `rgba(139, 92, 246, 0.2)`,
                    border: `1px solid ${COLORS.accent}`,
                    borderRadius: 999,
                    padding: compact ? "4px 10px" : "6px 14px",
                    fontSize: badgeFontSize,
                    fontWeight: 700,
                    color: COLORS.accent,
                    whiteSpace: "nowrap",
                  }}
                >
                  {highlightBadge}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
