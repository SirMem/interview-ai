"use client";
import { Shield, Lock, Wifi } from "lucide-react";
import FadeIn from "./FadeIn";

const points = [
  {
    icon: Shield,
    title: "Zero telemetry",
    desc: "No usage data, no analytics, no crash reports sent anywhere. The only outbound calls are to your own AI provider API keys.",
  },
  {
    icon: Lock,
    title: "Keys stored locally",
    desc: "API keys live in config/api-keys.json on your machine — gitignored by default. Never transmitted to any server we operate.",
  },
  {
    icon: Wifi,
    title: "STT runs on-device",
    desc: "Whisper via Apple MLX processes audio locally. Your conversation never leaves your Mac unless you choose OpenAI Whisper API mode.",
  },
];

export default function Privacy() {
  return (
    <section
      style={{
        padding: "5rem 1.5rem",
        background: "linear-gradient(135deg, rgba(124,58,237,0.05) 0%, rgba(168,85,247,0.03) 100%)",
        borderTop: "1px solid rgba(139,92,246,0.1)",
        borderBottom: "1px solid rgba(139,92,246,0.1)",
      }}
    >
      <div style={{ maxWidth: "64rem", margin: "0 auto" }}>
        <FadeIn>
          <div style={{ textAlign: "center", marginBottom: "3rem" }}>
            <div
              style={{
                display: "inline-flex", alignItems: "center", gap: "0.5rem",
                padding: "0.375rem 1rem", borderRadius: "9999px", fontSize: "0.8rem",
                fontWeight: 600, marginBottom: "1.25rem",
                background: "rgba(124,58,237,0.1)", border: "1px solid rgba(124,58,237,0.2)", color: "#c4b5fd",
              }}
            >
              <Shield size={13} /> Privacy first
            </div>
            <h2 style={{ fontSize: "clamp(1.75rem,4vw,2.5rem)", fontWeight: 800, color: "#fff", marginBottom: "0.75rem", letterSpacing: "-0.02em" }}>
              Everything stays on your device
            </h2>
            <p style={{ color: "#64748b", maxWidth: "28rem", margin: "0 auto" }}>
              No cloud storage. No telemetry. No surprises.
            </p>
          </div>
        </FadeIn>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1.25rem" }}>
          {points.map((p, i) => {
            const Icon = p.icon;
            return (
              <FadeIn key={p.title} delay={i * 0.08}>
                <div
                  className="glass-card rounded-2xl"
                  style={{
                    padding: "2rem",
                    textAlign: "center",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    height: "100%",
                  }}
                >
                  <div
                    style={{
                      width: 48, height: 48, borderRadius: 12,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      background: "rgba(124,58,237,0.12)", border: "1px solid rgba(124,58,237,0.2)",
                      marginBottom: "1.25rem",
                    }}
                  >
                    <Icon size={22} style={{ color: "#a855f7" }} />
                  </div>
                  <h3 style={{ fontWeight: 700, color: "#fff", marginBottom: "0.75rem", fontSize: "1rem" }}>
                    {p.title}
                  </h3>
                  <p style={{ fontSize: "0.8rem", lineHeight: 1.7, color: "#94a3b8" }}>
                    {p.desc}
                  </p>
                </div>
              </FadeIn>
            );
          })}
        </div>
      </div>
    </section>
  );
}
