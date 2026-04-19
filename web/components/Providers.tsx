"use client";
import FadeIn from "./FadeIn";

const providers = [
  { name: "OpenAI",    model: "gpt-4o-mini",          color: "#10a37f", bg: "rgba(16,163,127,0.15)",  initial: "O" },
  { name: "Groq",      model: "llama-3.3-70b",         color: "#f55036", bg: "rgba(245,80,54,0.15)",   initial: "G" },
  { name: "Gemini",    model: "gemini-2.5-flash",       color: "#4285f4", bg: "rgba(66,133,244,0.15)",  initial: "G" },
  { name: "Anthropic", model: "claude-sonnet-4-5",     color: "#d97757", bg: "rgba(217,119,87,0.15)",  initial: "A" },
  { name: "Ollama",    model: "llama3.2:1b (local)",   color: "#a855f7", bg: "rgba(168,85,247,0.15)",  initial: "O" },
];

export default function Providers() {
  return (
    <section style={{ padding: "6rem 1.5rem", background: "rgba(124,58,237,0.03)" }}>
      <div style={{ maxWidth: "64rem", margin: "0 auto" }}>
        <FadeIn>
          <div style={{ textAlign: "center", marginBottom: "3.5rem" }}>
            <p style={{ fontSize: "0.8rem", fontWeight: 600, color: "#a855f7", marginBottom: "0.75rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Your choice
            </p>
            <h2 style={{ fontSize: "clamp(1.75rem,4vw,2.5rem)", fontWeight: 800, color: "#fff", marginBottom: "1rem", letterSpacing: "-0.02em" }}>
              Works with all major AI providers
            </h2>
            <p style={{ fontSize: "1rem", color: "#64748b", maxWidth: "32rem", margin: "0 auto" }}>
              Configure a fallback chain — if one rate-limits, the next kicks in automatically.
            </p>
          </div>
        </FadeIn>

        {/* Provider cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "1rem", marginBottom: "2rem" }}>
          {providers.map((p, i) => (
            <FadeIn key={p.name} delay={i * 0.06}>
              <div
                className="glass-card rounded-2xl"
                style={{
                  padding: "2rem 1.5rem",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  textAlign: "center",
                  cursor: "default",
                  height: "100%",
                }}
              >
                {/* Avatar — centered with explicit margin auto on both sides */}
                <div
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: 14,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "1.25rem",
                    fontWeight: 800,
                    background: p.bg,
                    color: p.color,
                    border: `1px solid ${p.color}33`,
                    marginBottom: "1rem",
                    flexShrink: 0,
                  }}
                >
                  {p.initial}
                </div>
                <p style={{ fontWeight: 700, color: "#fff", fontSize: "0.95rem", marginBottom: "0.375rem" }}>
                  {p.name}
                </p>
                <p style={{ fontSize: "0.7rem", fontFamily: "monospace", color: "#475569", lineHeight: 1.4 }}>
                  {p.model}
                </p>
              </div>
            </FadeIn>
          ))}
        </div>

        {/* Fallback chain */}
        <FadeIn delay={0.35}>
          <div
            style={{
              background: "#0d0d14",
              border: "1px solid rgba(139,92,246,0.2)",
              borderRadius: 10,
              overflow: "hidden",
            }}
          >
            <div style={{
              padding: "0.625rem 1.25rem",
              borderBottom: "1px solid rgba(139,92,246,0.12)",
              background: "rgba(124,58,237,0.04)",
            }}>
              <span style={{ fontSize: "0.65rem", fontFamily: "monospace", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Fallback chain — fully configurable
              </span>
            </div>
            <div style={{ padding: "1rem 1.5rem", textAlign: "center" }}>
              <p style={{ fontSize: "0.875rem", fontFamily: "monospace", color: "#c4b5fd" }}>
                {providers.map((p, i) => (
                  <span key={p.name}>
                    {i > 0 && <span style={{ color: "#4b5563", margin: "0 0.5rem" }}>→</span>}
                    <span style={{ color: p.color }}>{p.name}</span>
                  </span>
                ))}
              </p>
            </div>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}
