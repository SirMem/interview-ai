"use client";
import { Mic, EyeOff, MessageSquare, Camera, GitFork, Brain } from "lucide-react";
import FadeIn from "./FadeIn";

const features = [
  {
    icon: EyeOff,
    title: "Invisible by design",
    description:
      "The HUD uses macOS setContentProtection(true) — the same API used by banking apps. Your overlay is completely excluded from Zoom, Meet, and any screenshare or recording tool.",
    size: "large",
  },
  { icon: Mic,         title: "On-device STT",           description: "Whisper runs locally via Apple MLX. Zero API keys required for transcription. Works fully offline.",                                        size: "small" },
  { icon: Brain,       title: "Conversation memory",      description: "Remembers the last 3–5 Q&A pairs. Follow-up questions like 'what are its features?' work correctly.",                                      size: "small" },
  { icon: MessageSquare,title: "Streaming AI overlay",    description: "Answers stream as bullet points in real time into a frameless, always-on-top Electron window — right when you need them.",               size: "small" },
  { icon: Camera,      title: "Screenshot analysis",      description: "Drop a screenshot and the app OCRs it with Tesseract + AI for instant analysis. Great for coding problems on screen.",                    size: "small" },
  { icon: GitFork,     title: "Multi-provider fallback",  description: "Configure OpenAI → Groq → Gemini → Claude as a cascade. If one fails or rate-limits, the next kicks in automatically.",                  size: "small" },
];

type Feature = (typeof features)[0];

const SmallCard = ({ feature, delay }: { feature: Feature; delay: number }) => {
  const Icon = feature.icon;
  return (
    <FadeIn delay={delay}>
      <div
        className="glass-card rounded-2xl p-6 h-full"
        style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center" }}
      >
        <div
          style={{
            width: 44, height: 44, borderRadius: 12,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(124,58,237,0.1)", border: "1px solid rgba(124,58,237,0.2)",
            marginBottom: "1rem",
          }}
        >
          <Icon size={20} style={{ color: "#a855f7" }} />
        </div>
        <h3 style={{ fontWeight: 700, color: "#fff", marginBottom: "0.5rem", fontSize: "0.95rem" }}>
          {feature.title}
        </h3>
        <p style={{ fontSize: "0.8rem", lineHeight: 1.6, color: "#94a3b8" }}>
          {feature.description}
        </p>
      </div>
    </FadeIn>
  );
};

export default function Features() {
  const IconLarge = features[0].icon;
  return (
    <section id="features" style={{ padding: "6rem 1.5rem" }}>
      <div style={{ maxWidth: "72rem", margin: "0 auto" }}>
        <FadeIn>
          <div style={{ textAlign: "center", marginBottom: "4rem" }}>
            <p style={{ fontSize: "0.8rem", fontWeight: 600, color: "#a855f7", marginBottom: "0.75rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Everything you need
            </p>
            <h2 style={{ fontSize: "clamp(1.75rem,4vw,2.5rem)", fontWeight: 800, color: "#fff", marginBottom: "1rem", letterSpacing: "-0.02em" }}>
              Built for real interviews
            </h2>
            <p style={{ fontSize: "1rem", color: "#64748b", maxWidth: "36rem", margin: "0 auto" }}>
              Every feature designed around one goal: give you the answer before the silence gets awkward.
            </p>
          </div>
        </FadeIn>

        {/* Large hero card */}
        <FadeIn>
          <div
            className="glass-card rounded-2xl"
            style={{
              padding: "2.5rem",
              marginBottom: "1rem",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              textAlign: "center",
              position: "relative",
              overflow: "hidden",
            }}
          >
            <div style={{
              position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)",
              width: "60%", height: "60%", borderRadius: "50%", pointerEvents: "none",
              background: "radial-gradient(ellipse, rgba(124,58,237,0.12) 0%, transparent 70%)",
            }} />
            <div style={{
              width: 52, height: 52, borderRadius: 14,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "rgba(124,58,237,0.15)", border: "1px solid rgba(124,58,237,0.3)",
              marginBottom: "1.25rem",
            }}>
              <IconLarge size={26} style={{ color: "#a855f7" }} />
            </div>
            <h3 style={{ fontSize: "1.3rem", fontWeight: 800, color: "#fff", marginBottom: "0.75rem" }}>
              {features[0].title}
            </h3>
            <p style={{ color: "#94a3b8", maxWidth: "36rem", lineHeight: 1.7, marginBottom: "1.5rem" }}>
              {features[0].description}
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", justifyContent: "center" }}>
              {["Zoom", "Google Meet", "Teams", "Loom", "OBS"].map((app) => (
                <div key={app} style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "0.375rem 0.75rem", borderRadius: 8, fontSize: "0.75rem", fontWeight: 600,
                  background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)", color: "#4ade80",
                }}>
                  ✓ {app}
                </div>
              ))}
            </div>
          </div>
        </FadeIn>

        {/* 3-col small cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: "1rem" }}>
          {features.slice(1).map((f, i) => (
            <SmallCard key={f.title} feature={f} delay={i * 0.06} />
          ))}
        </div>
      </div>
    </section>
  );
}
