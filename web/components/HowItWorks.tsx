"use client";
import FadeIn from "./FadeIn";

const steps = [
  {
    n: "01",
    title: "Interviewer speaks",
    desc: "Your microphone captures audio continuously. Silero VAD filters silence so only real speech is processed.",
    detail: "On-device · Apple MLX Whisper · No API key",
  },
  {
    n: "02",
    title: "Whisper transcribes in real time",
    desc: "LocalAgreement-2 streaming decoder commits words every 300ms, giving you a live partial transcript as the question unfolds.",
    detail: "Committed words · Tentative words",
  },
  {
    n: "03",
    title: "AI generates your answer",
    desc: "The question hits your configured AI provider chain. If one fails, the next takes over. Answers stream token-by-token.",
    detail: "OpenAI → Groq → Gemini → Claude → Ollama",
  },
  {
    n: "04",
    title: "HUD shows it — only to you",
    desc: "Answer bullet points appear in a frameless macOS overlay. Screenshare, recording, and screenshots cannot capture it.",
    detail: "setContentProtection(true)",
  },
];

export default function HowItWorks() {
  return (
    <section
      id="how-it-works"
      style={{ padding: "6rem 1.5rem", background: "rgba(124,58,237,0.03)" }}
    >
      <div style={{ maxWidth: "72rem", margin: "0 auto" }}>
        <FadeIn>
          <div style={{ textAlign: "center", marginBottom: "4rem" }}>
            <p style={{ fontSize: "0.8rem", fontWeight: 600, color: "#a855f7", marginBottom: "0.75rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Under the hood
            </p>
            <h2 style={{ fontSize: "clamp(1.75rem,4vw,2.5rem)", fontWeight: 800, color: "#fff", marginBottom: "1rem", letterSpacing: "-0.02em" }}>
              How it works
            </h2>
            <p style={{ fontSize: "1rem", color: "#64748b", maxWidth: "36rem", margin: "0 auto" }}>
              Four stages, all running locally on your Mac. From mic to HUD in under two seconds.
            </p>
          </div>
        </FadeIn>

        {/* Step cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1.25rem", marginBottom: "3rem" }}>
          {steps.map((step, i) => (
            <FadeIn key={step.n} delay={i * 0.1}>
              <div
                className="glass-card rounded-2xl"
                style={{
                  padding: "2rem 1.5rem",
                  textAlign: "center",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  height: "100%",
                  position: "relative",
                }}
              >
                {/* Step number */}
                <div
                  style={{
                    width: 44, height: 44, borderRadius: "50%",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "0.7rem", fontWeight: 800, fontFamily: "monospace",
                    background: "rgba(124,58,237,0.12)",
                    border: "2px solid rgba(139,92,246,0.35)",
                    color: "#a855f7",
                    marginBottom: "1.25rem",
                    flexShrink: 0,
                  }}
                >
                  {step.n}
                </div>

                <h3 style={{ fontWeight: 700, color: "#fff", marginBottom: "0.75rem", fontSize: "0.95rem", lineHeight: 1.4 }}>
                  {step.title}
                </h3>
                <p style={{ fontSize: "0.8rem", lineHeight: 1.7, color: "#94a3b8", marginBottom: "1.25rem", flex: 1 }}>
                  {step.desc}
                </p>
                <span
                  style={{
                    fontSize: "0.7rem", fontFamily: "monospace",
                    padding: "0.3rem 0.75rem", borderRadius: 6,
                    background: "rgba(124,58,237,0.1)",
                    border: "1px solid rgba(124,58,237,0.18)",
                    color: "#c4b5fd",
                    lineHeight: 1.5,
                  }}
                >
                  {step.detail}
                </span>
              </div>
            </FadeIn>
          ))}
        </div>

        {/* Architecture block */}
        <FadeIn delay={0.4}>
          <div
            style={{
              background: "#0d0d14",
              border: "1px solid rgba(139,92,246,0.2)",
              borderRadius: 12,
              overflow: "hidden",
            }}
          >
            <div style={{
              display: "flex", alignItems: "center", gap: "0.5rem",
              padding: "0.75rem 1.25rem",
              borderBottom: "1px solid rgba(139,92,246,0.12)",
              background: "rgba(124,58,237,0.04)",
            }}>
              <span style={{ fontSize: "0.65rem", fontFamily: "monospace", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Architecture at a glance
              </span>
            </div>
            <div style={{ padding: "1.5rem 1.75rem", overflowX: "auto" }}>
              <pre style={{ fontSize: "0.8rem", lineHeight: 1.9, color: "#c4b5fd", margin: 0, fontFamily: "'SF Mono','Fira Code','Courier New',monospace" }}>
{`Mic ──► Python Whisper (MLX)
           │  stt_partial (300ms) / stt_final (silence)
           ▼
     Node.js Backend (Express + Socket.IO)
           │  ai.service → OpenAI / Groq / Gemini / Claude / Ollama
           ▼
     Electron HUD (always-on-top, content-protected)
           │
Screenshots ──► OCR (Tesseract) ──► AI ──► HUD`}
              </pre>
            </div>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}
