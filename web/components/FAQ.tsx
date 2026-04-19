"use client";
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import FadeIn from "./FadeIn";

const faqs = [
  {
    q: "Is the HUD invisible during full screen share — not just window share?",
    a: "Yes. SolveWatch uses setContentProtection(true), an OS-level API (the same one banking and DRM apps use). It excludes the overlay from both window capture and entire screen capture. Confirmed invisible on Zoom, Google Meet, Microsoft Teams, Loom, and OBS on macOS and Windows.",
  },
  {
    q: "Is SolveWatch AI free for commercial use?",
    a: "Yes. SolveWatch is MIT-licensed — free for personal and commercial use, forever. You only pay for the AI provider API calls you make with your own keys (or use Ollama locally for zero cost).",
  },
  {
    q: "How fast are the responses?",
    a: "With Groq (llama-3.3-70b), first token typically arrives in 200–400 ms. Gemini 2.5 Flash is similarly fast. Answers stream token-by-token directly into the HUD, so you start reading before the model even finishes generating. Screenshot-based answers (OCR + AI) complete in under 2 seconds end-to-end.",
  },
  {
    q: "Do I need an internet connection to use it?",
    a: "Transcription is fully offline — Whisper runs on-device via Apple MLX (Apple Silicon) or openai-whisper (Windows). For AI answers, you need your provider's API. If you want 100% offline, configure Ollama as the provider — it runs local LLMs with no cloud calls at all.",
  },
  {
    q: "What happens if my AI provider rate-limits or goes down?",
    a: "SolveWatch has a built-in fallback cascade. If the primary provider fails or rate-limits, it automatically falls back to the next one in your configured order (e.g. OpenAI → Groq → Gemini → Claude). Failed providers cool off and retry on the next request — no manual intervention needed.",
  },
];

export default function FAQ() {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <section id="faq" style={{ padding: "6rem 1.5rem" }}>
      <div style={{ maxWidth: "52rem", margin: "0 auto" }}>
        <FadeIn>
          <div style={{ textAlign: "center", marginBottom: "3.5rem" }}>
            <p style={{ fontSize: "0.8rem", fontWeight: 600, color: "#a855f7", marginBottom: "0.75rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              FAQ
            </p>
            <h2 style={{ fontSize: "clamp(1.75rem,4vw,2.5rem)", fontWeight: 800, color: "#fff", marginBottom: "1rem", letterSpacing: "-0.02em" }}>
              Common questions
            </h2>
            <p style={{ fontSize: "1rem", color: "#64748b" }}>
              Everything you need to know before installing.
            </p>
          </div>
        </FadeIn>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {faqs.map((item, i) => {
            const isOpen = open === i;
            return (
              <FadeIn key={i} delay={i * 0.05}>
                <div
                  className="glass-card rounded-2xl"
                  style={{
                    border: isOpen
                      ? "1px solid rgba(168,85,247,0.4)"
                      : "1px solid rgba(139,92,246,0.15)",
                    transition: "border-color 0.2s ease",
                    overflow: "hidden",
                  }}
                >
                  <button
                    onClick={() => setOpen(isOpen ? null : i)}
                    style={{
                      width: "100%",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "1.25rem 1.5rem",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      textAlign: "left",
                      gap: "1rem",
                    }}
                  >
                    <span style={{ fontWeight: 700, color: "#e2e8f0", fontSize: "0.95rem", lineHeight: 1.5 }}>
                      {item.q}
                    </span>
                    <ChevronDown
                      size={18}
                      style={{
                        color: "#a855f7",
                        flexShrink: 0,
                        transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
                        transition: "transform 0.2s ease",
                      }}
                    />
                  </button>
                  <div
                    style={{
                      maxHeight: isOpen ? "300px" : "0",
                      overflow: "hidden",
                      transition: "max-height 0.3s ease",
                    }}
                  >
                    <p style={{ padding: "0 1.5rem 1.25rem", fontSize: "0.875rem", color: "#94a3b8", lineHeight: 1.75 }}>
                      {item.a}
                    </p>
                  </div>
                </div>
              </FadeIn>
            );
          })}
        </div>
      </div>
    </section>
  );
}
