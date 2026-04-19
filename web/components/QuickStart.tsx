"use client";
import { useState } from "react";
import { Copy, Check } from "lucide-react";
import FadeIn from "./FadeIn";

// ── Platform icons ────────────────────────────────────────────────────────────
const AppleIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
  </svg>
);

const WindowsIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
    <path d="M3 12V6.75l6-1.32v6.57H3zm17 0V3l-9 1.68V12h9zm-9 .5l9 1.83V21L11 19.5V12.5zM3 12.5V18l6 1.14V12.5H3z" />
  </svg>
);

// ── CodeBlock ─────────────────────────────────────────────────────────────────
const CodeBlock = ({ code, label }: { code: string; label?: string }) => {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div
      style={{
        background: "#0d0d14",
        border: "1px solid rgba(139,92,246,0.2)",
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      {label && (
        <div
          style={{
            display: "flex", alignItems: "center", gap: "0.5rem",
            padding: "0.5rem 1rem",
            borderBottom: "1px solid rgba(139,92,246,0.12)",
            background: "rgba(124,58,237,0.04)",
          }}
        >
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#22c55e", display: "inline-block" }} />
          <span style={{ fontSize: "0.7rem", fontFamily: "monospace", color: "#6b7280" }}>{label}</span>
        </div>
      )}
      <div style={{ position: "relative" }}>
        <pre
          style={{
            padding: "1rem 1.25rem",
            fontSize: "0.8rem",
            fontFamily: "'SF Mono','Fira Code','Courier New',monospace",
            color: "#c4b5fd",
            overflowX: "auto",
            lineHeight: 1.8,
            margin: 0,
          }}
        >
          <code>{code}</code>
        </pre>
        <button
          onClick={copy}
          style={{
            position: "absolute", top: "0.75rem", right: "0.75rem",
            padding: "0.3rem 0.5rem", borderRadius: 6,
            background: "rgba(124,58,237,0.15)", border: "1px solid rgba(139,92,246,0.2)",
            color: copied ? "#4ade80" : "#a855f7",
            cursor: "pointer", transition: "all 0.2s",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      </div>
    </div>
  );
};

// ── Platform data ─────────────────────────────────────────────────────────────
const platforms = {
  mac: {
    label: "macOS",
    icon: <AppleIcon />,
    note: "Apple Silicon (M1 – M4) — uses MLX Whisper for GPU-accelerated on-device STT",
    noteColor: "#a855f7",
    steps: [
      {
        n: "1",
        title: "Clone & first-time setup",
        desc: "Installs Homebrew, Node.js, Python, Ollama, and all dependencies automatically. MLX Whisper pre-warms on first launch.",
        code: `git clone https://github.com/parmeet10/solveWatchAi.git
cd solveWatchAi
./start.sh --setup`,
        label: "terminal",
      },
      {
        n: "2",
        title: "Add your AI keys",
        desc: "Open the settings page and configure at least one provider. Keys are stored locally — never sent anywhere else.",
        code: `# After ./start.sh opens, visit:
http://localhost:4000/settings`,
        label: "browser",
      },
      {
        n: "3",
        title: "Start the app",
        desc: "Launches Node.js backend, MLX Whisper transcriber, and the invisible Electron HUD overlay.",
        code: `./start.sh

# Toggle HUD:    ⌘ Shift H
# Toggle listen: ⌘ Shift X`,
        label: "terminal",
      },
    ],
    shortcuts: [
      { keys: "⌘ Shift H", action: "Toggle HUD overlay on / off" },
      { keys: "⌘ Shift X", action: "Toggle listening on / off" },
    ],
  },
  windows: {
    label: "Windows",
    icon: <WindowsIcon />,
    note: "Windows 10 / 11 — uses openai-whisper (CPU) for local on-device STT with no API key required",
    noteColor: "#38bdf8",
    steps: [
      {
        n: "1",
        title: "Clone & first-time setup",
        desc: "Installs Node.js, Python 3.11, and Ollama via winget, then sets up npm and Python venv automatically.",
        code: `git clone https://github.com/parmeet10/solveWatchAi.git
cd solveWatchAi
start.bat --setup`,
        label: "cmd / powershell",
      },
      {
        n: "2",
        title: "Add your AI keys",
        desc: "Open the settings page and configure at least one provider. Keys are stored locally — never sent anywhere else.",
        code: `# After start.bat opens, visit:
http://localhost:4000/settings`,
        label: "browser",
      },
      {
        n: "3",
        title: "Start the app",
        desc: "Launches Node.js backend, openai-whisper transcriber (CPU), and the invisible Electron HUD overlay.",
        code: `start.bat

# Toggle HUD:    Ctrl + Shift + H
# Toggle listen: Ctrl + Shift + X`,
        label: "cmd / powershell",
      },
    ],
    shortcuts: [
      { keys: "Ctrl+Shift+H", action: "Toggle HUD overlay on / off" },
      { keys: "Ctrl+Shift+X", action: "Toggle listening on / off" },
    ],
  },
} as const;

type PlatformKey = keyof typeof platforms;

// ── Component ─────────────────────────────────────────────────────────────────
export default function QuickStart() {
  const [active, setActive] = useState<PlatformKey>("mac");
  const p = platforms[active];

  return (
    <section id="quickstart" style={{ padding: "6rem 1.5rem" }}>
      <div style={{ maxWidth: "64rem", margin: "0 auto" }}>

        {/* Heading */}
        <FadeIn>
          <div style={{ textAlign: "center", marginBottom: "3rem" }}>
            <p style={{ fontSize: "0.8rem", fontWeight: 600, color: "#a855f7", marginBottom: "0.75rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Get running in minutes
            </p>
            <h2 style={{ fontSize: "clamp(1.75rem,4vw,2.5rem)", fontWeight: 800, color: "#fff", marginBottom: "1rem", letterSpacing: "-0.02em" }}>
              Quick start
            </h2>
            <p style={{ fontSize: "1rem", color: "#64748b", maxWidth: "36rem", margin: "0 auto 2rem" }}>
              One command installs everything. Pick your platform below.
            </p>

            {/* Platform switcher */}
            <div style={{ display: "flex", justifyContent: "center" }}>
              <div
                style={{
                  display: "inline-flex",
                  background: "rgba(13,13,20,0.8)",
                  border: "1px solid rgba(139,92,246,0.2)",
                  borderRadius: 12,
                  padding: 4,
                  gap: 4,
                }}
              >
                {(Object.keys(platforms) as PlatformKey[]).map((key) => {
                  const pl = platforms[key];
                  const isActive = active === key;
                  return (
                    <button
                      key={key}
                      onClick={() => setActive(key)}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "0.5rem",
                        padding: "0.5rem 1.125rem",
                        borderRadius: 9,
                        fontSize: "0.85rem",
                        fontWeight: 600,
                        border: "none",
                        cursor: "pointer",
                        transition: "all 0.18s",
                        background: isActive
                          ? "linear-gradient(135deg, #7c3aed, #a855f7)"
                          : "transparent",
                        color: isActive ? "#fff" : "#64748b",
                        boxShadow: isActive
                          ? "0 2px 12px rgba(124,58,237,0.35)"
                          : "none",
                      }}
                    >
                      {pl.icon}
                      {pl.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </FadeIn>

        {/* Platform note */}
        <FadeIn>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.625rem",
              padding: "0.625rem 1rem",
              borderRadius: 9,
              background: "rgba(124,58,237,0.06)",
              border: `1px solid ${p.noteColor}33`,
              marginBottom: "2.5rem",
              fontSize: "0.8rem",
              color: p.noteColor,
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: p.noteColor, flexShrink: 0, display: "inline-block" }} />
            {p.note}
          </div>
        </FadeIn>

        {/* Steps */}
        <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
          {p.steps.map((step, i) => (
            <FadeIn key={`${active}-${step.n}`} delay={i * 0.06} direction="left">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1.6fr", gap: "2rem", alignItems: "start" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.75rem" }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: "50%",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: "0.75rem", fontWeight: 800,
                      background: "linear-gradient(135deg, #7c3aed, #a855f7)", color: "#fff",
                      flexShrink: 0,
                    }}>
                      {step.n}
                    </div>
                    <h3 style={{ fontWeight: 700, color: "#fff", fontSize: "0.95rem" }}>{step.title}</h3>
                  </div>
                  <p style={{ fontSize: "0.8rem", lineHeight: 1.7, color: "#64748b", paddingLeft: "2.5rem" }}>
                    {step.desc}
                  </p>
                </div>
                <CodeBlock code={step.code} label={step.label} />
              </div>
            </FadeIn>
          ))}
        </div>

        {/* Shortcut keys */}
        <FadeIn delay={0.3}>
          <div
            className="glass-card rounded-2xl"
            style={{ padding: "2rem", marginTop: "3rem" }}
          >
            <h3 style={{ fontWeight: 700, color: "#fff", marginBottom: "1.5rem", fontSize: "1rem", textAlign: "center" }}>
              Shortcut keys — {p.label}
            </h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "1rem" }}>
              {p.shortcuts.map((k) => (
                <div
                  key={k.keys}
                  style={{
                    display: "flex", alignItems: "center", gap: "1rem",
                    padding: "1rem 1.25rem", borderRadius: 10,
                    background: "rgba(124,58,237,0.06)", border: "1px solid rgba(139,92,246,0.15)",
                  }}
                >
                  <kbd style={{
                    padding: "0.375rem 0.875rem", borderRadius: 7,
                    fontSize: "0.8rem", fontFamily: "monospace", fontWeight: 700,
                    background: "rgba(124,58,237,0.15)", border: "1px solid rgba(139,92,246,0.3)",
                    color: "#c4b5fd", whiteSpace: "nowrap", flexShrink: 0,
                  }}>
                    {k.keys}
                  </kbd>
                  <span style={{ fontSize: "0.85rem", color: "#94a3b8" }}>{k.action}</span>
                </div>
              ))}
            </div>
          </div>
        </FadeIn>

      </div>
    </section>
  );
}
