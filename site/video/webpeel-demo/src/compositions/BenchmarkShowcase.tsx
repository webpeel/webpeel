import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS } from "../constants";
import { TitleScene } from "../components/TitleScene";
import { BarChartScene } from "../components/BarChartScene";
import { StatsGridScene } from "../components/StatsGridScene";
import { CTAScene } from "../components/CTAScene";
import { SUCCESS_RATE_DATA, QUALITY_SCORE_DATA } from "../constants";

export const BenchmarkShowcase: React.FC = () => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();

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
      {/* Scene 1: Title (0-5s = frames 0-149) */}
      <Sequence from={0} durationInFrames={150}>
        <TitleScene />
      </Sequence>

      {/* Scene 2: Success Rate Bars (5-15s = frames 150-449) */}
      <Sequence from={150} durationInFrames={300}>
        <BarChartScene
          title="Success Rate"
          subtitle="How often each tool successfully retrieves content"
          data={SUCCESS_RATE_DATA}
          highlight="WebPeel"
          highlightBadge="✓ 100% Success Rate"
        />
      </Sequence>

      {/* Scene 3: Quality Score (15-22s = frames 450-659) */}
      <Sequence from={450} durationInFrames={210}>
        <BarChartScene
          title="Content Quality Score"
          subtitle="Average quality of extracted content (AI-judged)"
          data={QUALITY_SCORE_DATA}
          highlight="WebPeel"
          highlightBadge="✓ Highest Quality"
        />
      </Sequence>

      {/* Scene 4: Key Stats Grid (22-28s = frames 660-839) */}
      <Sequence from={660} durationInFrames={180}>
        <StatsGridScene />
      </Sequence>

      {/* Scene 5: CTA (28-30s = frames 840-899) */}
      <Sequence from={840} durationInFrames={60}>
        <CTAScene />
      </Sequence>
    </AbsoluteFill>
  );
};
