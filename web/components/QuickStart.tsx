"use client";
import { useState } from "react";
import { Copy, Check } from "lucide-react";
import FadeIn from "./FadeIn";

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
      className="group"
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
            cursor: "pointer", opacity: 0, transition: "opacity 0.2s",
          }}
          className="copy-btn"
          onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
          onMouseLeave={(e) => !copied && (e.currentTarget.style.opacity = "0")}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      </div>
    </div>
  );
};

const steps = [
  {
    n: "1",
    title: "Clone & first-time setup",
    desc: "Installs Homebrew, Node.js, Python, Ollama, and all dependencies automatically.",
    code: `git clone https://github.com/parmeet10/solveWatchAi.git
cd solveWatchAi
./start.sh --setup`,
    label: "terminal",
  },
  {
    n: "2",
    title: "Add your AI keys",
    desc: "Open the settings page in your browser and configure at least one provider. Keys are stored locally.",
    code: `# After ./start.sh opens, visit:
http://localhost:4000/settings`,
    label: "browser",
  },
  {
    n: "3",
    title: "Start the app",
    desc: "Launches Node.js, Python transcriber, and Electron HUD together.",
    code: `./start.sh

# Toggle HUD:    ⌘ Shift H
# Toggle listen: ⌘ Shift X`,
    label: "terminal",
  },
];

export default function QuickStart() {
  return (
    <section id="quickstart" style={{ padding: "6rem 1.5rem" }}>
      <div style={{ maxWidth: "64rem", margin: "0 auto" }}>
        <FadeIn>
          <div style={{ textAlign: "center", marginBottom: "4rem" }}>
            <p style={{ fontSize: "0.8rem", fontWeight: 600, color: "#a855f7", marginBottom: "0.75rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Get running in minutes
            </p>
            <h2 style={{ fontSize: "clamp(1.75rem,4vw,2.5rem)", fontWeight: 800, color: "#fff", marginBottom: "1rem", letterSpacing: "-0.02em" }}>
              Quick start
            </h2>
            <p style={{ fontSize: "1rem", color: "#64748b", maxWidth: "36rem", margin: "0 auto" }}>
              Requires macOS with Apple Silicon. One command installs everything.
            </p>
          </div>
        </FadeIn>

        <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
          {steps.map((step, i) => (
            <FadeIn key={step.n} delay={i * 0.08} direction="left">
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
              Shortcut keys
            </h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "1rem" }}>
              {[
                { keys: "⌘ Shift H", action: "Toggle HUD overlay on / off" },
                { keys: "⌘ Shift X", action: "Toggle listening on / off" },
              ].map((k) => (
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
