"use client";
import { Github, Mail, ExternalLink } from "lucide-react";

export default function Footer() {
  return (
    <footer style={{ borderTop: "1px solid rgba(139,92,246,0.1)", padding: "2.5rem 1.5rem" }}>
      <div
        style={{
          maxWidth: "72rem",
          margin: "0 auto",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "1.5rem",
        }}
      >
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: "0.5rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "0.875rem",
              fontWeight: 700,
              background: "linear-gradient(135deg, #7c3aed, #a855f7)",
              color: "#fff",
            }}
          >
            S
          </div>
          <span style={{ fontWeight: 600, color: "#fff", fontSize: "0.875rem" }}>
            SolveWatch <span className="gradient-text">AI</span>
          </span>
          <span
            style={{
              fontSize: "0.7rem",
              padding: "0.15rem 0.5rem",
              borderRadius: "0.25rem",
              background: "rgba(124,58,237,0.12)",
              color: "#c4b5fd",
            }}
          >
            MIT
          </span>
        </div>

        {/* Links */}
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "1.5rem" }}>
          <a
            href="https://portfolio-green-sigma-73.vercel.app"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.375rem",
              fontSize: "0.8rem",
              color: "#64748b",
              textDecoration: "none",
              transition: "color 0.2s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#c4b5fd")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#64748b")}
          >
            <ExternalLink size={13} /> Portfolio
          </a>
          <a
            href="mailto:sparmeet162000@gmail.com?subject=SolveWatch AI"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.375rem",
              fontSize: "0.8rem",
              color: "#64748b",
              textDecoration: "none",
              transition: "color 0.2s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#c4b5fd")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#64748b")}
          >
            <Mail size={13} /> Contact
          </a>
          <a
            href="https://github.com/parmeet10/solveWatchAi"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.375rem",
              fontSize: "0.8rem",
              color: "#64748b",
              textDecoration: "none",
              transition: "color 0.2s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#c4b5fd")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#64748b")}
          >
            <Github size={13} /> GitHub
          </a>
          <span style={{ fontSize: "0.75rem", color: "#334155" }}>
            Built with Whisper · Electron · Node.js
          </span>
        </div>
      </div>
    </footer>
  );
}
