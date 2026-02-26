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

// ── Typewriter helper ──────────────────────────────────────────────────────────
const TypedText: React.FC<{
  text: string;
  startFrame: number;
  speed?: number;
  color?: string;
}> = ({ text, startFrame, speed = 2, color }) => {
  const frame = useCurrentFrame();
  const charsToShow = Math.max(0, Math.floor((frame - startFrame) / speed));
  return (
    <span style={{ color: color ?? "#a8ff78" }}>
      {text.slice(0, charsToShow)}
    </span>
  );
};

// ── Blinking cursor ────────────────────────────────────────────────────────────
const Cursor: React.FC<{ visible?: boolean }> = ({ visible = true }) => {
  const frame = useCurrentFrame();
  const blink = Math.floor(frame / 15) % 2 === 0;
  if (!visible) return null;
  return (
    <span
      style={{
        display: "inline-block",
        width: 14,
        height: 28,
        background: blink ? "#a8ff78" : "transparent",
        verticalAlign: "middle",
        marginLeft: 2,
      }}
    />
  );
};

// ── Fade-in wrapper ────────────────────────────────────────────────────────────
const FadeIn: React.FC<{
  startFrame: number;
  durationFrames?: number;
  children: React.ReactNode;
}> = ({ startFrame, durationFrames = 20, children }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(
    frame,
    [startFrame, startFrame + durationFrames],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  return <div style={{ opacity }}>{children}</div>;
};

// ── macOS-style window chrome ──────────────────────────────────────────────────
const TerminalChrome: React.FC = () => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: "14px 20px",
      background: "#1a1a24",
      borderBottom: "1px solid rgba(255,255,255,0.07)",
      borderRadius: "16px 16px 0 0",
    }}
  >
    <div style={{ width: 14, height: 14, borderRadius: "50%", background: "#FF5F57" }} />
    <div style={{ width: 14, height: 14, borderRadius: "50%", background: "#FEBC2E" }} />
    <div style={{ width: 14, height: 14, borderRadius: "50%", background: "#28C840" }} />
    <span
      style={{
        marginLeft: "auto",
        marginRight: "auto",
        color: "rgba(255,255,255,0.35)",
        fontSize: 15,
        fontFamily: "monospace",
        letterSpacing: 1,
      }}
    >
      webpeel — terminal
    </span>
  </div>
);

// ── Scene 1: Fetch a URL (frames 0-149) ───────────────────────────────────────
const Scene1Fetch: React.FC = () => {
  const frame = useCurrentFrame();

  const CMD = `$ webpeel "https://openai.com/blog/gpt-5"`;
  const cmdDone = frame >= CMD.length * 2 + 5;

  // spinner frames (after command finishes typing ~frame 80)
  const spinnerChars = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  const spinnerStart = CMD.length * 2 + 5;
  const spinnerVisible = frame >= spinnerStart && frame < spinnerStart + 40;
  const spinnerChar = spinnerChars[Math.floor((frame - spinnerStart) / 4) % spinnerChars.length];

  const resultStart = spinnerStart + 40;

  const RESULT_LINES = [
    { text: "✓ Fetched in 164ms", color: "#a8ff78" },
    { text: "", color: "" },
    { text: "Title:  GPT-5 — OpenAI", color: "#e2e8f0" },
    { text: "Tokens: 2,847", color: "#94a3b8" },
    { text: "Size:   18.4 KB  (markdown)", color: "#94a3b8" },
    { text: "Source: https://openai.com/blog/gpt-5", color: "#64748b" },
  ];

  return (
    <div style={{ padding: "28px 36px", fontFamily: "monospace", fontSize: 22, lineHeight: 1.7 }}>
      {/* Command line */}
      <div>
        <span style={{ color: "#64748b" }}>~/projects </span>
        <TypedText text={CMD.slice(2)} startFrame={0} speed={2} color="#e2e8f0" />
        <span style={{ color: "#64748b" }}>{CMD.startsWith("$") ? "" : ""}</span>
        {!cmdDone && <Cursor />}
      </div>
      {/* Prompt prefix */}
      <div style={{ marginTop: 2 }}>
        <span style={{ color: "#64748b" }}>~/projects </span>
        <TypedText text="$ " startFrame={0} speed={999} color="#64748b" />
        <TypedText text={CMD.slice(2)} startFrame={0} speed={2} color="#e2e8f0" />
      </div>

      {/* Fetching spinner */}
      {spinnerVisible && (
        <div style={{ color: "#a8ff78", marginTop: 8 }}>
          {spinnerChar}{" "}
          <span style={{ color: "#94a3b8" }}>Fetching https://openai.com/blog/gpt-5 …</span>
        </div>
      )}

      {/* Results */}
      {frame >= resultStart &&
        RESULT_LINES.map((line, i) => (
          <FadeIn key={i} startFrame={resultStart + i * 8} durationFrames={12}>
            <div style={{ color: line.color }}>{line.text}</div>
          </FadeIn>
        ))}
    </div>
  );
};

