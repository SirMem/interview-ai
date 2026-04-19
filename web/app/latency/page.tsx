import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Why SolveWatch AI is Fast — Latency Deep Dive",
  description:
    "Groq LPU inference, streaming tokens, and LocalAgreement-2 commit-before-silence. How SolveWatch gets answers on screen in under 400 ms.",
};

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section style={{ marginBottom: "2.5rem" }}>
    <h2 style={{ fontSize: "1.25rem", fontWeight: 700, color: "#fff", marginBottom: "1rem", letterSpacing: "-0.01em" }}>
      {title}
    </h2>
    {children}
  </section>
);

const P = ({ children }: { children: React.ReactNode }) => (
  <p style={{ color: "#94a3b8", lineHeight: 1.8, marginBottom: "1rem", fontSize: "0.95rem" }}>{children}</p>
);

const Code = ({ children }: { children: React.ReactNode }) => (
  <code style={{ background: "rgba(124,58,237,0.12)", border: "1px solid rgba(124,58,237,0.2)", borderRadius: 6, padding: "0.15rem 0.45rem", fontSize: "0.85rem", color: "#c4b5fd", fontFamily: "monospace" }}>
    {children}
  </code>
);

const Stat = ({ value, label }: { value: string; label: string }) => (
  <div style={{ background: "rgba(17,17,24,0.8)", border: "1px solid rgba(139,92,246,0.15)", borderRadius: 12, padding: "1.5rem", textAlign: "center" }}>
    <div style={{ fontSize: "2rem", fontWeight: 800, color: "#a855f7", marginBottom: "0.4rem" }}>{value}</div>
    <div style={{ fontSize: "0.8rem", color: "#64748b" }}>{label}</div>
  </div>
);

