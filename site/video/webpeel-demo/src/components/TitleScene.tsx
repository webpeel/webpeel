import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLORS } from "../constants";

interface TitleSceneProps {
  compact?: boolean;
}

export const TitleScene: React.FC<TitleSceneProps> = ({ compact = false }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const logoOpacity = interpolate(frame, [0, 20], [0, 1], {
    extrapolateRight: "clamp",
  });

  const logoY = spring({
    frame,
    fps,
    config: { damping: 14, stiffness: 150, mass: 0.5 },
    durationInFrames: 30,
  });

  const titleY = spring({
    frame: frame - 8,
    fps,
    config: { damping: 14, stiffness: 120, mass: 0.6 },
    durationInFrames: 35,
  });

  const subtitleOpacity = interpolate(frame, [20, 40], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const badgeOpacity = interpolate(frame, [30, 55], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const badgeScale = spring({
    frame: frame - 30,
    fps,
    config: { damping: 12, stiffness: 200, mass: 0.4 },
    durationInFrames: 25,
  });

  // Fade out near end
  const fadeOut = interpolate(
    frame,
    [compact ? 70 : 120, compact ? 90 : 150],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const titleFontSize = compact ? 56 : 96;
  const subtitleFontSize = compact ? 22 : 36;

  return (
    <AbsoluteFill
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        opacity: fadeOut,
        background: `radial-gradient(ellipse at center, rgba(139, 92, 246, 0.12) 0%, ${COLORS.bg} 70%)`,
      }}
    >
      {/* Grid background */}
      <svg
        style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", opacity: 0.3 }}
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern id="grid" width="80" height="80" patternUnits="userSpaceOnUse">
            <path d="M 80 0 L 0 0 0 80" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
      </svg>

      {/* Logo mark */}
      <div
        style={{
          opacity: logoOpacity,
          transform: `translateY(${(1 - logoY) * 30}px)`,
          marginBottom: compact ? 20 : 32,
          display: "flex",
          alignItems: "center",
          gap: 14,
        }}
      >
        <div
          style={{
            width: compact ? 44 : 64,
            height: compact ? 44 : 64,
            borderRadius: "50%",
            background: `linear-gradient(135deg, ${COLORS.accent}, #6D28D9)`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: compact ? 22 : 32,
            boxShadow: `0 0 40px rgba(139, 92, 246, 0.5)`,
          }}
        >
          🌐
        </div>
        <span
          style={{
            fontSize: compact ? 26 : 38,
            fontWeight: 700,
            color: COLORS.text,
            letterSpacing: "-0.02em",
          }}
        >
          WebPeel
        </span>
      </div>

      {/* Main title */}
      <div
        style={{
          transform: `translateY(${(1 - titleY) * 40}px)`,
          opacity: logoOpacity,
          textAlign: "center",
          paddingLeft: 40,
          paddingRight: 40,
        }}
      >
        <h1
          style={{
            fontSize: titleFontSize,
            fontWeight: 800,
            margin: 0,
            lineHeight: 1.1,
            letterSpacing: "-0.03em",
            color: COLORS.text,
          }}
        >
          vs{" "}
          <span style={{ color: COLORS.accent }}>7 Alternatives</span>
        </h1>
      </div>

      {/* Subtitle */}
      <p
        style={{
          fontSize: subtitleFontSize,
          color: COLORS.textMuted,
          marginTop: compact ? 12 : 20,
          marginBottom: 0,
          opacity: subtitleOpacity,
          letterSpacing: "0.01em",
          fontWeight: 400,
        }}
      >
        2026 Independent Benchmark Study
      </p>

      {/* Badge */}
      <div
        style={{
          marginTop: compact ? 24 : 40,
          opacity: badgeOpacity,
          transform: `scale(${badgeScale})`,
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          justifyContent: "center",
        }}
      >
        {["30 URLs Tested", "Real-World Content", "AI Quality Scoring"].map(
          (tag) => (
            <span
              key={tag}
              style={{
                fontSize: compact ? 13 : 18,
                padding: compact ? "6px 14px" : "8px 20px",
                borderRadius: 999,
                border: `1px solid rgba(139, 92, 246, 0.5)`,
                color: COLORS.accent,
                background: "rgba(139, 92, 246, 0.1)",
                fontWeight: 500,
              }}
            >
              {tag}
            </span>
          )
        )}
      </div>
    </AbsoluteFill>
  );
};
