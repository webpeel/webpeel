import React from "react";
import { Composition } from "remotion";
import { BenchmarkShowcase } from "./compositions/BenchmarkShowcase";
import { OGVideo } from "./compositions/OGVideo";
import { CLIDemo } from "./compositions/CLIDemo";
import { SpeedComparison } from "./compositions/SpeedComparison";

export const Root: React.FC = () => {
  return (
    <>
      {/* Main 30-second benchmark showcase video */}
      <Composition
        id="BenchmarkShowcase"
        component={BenchmarkShowcase}
        durationInFrames={900} // 30 seconds at 30fps
        fps={30}
        width={1920}
        height={1080}
      />
      {/* Social/OG video 15 seconds */}
      <Composition
        id="OGVideo"
        component={OGVideo}
        durationInFrames={450} // 15 seconds at 30fps
        fps={30}
        width={1200}
        height={630}
      />
      {/* CLI demo 20 seconds */}
      <Composition
        id="CLIDemo"
        component={CLIDemo}
        durationInFrames={600} // 20 seconds at 30fps
        fps={30}
        width={1920}
        height={1080}
      />
      {/* Speed comparison 15 seconds */}
      <Composition
        id="SpeedComparison"
        component={SpeedComparison}
        durationInFrames={450} // 15 seconds at 30fps
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};