// ── Scene 2: Search (frames 150-299) ──────────────────────────────────────────
const Scene2Search: React.FC = () => {
  const frame = useCurrentFrame();

  const CMD = `$ webpeel search "best AI tools 2026"`;
  const cmdDone = frame >= CMD.length * 2 + 5;
  const spinnerStart = CMD.length * 2 + 5;
  const spinnerChars = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  const spinnerVisible = frame >= spinnerStart && frame < spinnerStart + 30;
  const spinnerChar = spinnerChars[Math.floor((frame - spinnerStart) / 4) % spinnerChars.length];
  const resultStart = spinnerStart + 30;

  const RESULTS = [
    { title: "1. WebPeel — The fastest web scraping API", url: "webpeel.dev" },
    { title: "2. Claude — Anthropic's frontier AI assistant", url: "claude.ai" },
    { title: "3. Cursor — AI-first code editor", url: "cursor.com" },
    { title: "4. Perplexity — AI search engine", url: "perplexity.ai" },
    { title: "5. v0 — Generate UIs with prompts", url: "v0.dev" },
  ];

  return (
    <div style={{ padding: "28px 36px", fontFamily: "monospace", fontSize: 22, lineHeight: 1.7 }}>
      {/* Command */}
      <div>
        <span style={{ color: "#64748b" }}>~/projects </span>
        <TypedText text={CMD.slice(2)} startFrame={0} speed={2} color="#e2e8f0" />
        {!cmdDone && <Cursor />}
      </div>

      {spinnerVisible && (
        <div style={{ color: "#a8ff78", marginTop: 8 }}>
          {spinnerChar}{" "}
          <span style={{ color: "#94a3b8" }}>Searching …</span>
        </div>
      )}

      {frame >= resultStart && (
        <FadeIn startFrame={resultStart} durationFrames={10}>
          <div style={{ color: "#a8ff78", marginTop: 8 }}>✓ 5 results (210ms)</div>
        </FadeIn>
      )}

      {frame >= resultStart &&
        RESULTS.map((r, i) => (
          <FadeIn key={i} startFrame={resultStart + 10 + i * 10} durationFrames={12}>
            <div style={{ marginTop: 6 }}>
              <div style={{ color: "#e2e8f0" }}>{r.title}</div>
              <div style={{ color: "#64748b", fontSize: 18 }}>   {r.url}</div>
            </div>
          </FadeIn>
        ))}
    </div>
  );
};

