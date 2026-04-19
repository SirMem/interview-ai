"use client";
import Image from "next/image";
import FadeIn from "./FadeIn";

const shots = [
  {
    file: "/aiproviders.png",
    label: "AI Providers & Fallback Chain",
    desc: "Configure keys, enable providers, and drag to set the fallback order.",
    wide: true,
  },
  {
    file: "/stt-speaker-diarization.png",
    label: "STT & Speaker Identification",
    desc: "Switch between on-device Whisper and OpenAI API, and enroll your voice to filter yourself out.",
    wide: false,
  },
];

export default function Screenshots() {
  return (
    <section style={{ padding: "6rem 1.5rem" }}>
      <div style={{ maxWidth: "72rem", margin: "0 auto" }}>
        <FadeIn>
          <div style={{ textAlign: "center", marginBottom: "3.5rem" }}>
            <p style={{ fontSize: "0.8rem", fontWeight: 600, color: "#a855f7", marginBottom: "0.75rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Settings
            </p>
            <h2 style={{ fontSize: "clamp(1.75rem,4vw,2.5rem)", fontWeight: 800, color: "#fff", marginBottom: "1rem", letterSpacing: "-0.02em" }}>
              Configure everything in the browser
            </h2>
            <p style={{ fontSize: "1rem", color: "#64748b", maxWidth: "36rem", margin: "0 auto" }}>
              Open{" "}
              <code style={{ fontFamily: "monospace", fontSize: "0.85rem", color: "#a855f7", background: "rgba(124,58,237,0.1)", padding: "1px 6px", borderRadius: 4 }}>
                http://localhost:4000/settings
              </code>{" "}
              after starting. Keys stored locally — never sent anywhere.
            </p>
          </div>
        </FadeIn>

        {/* Top: wide AI Providers screenshot */}
        <FadeIn direction="up">
          <div
            className="glass-card rounded-2xl"
            style={{ overflow: "hidden", marginBottom: "1.25rem" }}
          >
            <div style={{
              padding: "0.875rem 1.25rem",
              borderBottom: "1px solid rgba(139,92,246,0.12)",
              display: "flex", alignItems: "center", gap: "0.625rem",
            }}>
              <span style={{ fontSize: "0.9rem" }}>🤖</span>
              <div>
                <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "#c4b5fd" }}>{shots[0].label}</div>
                <div style={{ fontSize: "0.7rem", color: "#64748b", marginTop: "1px" }}>{shots[0].desc}</div>
              </div>
            </div>
            <div style={{ padding: "1.25rem", background: "rgba(0,0,0,0.2)" }}>
              <Image
                src={shots[0].file}
                alt={shots[0].label}
                width={1200}
                height={700}
                style={{ width: "100%", height: "auto", borderRadius: 8, display: "block" }}
              />
            </div>
          </div>
        </FadeIn>

        {/* Bottom: single card (STT & Speaker) */}
        <div>
          {shots.slice(1).map((s) => (
            <FadeIn key={s.file} direction="up" delay={0.08}>
              <div
                className="glass-card rounded-2xl"
                style={{ overflow: "hidden" }}
              >
                <div style={{
                  padding: "0.875rem 1.25rem",
                  borderBottom: "1px solid rgba(139,92,246,0.12)",
                  display: "flex", alignItems: "center", gap: "0.625rem",
                }}>
                  <span style={{ fontSize: "0.9rem" }}>🎙️</span>
                  <div>
                    <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "#c4b5fd" }}>{s.label}</div>
                    <div style={{ fontSize: "0.7rem", color: "#64748b", marginTop: "1px" }}>{s.desc}</div>
                  </div>
                </div>
                <div style={{ padding: "1.25rem", background: "rgba(0,0,0,0.2)" }}>
                  <Image
                    src={s.file}
                    alt={s.label}
                    width={700}
                    height={500}
                    style={{ width: "100%", height: "auto", borderRadius: 8, display: "block" }}
                  />
                </div>
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}
