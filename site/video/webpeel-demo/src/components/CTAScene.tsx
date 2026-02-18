import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLORS } from "../constants";

interface CTASceneProps {
  compact?: boolean;
}

export const CTAScene: React.FC<CTASceneProps> = ({ compact = false }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const containerProgress = spring({
    frame,
    fps,
    config: { damping: 14, stiffness: 120, mass: 0.6 },
    durationInFrames: 30,
  });

  const fadeOut = interpolate(
    frame,
    [durationInFrames - 20, durationInFrames - 2],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  // Terminal typing animation
  const terminalCmd = "npx webpeel https://yoursite.com";
  const charCount = Math.floor(
    interpolate(frame, [10, 40], [0, terminalCmd.length], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    })
  );
  const typedText = terminalCmd.slice(0, charCount);
  const showCursor = frame % 20 < 12;

  const linksOpacity = interpolate(frame, [35, 55], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const logoScale = spring({
    frame,
    fps,
    config: { damping: 12, stiffness: 200, mass: 0.4 },
    durationInFrames: 25,
  });

  return (
    <AbsoluteFill
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        opacity: fadeOut,
        background: `radial-gradient(ellipse at center, rgba(139, 92, 246, 0.15) 0%, ${COLORS.bg} 70%)`,
        padding: compact ? "20px 40px" : "60px 100px",
      }}
    >
      {/* Logo */}
      <div
        style={{
          transform: `scale(${logoScale})`,
          display: "flex",
          alignItems: "center",
          gap: 14,
          marginBottom: compact ? 24 : 40,
        }}
      >
        <div
          style={{
            width: compact ? 40 : 56,
            height: compact ? 40 : 56,
            borderRadius: "50%",
            background: `linear-gradient(135deg, ${COLORS.accent}, #6D28D9)`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: compact ? 20 : 28,
            boxShadow: `0 0 30px rgba(139, 92, 246, 0.5)`,
          }}
        >
          🌐
        </div>
        <div>
          <div
            style={{
              fontSize: compact ? 30 : 48,
              fontWeight: 800,
              color: COLORS.text,
              letterSpacing: "-0.03em",
              lineHeight: 1,
            }}
          >
            WebPeel
          </div>
          {!compact && (
            <div
              style={{
                fontSize: 20,
                color: COLORS.textMuted,
                fontWeight: 400,
              }}
            >
              The #1 Web Intelligence API
            </div>
          )}
        </div>
      </div>

      {/* Terminal */}
      <div
        style={{
          background: "rgba(255,255,255,0.05)",
          border: "1px solid rgba(255,255,255,0.15)",
          borderRadius: 12,
          padding: compact ? "16px 24px" : "24px 36px",
          fontFamily: '"Fira Code", "Cascadia Code", "JetBrains Mono", "Courier New", monospace',
          marginBottom: compact ? 20 : 36,
          opacity: interpolate(frame, [5, 15], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        {/* Terminal header dots */}
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          {["#FF5F57", "#FFBD2E", "#28CA41"].map((c) => (
            <div
              key={c}
              style={{
                width: compact ? 10 : 14,
                height: compact ? 10 : 14,
                borderRadius: "50%",
                background: c,
              }}
            />
          ))}
        </div>
        {/* Command */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: COLORS.accent, fontSize: compact ? 16 : 24, fontWeight: 700 }}>
            $
          </span>
          <span style={{ color: "#A0F0A0", fontSize: compact ? 16 : 24 }}>
            {typedText}
          </span>
          {showCursor && (
            <span
              style={{
                display: "inline-block",
                width: compact ? 10 : 14,
                height: compact ? 18 : 28,
                background: "#A0F0A0",
                borderRadius: 2,
              }}
            />
          )}
        </div>
      </div>

      {/* Links */}
      <div
        style={{
          display: "flex",
          gap: compact ? 24 : 40,
          opacity: linksOpacity,
          flexWrap: "wrap",
          justifyContent: "center",
        }}
      >
        {[
          { label: "🌐", text: "webpeel.dev" },
          { label: "⭐", text: "github.com/webpeel/webpeel" },
        ].map((link) => (
          <div
            key={link.text}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: compact ? 14 : 22,
              color: COLORS.textMuted,
            }}
          >
            <span>{link.label}</span>
            <span
              style={{
                color: COLORS.accent,
                fontWeight: 600,
                textDecoration: "underline",
                textDecorationColor: "rgba(139, 92, 246, 0.4)",
              }}
            >
              {link.text}
            </span>
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};
