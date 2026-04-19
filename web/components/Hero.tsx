"use client";
import { useEffect, useState } from "react";
import { Github, ArrowRight } from "lucide-react";
import FadeIn from "./FadeIn";

const HUDMockup = () => (
  <div
    style={{
      borderRadius: "1rem",
      overflow: "hidden",
      border: "1px solid rgba(139,92,246,0.3)",
      boxShadow: "0 0 60px rgba(124,58,237,0.3), 0 25px 50px rgba(0,0,0,0.5)",
      width: "100%",
      maxWidth: 480,
      margin: "0 auto",
    }}
  >
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        padding: "0.75rem 1rem",
        background: "#12121a",
        borderBottom: "1px solid rgba(139,92,246,0.15)",
      }}
    >
      <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#ef4444" }} />
      <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#f59e0b" }} />
      <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#22c55e" }} />
      <span style={{ fontSize: "0.7rem", marginLeft: "0.75rem", fontFamily: "monospace", color: "#4b5563" }}>
        SolveWatch HUD — ⌘⇧H to hide
      </span>
    </div>
    <div style={{ padding: "1.25rem", background: "#12121a" }}>
      <div
        style={{
          borderRadius: "0.5rem",
          padding: "0.75rem",
          marginBottom: "1rem",
          background: "rgba(124,58,237,0.1)",
          border: "1px solid rgba(124,58,237,0.2)",
        }}
      >
        <p style={{ fontSize: "0.7rem", marginBottom: "0.25rem", color: "#7c3aed" }}>🎤 Interviewer</p>
        <p style={{ fontSize: "0.875rem", color: "#c4b5fd" }}>
          &ldquo;Can you explain how memoization works in React?&rdquo;
        </p>
      </div>
      <div>
        <p style={{ fontSize: "0.7rem", marginBottom: "0.5rem", fontFamily: "monospace", color: "#6b7280" }}>
          ✦ AI Answer
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", fontSize: "0.875rem", color: "#e2e8f0" }}>
          <p>• <strong>useMemo</strong> caches expensive computed values between renders</p>
          <p>• <strong>useCallback</strong> memoizes function references for stable props</p>
          <p>• <strong>React.memo</strong> prevents re-renders when props haven&apos;t changed</p>
          <BlinkingCursor />
        </div>
      </div>
      <div
        style={{
          marginTop: "1rem",
          paddingTop: "0.75rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: "0.7rem",
          fontFamily: "monospace",
          borderTop: "1px solid rgba(139,92,246,0.1)",
          color: "#4b5563",
        }}
      >
        <span style={{ color: "#22c55e" }}>● Listening</span>
        <span>Groq · llama-3.3-70b</span>
        <span style={{ color: "#6b7280" }}>invisible in screenshare</span>
      </div>
    </div>
  </div>
);

const BlinkingCursor = () => {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const t = setInterval(() => setOn((v) => !v), 500);
    return () => clearInterval(t);
  }, []);
  return (
    <span
      style={{
        display: "inline-block",
        width: 8,
        height: 16,
        marginLeft: 4,
        borderRadius: 2,
        verticalAlign: "middle",
        background: on ? "#a855f7" : "transparent",
      }}
    />
  );
};

export default function Hero() {
  return (
    <section
      className="dot-grid"
      style={{
        position: "relative",
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "7rem 1.5rem 5rem",
        overflow: "hidden",
        textAlign: "center",
      }}
    >
      <div className="hero-glow" />

      <div style={{ width: "100%", maxWidth: "56rem", margin: "0 auto" }}>
        {/* Eyebrow */}
        <FadeIn>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: "1.5rem" }}>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.5rem",
                padding: "0.375rem 0.875rem",
                borderRadius: "9999px",
                fontSize: "0.75rem",
                fontWeight: 500,
                background: "rgba(124,58,237,0.12)",
                border: "1px solid rgba(124,58,237,0.25)",
                color: "#c4b5fd",
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#a855f7", display: "inline-block" }} />
              Open Source · macOS · MIT License
            </div>
          </div>

          {/* Headline */}
          <h1
            style={{
              fontSize: "clamp(2.75rem, 6vw, 4.5rem)",
              fontWeight: 800,
              lineHeight: 1.1,
              letterSpacing: "-0.02em",
              marginBottom: "1.25rem",
              color: "#fff",
            }}
          >
            The invisible AI
            <br />
            <span className="gradient-text">for your interviews</span>
          </h1>

          {/* Sub */}
          <p
            style={{
              fontSize: "1.125rem",
              lineHeight: 1.7,
              color: "#94a3b8",
              maxWidth: "40rem",
              margin: "0 auto 2.5rem",
            }}
          >
            Live transcription → instant AI answers → stealth HUD overlay.{" "}
            <span style={{ color: "#c4b5fd" }}>
              Completely invisible in Zoom, Meet, and every screenshare tool.
            </span>
          </p>

          {/* CTAs */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "0.75rem",
              justifyContent: "center",
              marginBottom: "2.5rem",
            }}
          >
            <a
              href="#quickstart"
              className="btn-primary"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.5rem",
                color: "#fff",
                fontWeight: 600,
                padding: "0.75rem 1.5rem",
                borderRadius: "0.75rem",
                textDecoration: "none",
                fontSize: "0.95rem",
              }}
            >
              Get Started <ArrowRight size={16} />
            </a>
            <a
              href="https://github.com/parmeet10/solveWatchAi"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.5rem",
                color: "#c4b5fd",
                fontWeight: 500,
                padding: "0.75rem 1.5rem",
                borderRadius: "0.75rem",
                textDecoration: "none",
                fontSize: "0.95rem",
                border: "1px solid rgba(139,92,246,0.25)",
                background: "rgba(124,58,237,0.06)",
                transition: "all 0.2s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "rgba(139,92,246,0.5)";
                e.currentTarget.style.background = "rgba(124,58,237,0.12)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "rgba(139,92,246,0.25)";
                e.currentTarget.style.background = "rgba(124,58,237,0.06)";
              }}
            >
              <Github size={16} /> View on GitHub
            </a>
          </div>

          {/* Stats */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "2.5rem",
              justifyContent: "center",
              marginBottom: "4rem",
            }}
          >
            {[
              { value: "5", label: "AI Providers" },
              { value: "0", label: "API keys for STT" },
              { value: "100%", label: "Invisible in screenshare" },
            ].map((s) => (
              <div key={s.label} style={{ textAlign: "center" }}>
                <p className="gradient-text" style={{ fontSize: "1.75rem", fontWeight: 700 }}>
                  {s.value}
                </p>
                <p style={{ fontSize: "0.75rem", marginTop: "0.125rem", color: "#64748b" }}>
                  {s.label}
                </p>
              </div>
            ))}
          </div>
        </FadeIn>

        {/* HUD mockup — centered below text */}
        <FadeIn direction="up" delay={0.2}>
          <HUDMockup />
        </FadeIn>
      </div>
    </section>
  );
}
