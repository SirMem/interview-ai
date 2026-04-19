"use client";
import { Mail, ExternalLink } from "lucide-react";
import FadeIn from "./FadeIn";

export default function AboutContact() {
  return (
    <section style={{ padding: "6rem 1.5rem" }}>
      <div style={{ maxWidth: "64rem", margin: "0 auto" }}>
        <FadeIn>
          <div style={{ textAlign: "center", marginBottom: "3rem" }}>
            <p style={{ fontSize: "0.8rem", fontWeight: 600, color: "#a855f7", marginBottom: "0.75rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              The creator
            </p>
            <h2 style={{ fontSize: "clamp(1.75rem,4vw,2.5rem)", fontWeight: 800, color: "#fff", marginBottom: "0.75rem", letterSpacing: "-0.02em" }}>
              About &amp; Contact
            </h2>
            <p style={{ color: "#64748b", maxWidth: "32rem", margin: "0 auto" }}>
              Built by a developer who got tired of going blank in interviews.
            </p>
          </div>
        </FadeIn>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: "1.25rem" }}>
          {/* About card */}
          <FadeIn direction="left">
            <div
              className="glass-card rounded-2xl p-8 h-full"
              style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center" }}
            >
              <div style={{
                width: 52, height: 52, borderRadius: 14,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "rgba(124,58,237,0.15)", border: "1px solid rgba(124,58,237,0.25)",
                marginBottom: "1.25rem",
              }}>
                <ExternalLink size={22} style={{ color: "#a855f7" }} />
              </div>
              <h3 style={{ fontSize: "1.1rem", fontWeight: 700, color: "#fff", marginBottom: "0.75rem" }}>About me</h3>
              <p style={{ lineHeight: 1.7, color: "#94a3b8", marginBottom: "1.75rem", flex: 1 }}>
                I&apos;m a full-stack developer passionate about building tools that make developers&apos; lives easier. SolveWatch AI was born from real interview pain — I wanted an assistant that stays invisible while actually helping.
              </p>
              <a
                href="https://portfolio-green-sigma-73.vercel.app"
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary"
                style={{
                  display: "inline-flex", alignItems: "center", gap: "0.4rem",
                  fontWeight: 600, padding: "0.625rem 1.25rem", borderRadius: "0.6rem",
                  color: "#fff", textDecoration: "none", fontSize: "0.875rem",
                }}
              >
                View Portfolio <ExternalLink size={13} />
              </a>
            </div>
          </FadeIn>

          {/* Contact card */}
          <FadeIn direction="right" delay={0.08}>
            <div
              className="glass-card rounded-2xl p-8 h-full"
              style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center" }}
            >
              <div style={{
                width: 52, height: 52, borderRadius: 14,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "rgba(124,58,237,0.15)", border: "1px solid rgba(124,58,237,0.25)",
                marginBottom: "1.25rem",
              }}>
                <Mail size={22} style={{ color: "#a855f7" }} />
              </div>
              <h3 style={{ fontSize: "1.1rem", fontWeight: 700, color: "#fff", marginBottom: "0.75rem" }}>Get in touch</h3>
              <p style={{ lineHeight: 1.7, color: "#94a3b8", marginBottom: "1.75rem", flex: 1 }}>
                Found a bug? Have a feature request? Want to collaborate? Drop me a message — I read every email and reply to all of them.
              </p>
              <a
                href="mailto:sparmeet162000@gmail.com?subject=SolveWatch AI"
                style={{
                  display: "inline-flex", alignItems: "center", gap: "0.4rem",
                  fontWeight: 600, padding: "0.625rem 1.25rem", borderRadius: "0.6rem",
                  fontSize: "0.875rem", textDecoration: "none", transition: "all 0.2s",
                  color: "#c4b5fd",
                  border: "1px solid rgba(139,92,246,0.3)",
                  background: "rgba(124,58,237,0.08)",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(139,92,246,0.6)"; e.currentTarget.style.background = "rgba(124,58,237,0.16)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(139,92,246,0.3)"; e.currentTarget.style.background = "rgba(124,58,237,0.08)"; }}
              >
                <Mail size={14} /> sparmeet162000@gmail.com
              </a>
            </div>
          </FadeIn>
        </div>
      </div>
    </section>
  );
}