// ── Scene 3: MCP (frames 300-449) ─────────────────────────────────────────────
const Scene3MCP: React.FC = () => {
  const frame = useCurrentFrame();

  const CMD = `$ webpeel mcp`;
  const cmdDone = frame >= CMD.length * 2 + 5;
  const outputStart = CMD.length * 2 + 10;

  const MCP_TOOLS = [
    "fetch_url", "fetch_markdown", "fetch_json", "search_web",
    "search_news", "screenshot_url", "pdf_url", "extract_links",
    "extract_images", "summarize_url", "compare_urls", "monitor_url",
    "batch_fetch", "proxy_fetch", "cache_url", "diff_url",
    "sitemap_url", "crawl_site",
  ];

  return (
    <div style={{ padding: "28px 36px", fontFamily: "monospace", fontSize: 22, lineHeight: 1.7 }}>
      {/* Command */}
      <div>
        <span style={{ color: "#64748b" }}>~/projects </span>
        <TypedText text={CMD.slice(2)} startFrame={0} speed={2} color="#e2e8f0" />
        {!cmdDone && <Cursor />}
      </div>

      {frame >= outputStart && (
        <FadeIn startFrame={outputStart} durationFrames={10}>
          <div style={{ color: "#a8ff78", marginTop: 8 }}>
            ✓ WebPeel MCP server running on stdio
          </div>
          <div style={{ color: "#64748b", fontSize: 18, marginTop: 4 }}>
            18 tools registered:
          </div>
        </FadeIn>
      )}

      {frame >= outputStart + 15 && (
        <FadeIn startFrame={outputStart + 15} durationFrames={20}>
          <div
            style={{
              marginTop: 10,
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: "4px 24px",
              fontSize: 18,
              color: "#94a3b8",
            }}
          >
            {MCP_TOOLS.map((tool, i) => (
              <div key={i} style={{ color: i < 4 ? "#a8ff78" : "#94a3b8" }}>
                • {tool}
              </div>
            ))}
          </div>
        </FadeIn>
      )}
    </div>
  );
};

// ── Scene 4: Logo outro (frames 450-599) ──────────────────────────────────────
const Scene4Logo: React.FC = () => {
  const frame = useCurrentFrame();

  const opacity = interpolate(frame, [0, 30], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const taglineOpacity = interpolate(frame, [40, 65], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const npmOpacity = interpolate(frame, [70, 95], [0, 1], {
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
        gap: 28,
      }}
    >
      {/* Logo */}
      <div style={{ opacity }}>
        <div
          style={{
            fontSize: 96,
            fontWeight: 800,
            letterSpacing: -3,
            color: COLORS.text,
            fontFamily: '"Inter", sans-serif',
          }}
        >
          web<span style={{ color: "#a8ff78" }}>peel</span>
        </div>
      </div>

      {/* Domain */}
      <div
        style={{
          opacity: taglineOpacity,
          fontSize: 36,
          color: COLORS.textMuted,
          fontFamily: '"Inter", sans-serif',
          letterSpacing: 2,
        }}
      >
        webpeel.dev
      </div>

      {/* npm install */}
      <div
        style={{
          opacity: npmOpacity,
          background: "#1a1a24",
          border: "1px solid rgba(168,255,120,0.3)",
          borderRadius: 12,
          padding: "16px 40px",
          fontFamily: "monospace",
          fontSize: 30,
          color: "#a8ff78",
          letterSpacing: 1,
        }}
      >
        npm install -g webpeel
      </div>
    </AbsoluteFill>
  );
};

// ── Root composition ───────────────────────────────────────────────────────────
export const CLIDemo: React.FC = () => {
  const terminalStyle: React.CSSProperties = {
    background: "#0a0a0f",
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.08)",
    boxShadow: "0 32px 80px rgba(0,0,0,0.6)",
    overflow: "hidden",
    width: 1480,
    height: 720,
  };

  return (
    <AbsoluteFill
      style={{
        background: COLORS.bg,
        fontFamily: '"JetBrains Mono", "Fira Code", "Consolas", monospace',
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Subtle background gradient */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse 80% 60% at 50% 50%, rgba(168,255,120,0.04) 0%, transparent 70%)",
        }}
      />

      {/* Scenes 1-3: terminal window */}
      <Sequence from={0} durationInFrames={450}>
        <div style={{ position: "relative", zIndex: 1 }}>
          <div style={terminalStyle}>
            <TerminalChrome />
            <div style={{ background: "#0a0a0f", minHeight: 660 }}>
              <Sequence from={0} durationInFrames={150}>
                <Scene1Fetch />
              </Sequence>
              <Sequence from={150} durationInFrames={150}>
                <Scene2Search />
              </Sequence>
              <Sequence from={300} durationInFrames={150}>
                <Scene3MCP />
              </Sequence>
            </div>
          </div>
        </div>
      </Sequence>

      {/* Scene 4: Logo outro */}
      <Sequence from={450} durationInFrames={150}>
        <Scene4Logo />
      </Sequence>
    </AbsoluteFill>
  );
};
