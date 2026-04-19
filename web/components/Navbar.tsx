"use client";
import { useState, useEffect } from "react";
import { Github, Menu, X } from "lucide-react";

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const links = [
    { label: "Features", href: "#features" },
    { label: "How it works", href: "#how-it-works" },
    { label: "Quick start", href: "#quickstart" },
  ];

  return (
    <nav
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        transition: "all 0.3s",
        background: scrolled ? "rgba(10,10,15,0.85)" : "transparent",
        backdropFilter: scrolled ? "blur(16px)" : "none",
        WebkitBackdropFilter: scrolled ? "blur(16px)" : "none",
        borderBottom: scrolled ? "1px solid rgba(139,92,246,0.12)" : "1px solid transparent",
      }}
    >
      <div
        style={{
          maxWidth: "72rem",
          margin: "0 auto",
          padding: "0 1.5rem",
          height: "4rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        {/* Logo */}
        <a href="#" style={{ display: "flex", alignItems: "center", gap: "0.5rem", textDecoration: "none" }}>
          <img
            src="/logo.png"
            alt="SolveWatch AI"
            style={{ width: 32, height: 32, borderRadius: "0.5rem", objectFit: "cover" }}
          />
          <span style={{ fontWeight: 600, color: "#fff", fontSize: "0.875rem", letterSpacing: "-0.01em" }}>
            SolveWatch <span className="gradient-text">AI</span>
          </span>
        </a>

        {/* Desktop links */}
        <div style={{ display: "flex", alignItems: "center", gap: "2rem" }} className="hide-mobile">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              style={{ fontSize: "0.875rem", color: "#94a3b8", textDecoration: "none", transition: "color 0.2s" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#e2e8f0")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "#94a3b8")}
            >
              {l.label}
            </a>
          ))}
        </div>

        {/* Right CTA */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }} className="hide-mobile">
          <a
            href="https://github.com/parmeet10/solveWatchAi"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.375rem",
              fontSize: "0.875rem",
              padding: "0.5rem 1rem",
              borderRadius: "0.5rem",
              color: "#94a3b8",
              border: "1px solid rgba(139,92,246,0.2)",
              textDecoration: "none",
              transition: "all 0.2s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "#e2e8f0";
              e.currentTarget.style.borderColor = "rgba(139,92,246,0.5)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "#94a3b8";
              e.currentTarget.style.borderColor = "rgba(139,92,246,0.2)";
            }}
          >
            <Github size={15} /> GitHub
          </a>
          <a
            href="#quickstart"
            className="btn-primary"
            style={{
              color: "#fff",
              fontSize: "0.875rem",
              fontWeight: 500,
              padding: "0.5rem 1rem",
              borderRadius: "0.5rem",
              textDecoration: "none",
            }}
          >
            Get Started
          </a>
        </div>

        {/* Mobile toggle */}
        <button
          className="show-mobile"
          style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", padding: "0.25rem" }}
          onClick={() => setMobileOpen((v) => !v)}
        >
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div
          style={{
            padding: "0.5rem 1.5rem 1rem",
            display: "flex",
            flexDirection: "column",
            gap: "1rem",
            background: "rgba(10,10,15,0.95)",
          }}
        >
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              style={{ fontSize: "0.875rem", color: "#94a3b8", textDecoration: "none" }}
              onClick={() => setMobileOpen(false)}
            >
              {l.label}
            </a>
          ))}
          <a
            href="https://github.com/parmeet10/solveWatchAi"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary"
            style={{
              color: "#fff",
              fontSize: "0.875rem",
              fontWeight: 500,
              padding: "0.5rem 1rem",
              borderRadius: "0.5rem",
              textDecoration: "none",
              textAlign: "center",
            }}
          >
            View on GitHub
          </a>
        </div>
      )}
    </nav>
  );
}