export default function LatencyPage() {
  return (
    <main style={{ background: "#0a0a0f", minHeight: "100vh", padding: "0 1.5rem 6rem" }}>
      <div style={{ maxWidth: "52rem", margin: "0 auto" }}>

        <div style={{ padding: "2rem 0" }}>
          <Link href="/" style={{ color: "#a855f7", fontSize: "0.85rem", textDecoration: "none", fontWeight: 600 }}>
            ← Back to SolveWatch
          </Link>
        </div>

        <div style={{ marginBottom: "3.5rem", paddingBottom: "2.5rem", borderBottom: "1px solid rgba(139,92,246,0.12)" }}>
          <p style={{ fontSize: "0.75rem", fontWeight: 600, color: "#7c3aed", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "0.75rem" }}>
            Deep dive · Latency
          </p>
          <h1 style={{ fontSize: "clamp(2rem,5vw,3rem)", fontWeight: 800, color: "#fff", letterSpacing: "-0.03em", lineHeight: 1.15, marginBottom: "1.25rem" }}>
            Why SolveWatch answers in under 400 ms
          </h1>
          <p style={{ fontSize: "1.05rem", color: "#64748b", lineHeight: 1.75 }}>
            Three compounding decisions — streaming-first architecture, fast inference providers, and commit-before-silence STT — stack to deliver the answer before the interviewer has finished their sentence.
          </p>
        </div>

        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "1rem", marginBottom: "3rem" }}>
          <Stat value="~200 ms" label="First token (Groq)" />
          <Stat value="~400 ms" label="First token (Gemini Flash)" />
          <Stat value="~1.8 s" label="Full screenshot answer" />
          <Stat value="300 ms" label="STT decode interval" />
        </div>

        <Section title="1. Streaming-first: you read while the model writes">
          <P>
            SolveWatch never waits for the full AI response. The moment the first token arrives, it is forwarded over Socket.IO to the Electron HUD and rendered. In practice, the first few words are visible within 200–400 ms of sending the prompt — the same latency as the AI provider&apos;s first token.
          </P>
          <P>
            The pipeline uses server-sent streaming from every supported provider (<Code>stream: true</Code> for OpenAI/Groq, <Code>streamGenerateContent</Code> for Gemini, <Code>stream: true</Code> for Anthropic). Each token chunk is immediately emitted as a <Code>question_answer_token</Code> Socket.IO event without buffering.
          </P>
        </Section>

        <Section title="2. Groq LPU: the fastest inference available">
          <P>
            Groq&apos;s Language Processing Unit (LPU) is purpose-built for transformer inference. On <Code>llama-3.3-70b-versatile</Code>, Groq consistently returns first tokens in 150–250 ms and generates 500–800 tokens/sec — roughly 5–10× faster throughput than GPU-based providers serving the same model.
          </P>
          <P>
            For an interview answer of ~150 words (~200 tokens), Groq completes the full generation in about 400–600 ms total. The answer is fully visible on screen before most interviewers reach the end of their question.
          </P>
          <P>
            Gemini 2.5 Flash is the fallback — similarly optimised for low latency. GPT-4o mini and Claude Sonnet are in the cascade for reliability, not speed.
          </P>
        </Section>

        <Section title="3. LocalAgreement-2: commit words before silence">
          <P>
            Most STT pipelines flush on silence — they wait until you stop talking, transcribe the whole utterance, then forward it. SolveWatch uses <strong style={{ color: "#e2e8f0" }}>LocalAgreement-2</strong>, a streaming decoder that decodes the rolling audio buffer every 300 ms while you are still speaking.
          </P>
          <P>
            The algorithm compares consecutive decode outputs. A word is <em>committed</em> (treated as final) when it appears in the same position across two successive decodes. Committed words are forwarded to the AI immediately — without waiting for sentence completion or silence.
          </P>
          <P>
            In practice this means the AI prompt often arrives 2–4 seconds earlier than a flush-on-silence approach, giving the model a head start while you are still finishing your sentence. By the time you stop talking, the answer is already streaming.
          </P>
        </Section>

        <Section title="4. Prompt kept lean">
          <P>
            The AI prompt contains: system instructions (~200 tokens), the last 3–5 Q&A pairs from session memory (~400 tokens max), and the current question. Total prompt is typically under 800 tokens. Shorter prompts mean lower time-to-first-token (TTFT) at the provider — every extra 1k tokens adds roughly 50–100 ms TTFT at Groq speeds.
          </P>
          <P>
            Ollama-based conversation summarisation runs asynchronously after an answer is complete — it never blocks the next question&apos;s response path.
          </P>
        </Section>

        <Section title="Provider latency comparison">
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", background: "rgba(17,17,24,0.8)", border: "1px solid rgba(139,92,246,0.15)", borderRadius: 12, overflow: "hidden" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(139,92,246,0.15)" }}>
                  {["Provider / Model", "First token (TTFT)", "Generation speed", "Role in cascade"].map((h) => (
                    <th key={h} style={{ padding: "0.875rem 1rem", textAlign: "left", fontSize: "0.8rem", fontWeight: 700, color: "#64748b" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  ["Groq · llama-3.3-70b", "~150–250 ms", "~600 tok/s", "Primary (fastest)"],
                  ["Gemini 2.5 Flash", "~300–500 ms", "~300 tok/s", "Fallback #2"],
                  ["GPT-4o mini", "~400–700 ms", "~200 tok/s", "Fallback #3"],
                  ["Claude Sonnet", "~500–900 ms", "~150 tok/s", "Fallback #4"],
                  ["Ollama (llama3.2:1b)", "~30–80 ms*", "~60 tok/s", "Offline / classify only"],
                ].map(([provider, ttft, speed, role]) => (
                  <tr key={provider as string} style={{ borderBottom: "1px solid rgba(139,92,246,0.07)" }}>
                    <td style={{ padding: "0.75rem 1rem", color: "#e2e8f0", fontSize: "0.875rem", fontWeight: 600 }}>{provider}</td>
                    <td style={{ padding: "0.75rem 1rem", color: "#a855f7", fontSize: "0.875rem" }}>{ttft}</td>
                    <td style={{ padding: "0.75rem 1rem", color: "#94a3b8", fontSize: "0.875rem" }}>{speed}</td>
                    <td style={{ padding: "0.75rem 1rem", color: "#64748b", fontSize: "0.8rem" }}>{role}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ fontSize: "0.72rem", color: "#334155", marginTop: "0.75rem" }}>* Ollama TTFT on Apple Silicon M-series. Actual figures vary by hardware and network conditions.</p>
          </div>
        </Section>

        <div style={{ display: "flex", gap: "1.5rem", paddingTop: "2.5rem", borderTop: "1px solid rgba(139,92,246,0.12)", flexWrap: "wrap" }}>
          <Link href="/how-it-works" style={{ color: "#a855f7", fontSize: "0.875rem", textDecoration: "none", fontWeight: 600 }}>
            Next: The full pipeline →
          </Link>
          <Link href="/screenshare-invisibility" style={{ color: "#64748b", fontSize: "0.875rem", textDecoration: "none" }}>
            ← Screenshare invisibility
          </Link>
        </div>
      </div>
    </main>
  );
}
