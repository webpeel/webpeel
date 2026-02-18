import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { COLORS, SUCCESS_RATE_DATA, QUALITY_SCORE_DATA } from "../constants";
import { TitleScene } from "../components/TitleScene";
import { BarChartScene } from "../components/BarChartScene";
import { CTAScene } from "../components/CTAScene";

// 15-second OG video: 1200x630, optimized for social preview
export const OGVideo: React.FC = () => {
  const globalStyle: React.CSSProperties = {
    fontFamily:
      '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
    backgroundColor: COLORS.bg,
    color: COLORS.text,
    width: "100%",
    height: "100%",
    overflow: "hidden",
  };

  return (
    <AbsoluteFill style={globalStyle}>
      {/* Title (0-3s = 0-89) */}
      <Sequence from={0} durationInFrames={90}>
        <TitleScene compact />
      </Sequence>

      {/* Success Rate (3-10s = 90-299) */}
      <Sequence from={90} durationInFrames={210}>
        <BarChartScene
          title="Success Rate"
          subtitle="Independent 2026 Benchmark"
          data={SUCCESS_RATE_DATA}
          highlight="WebPeel"
          highlightBadge="✓ #1"
          compact
        />
      </Sequence>

      {/* CTA (10-15s = 300-449) */}
      <Sequence from={300} durationInFrames={150}>
        <CTAScene compact />
      </Sequence>
    </AbsoluteFill>
  );
};
