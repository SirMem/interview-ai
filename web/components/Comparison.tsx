"use client";
import type { CSSProperties } from "react";
import { Check, X, Minus } from "lucide-react";
import FadeIn from "./FadeIn";

type CellValue = true | false | null | string;

const rows: { label: string; sub?: string; solvewatch: CellValue; cluely: CellValue; parakeet: CellValue }[] = [
  { label: "Price",              solvewatch: "Free (MIT)",   cluely: "$29–$49/mo",   parakeet: "$20–$40/mo" },
  { label: "API cost",           sub: "who pays the LLM bill", solvewatch: "Your keys only", cluely: "Included (their cloud)", parakeet: "Included (their cloud)" },
  { label: "Open source",        solvewatch: true,           cluely: false,          parakeet: false },
  { label: "Invisible in screen share", sub: "full screen + window", solvewatch: true, cluely: true, parakeet: true },
  { label: "Offline STT",        sub: "transcription without internet", solvewatch: true, cluely: false, parakeet: false },
  { label: "Fully offline mode", sub: "AI answers without internet (Ollama)", solvewatch: true, cluely: false, parakeet: false },
  { label: "Custom AI provider", sub: "bring your own OpenAI / Groq / etc.", solvewatch: true, cluely: false, parakeet: false },
  { label: "Response latency",   sub: "first token", solvewatch: "~200–400 ms", cluely: "~600–1200 ms", parakeet: "~500–900 ms" },
  { label: "Screenshot OCR",     sub: "analyse a coding problem on screen", solvewatch: true, cluely: true, parakeet: null },
  { label: "macOS support",      solvewatch: true,           cluely: true,           parakeet: true },
  { label: "Windows support",    solvewatch: true,           cluely: true,           parakeet: null },
];

function Cell({ value }: { value: CellValue }) {
  if (value === true)
    return <Check size={16} style={{ color: "#4ade80", margin: "0 auto", display: "block" }} />;
  if (value === false)
    return <X size={16} style={{ color: "#f87171", margin: "0 auto", display: "block" }} />;
  if (value === null)
    return <Minus size={16} style={{ color: "#475569", margin: "0 auto", display: "block" }} />;
  return <span style={{ color: "#e2e8f0", fontSize: "0.8rem" }}>{value}</span>;
}

const colStyle: CSSProperties = {
  padding: "0.875rem 1rem",
  textAlign: "center",
  verticalAlign: "middle",
  borderBottom: "1px solid rgba(139,92,246,0.08)",
};

const hdrStyle: CSSProperties = {
  padding: "1rem",
  textAlign: "center",
  fontWeight: 700,
  fontSize: "0.85rem",
  color: "#fff",
};

export default function Comparison() {
  return (
    <section
      id="comparison"
      style={{
        padding: "6rem 1.5rem",
        background: "linear-gradient(135deg, rgba(124,58,237,0.04) 0%, rgba(168,85,247,0.02) 100%)",
        borderTop: "1px solid rgba(139,92,246,0.1)",
      }}
    >
      <div style={{ maxWidth: "72rem", margin: "0 auto" }}>
        <FadeIn>
          <div style={{ textAlign: "center", marginBottom: "3.5rem" }}>
            <p style={{ fontSize: "0.8rem", fontWeight: 600, color: "#a855f7", marginBottom: "0.75rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              How we compare
            </p>
            <h2 style={{ fontSize: "clamp(1.75rem,4vw,2.5rem)", fontWeight: 800, color: "#fff", marginBottom: "1rem", letterSpacing: "-0.02em" }}>
              SolveWatch vs Cluely vs Parakeet
            </h2>
            <p style={{ fontSize: "1rem", color: "#64748b", maxWidth: "36rem", margin: "0 auto" }}>
              The tools are similar on the surface. The differences are in cost, latency, and how much you trust a closed cloud with your interview audio.
            </p>
          </div>
        </FadeIn>

        <FadeIn delay={0.1}>
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                background: "rgba(17,17,24,0.8)",
                backdropFilter: "blur(12px)",
                border: "1px solid rgba(139,92,246,0.15)",
                borderRadius: "1rem",
                overflow: "hidden",
              }}
            >
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(139,92,246,0.2)" }}>
                  <th style={{ ...hdrStyle, textAlign: "left", color: "#64748b", fontWeight: 500, width: "36%" }}>Feature</th>
                  <th style={{ ...hdrStyle, background: "rgba(124,58,237,0.1)" }}>
                    <span style={{ color: "#a855f7" }}>SolveWatch</span>
                    <div style={{ fontSize: "0.7rem", fontWeight: 500, color: "#64748b", marginTop: "0.2rem" }}>open-source</div>
                  </th>
                  <th style={hdrStyle}>
                    Cluely
                    <div style={{ fontSize: "0.7rem", fontWeight: 500, color: "#64748b", marginTop: "0.2rem" }}>closed / paid</div>
                  </th>
                  <th style={hdrStyle}>
                    Parakeet
                    <div style={{ fontSize: "0.7rem", fontWeight: 500, color: "#64748b", marginTop: "0.2rem" }}>closed / paid</div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.label} style={{ transition: "background 0.15s" }}>
                    <td
                      style={{
                        ...colStyle,
                        textAlign: "left",
                        paddingLeft: "1.25rem",
                      }}
                    >
                      <span style={{ fontWeight: 600, color: "#e2e8f0", fontSize: "0.875rem" }}>{row.label}</span>
                      {row.sub && (
                        <div style={{ fontSize: "0.72rem", color: "#475569", marginTop: "0.15rem" }}>{row.sub}</div>
                      )}
                    </td>
                    <td style={{ ...colStyle, background: "rgba(124,58,237,0.05)" }}>
                      <Cell value={row.solvewatch} />
                    </td>
                    <td style={colStyle}>
                      <Cell value={row.cluely} />
                    </td>
                    <td style={colStyle}>
                      <Cell value={row.parakeet} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ textAlign: "center", fontSize: "0.72rem", color: "#334155", marginTop: "1rem" }}>
            Competitor data based on publicly available pricing and feature pages. Latency figures are approximate and vary by model and network.
          </p>
        </FadeIn>
      </div>
    </section>
  );
}
