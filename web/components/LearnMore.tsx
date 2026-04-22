"use client";
import { ArrowRight, EyeOff, Zap, Cpu, Activity } from "lucide-react";
import FadeIn from "./FadeIn";
import Link from "next/link";

const articles = [
  {
    icon: EyeOff,
    tag: "Deep dive",
    title: "How screenshare invisibility works",
    desc: "setContentProtection(true) is an OS-level API — the same one banking apps use. Here's exactly why Zoom and OBS can't capture the HUD even during full-screen share.",
    href: "/screenshare-invisibility",
  },
  {
    icon: Zap,
    tag: "Deep dive",
    title: "Why SolveWatch is fast",
    desc: "Streaming tokens, Groq's LPU inference, and LocalAgreement-2 commit-before-silence — the architecture decisions that get answers in under 400 ms.",
    href: "/latency",
  },
  {
    icon: Cpu,
    tag: "Deep dive",
    title: "The STT + AI pipeline",
    desc: "From mic audio to answer on screen: VAD → rolling buffer → Whisper on-device → Node backend → multi-provider AI → streamed HUD overlay.",
    href: "/how-it-works",
  },
  {
    icon: Activity,
    tag: "Deep dive",
    title: "Grafana + OpenTelemetry setup",
    desc: "How SolveWatch ships OTel metrics and structured logs from both the Node backend and Python transcriber to Grafana Cloud — without touching the hot path.",
    href: "/observability",
  },
];

export default function LearnMore() {
  return (
    <section style={{ padding: "6rem 1.5rem", borderTop: "1px solid rgba(139,92,246,0.1)" }}>
      <div style={{ maxWidth: "72rem", margin: "0 auto" }}>
        <FadeIn>
          <div style={{ textAlign: "center", marginBottom: "3.5rem" }}>
            <p style={{ fontSize: "0.8rem", fontWeight: 600, color: "#a855f7", marginBottom: "0.75rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Learn more
            </p>
            <h2 style={{ fontSize: "clamp(1.75rem,4vw,2.5rem)", fontWeight: 800, color: "#fff", marginBottom: "1rem", letterSpacing: "-0.02em" }}>
              How SolveWatch actually works
            </h2>
            <p style={{ fontSize: "1rem", color: "#64748b", maxWidth: "36rem", margin: "0 auto" }}>
              Deeper guides on the invisibility layer, the latency architecture, and the full audio-to-answer pipeline.
            </p>
          </div>
        </FadeIn>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1.25rem" }}>
          {articles.map((a, i) => {
            const Icon = a.icon;
            return (
              <FadeIn key={a.href} delay={i * 0.07}>
                <Link href={a.href} style={{ textDecoration: "none", display: "block", height: "100%" }}>
                  <div
                    className="glass-card rounded-2xl"
                    style={{
                      padding: "2rem",
                      height: "100%",
                      display: "flex",
                      flexDirection: "column",
                      gap: "1rem",
                      cursor: "pointer",
                      transition: "border-color 0.2s ease, transform 0.2s ease",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(168,85,247,0.4)";
                      (e.currentTarget as HTMLDivElement).style.transform = "translateY(-2px)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(139,92,246,0.15)";
                      (e.currentTarget as HTMLDivElement).style.transform = "translateY(0)";
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                      <div style={{
                        width: 40, height: 40, borderRadius: 10,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        background: "rgba(124,58,237,0.1)", border: "1px solid rgba(124,58,237,0.2)",
                        flexShrink: 0,
                      }}>
                        <Icon size={18} style={{ color: "#a855f7" }} />
                      </div>
                      <span style={{ fontSize: "0.7rem", fontWeight: 600, color: "#7c3aed", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                        {a.tag}
                      </span>
                    </div>

                    <div style={{ flex: 1 }}>
                      <h3 style={{ fontWeight: 700, color: "#fff", fontSize: "1rem", marginBottom: "0.5rem", lineHeight: 1.4 }}>
                        {a.title}
                      </h3>
                      <p style={{ fontSize: "0.8rem", color: "#94a3b8", lineHeight: 1.7 }}>
                        {a.desc}
                      </p>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", color: "#a855f7", fontSize: "0.8rem", fontWeight: 600 }}>
                      Read more <ArrowRight size={14} />
                    </div>
                  </div>
                </Link>
              </FadeIn>
            );
          })}
        </div>
      </div>
    </section>
  );
}
