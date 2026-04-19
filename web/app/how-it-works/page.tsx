import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "How SolveWatch AI Works — The Full Pipeline",
  description:
    "From mic audio to streaming answer: VAD, rolling buffer, on-device Whisper, LocalAgreement-2, Node backend, multi-provider AI fallback, and the Electron HUD overlay.",
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

const Step = ({ n, title, children }: { n: number; title: string; children: React.ReactNode }) => (
  <div style={{ display: "flex", gap: "1.25rem", marginBottom: "2rem" }}>
    <div style={{ flexShrink: 0, width: 32, height: 32, borderRadius: "50%", background: "rgba(124,58,237,0.15)", border: "1px solid rgba(124,58,237,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.8rem", fontWeight: 700, color: "#a855f7", marginTop: "0.125rem" }}>
      {n}
    </div>
    <div>
      <h3 style={{ fontWeight: 700, color: "#fff", marginBottom: "0.5rem", fontSize: "1rem" }}>{title}</h3>
      {children}
    </div>
  </div>
);

export default function HowItWorksPage() {
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
            Deep dive · Architecture
          </p>
          <h1 style={{ fontSize: "clamp(2rem,5vw,3rem)", fontWeight: 800, color: "#fff", letterSpacing: "-0.03em", lineHeight: 1.15, marginBottom: "1.25rem" }}>
            The full audio-to-answer pipeline
          </h1>
          <p style={{ fontSize: "1.05rem", color: "#64748b", lineHeight: 1.75 }}>
            Three services — a Python transcriber, a Node.js backend, and an Electron HUD — work together to go from raw microphone audio to streaming AI answers in under a second.
          </p>
        </div>

        {/* Architecture diagram */}
        <div style={{ background: "rgba(17,17,24,0.8)", border: "1px solid rgba(139,92,246,0.15)", borderRadius: 14, padding: "1.75rem", marginBottom: "3rem", fontFamily: "monospace", fontSize: "0.78rem", color: "#94a3b8", lineHeight: 2, overflowX: "auto" }}>
          <div style={{ color: "#a855f7" }}>Microphone</div>
          <div>  ↓ PCM audio (16kHz)</div>
          <div style={{ color: "#e2e8f0" }}>Python Transcriber (FastAPI)</div>
          <div>  ↓ VAD gates noise · rolling 30s deque buffer</div>
          <div>  ↓ Whisper (MLX / openai-whisper) every 300ms</div>
          <div>  ↓ LocalAgreement-2 → committed + tentative words</div>
          <div>  ↓ Socket.IO: stt_partial (every 300ms) / stt_final (silence)</div>
          <div style={{ color: "#e2e8f0" }}>Node.js Backend (Express + Socket.IO)</div>
          <div>  ↓ handleSttFinal() → ai.service.answerInterviewQuestion()</div>
          <div>  ↓ Prompt: system + session memory + question</div>
          <div>  ↓ Provider cascade: Groq → Gemini → OpenAI → Claude</div>
          <div>  ↓ Streams question_answer_token events</div>
          <div style={{ color: "#e2e8f0" }}>Electron HUD (always-on-top · content-protected)</div>
          <div>  ↓ Renders tokens as they arrive</div>
          <div style={{ color: "#4ade80" }}>Answer visible on screen ✓</div>
        </div>

        <Section title="Service 1: Python Transcriber">
          <Step n={1} title="Microphone capture and VAD">
            <P>
              <Code>audio_recorder.py</Code> captures raw PCM at 16 kHz from the default input device (or the device configured in settings). Before any transcription, a Voice Activity Detection model gates the audio — silence, background noise, and non-speech frames are dropped to avoid feeding garbage to Whisper.
            </P>
          </Step>
          <Step n={2} title="Rolling buffer and 300 ms decode loop">
            <P>
              Speech frames are appended to a rolling <Code>deque</Code> buffer (up to ~30 seconds). Every 300 ms, <Code>StreamingSTT</Code> hands the current buffer to Whisper and receives a word-level transcript with timestamps.
            </P>
          </Step>
          <Step n={3} title="LocalAgreement-2: commit before silence">
            <P>
              Each successive decode is compared to the previous. A word at position <em>i</em> is <strong style={{ color: "#e2e8f0" }}>committed</strong> when it matches across two consecutive decodes. Committed words are forwarded to Node as <Code>stt_partial.committed</Code> without waiting for silence. Tentative (not yet agreed) words follow as <Code>stt_partial.tentative</Code>.
            </P>
            <P>
              When 700 ms of silence is detected — or the user presses Cmd+Shift+X — the remaining buffer is force-decoded and emitted as <Code>stt_final</Code>, triggering the AI answer.
            </P>
          </Step>
        </Section>

        <Section title="Service 2: Node.js Backend">
          <Step n={4} title="Receive stt_final and build prompt">
            <P>
              <Code>dataHandler.js</Code> receives the <Code>stt_final</Code> event. It assembles the prompt by combining the current question with conversation memory from <Code>InterviewTranscriptBuffer</Code> — the last 3–5 Q&A pairs plus compressed summaries of older context (~850 tokens max overhead).
            </P>
          </Step>
          <Step n={5} title="Multi-provider AI with streaming">
            <P>
              <Code>ai.service.js</Code> tries the configured provider cascade (default: Groq → Gemini → OpenAI → Claude). The first healthy provider is called with <Code>stream: true</Code>. Each token is immediately forwarded as a <Code>question_answer_token</Code> Socket.IO event to the HUD — no buffering.
            </P>
            <P>
              If a provider errors or rate-limits, it is marked as cooling off and the next one in the cascade is tried. Config hot-reloads on every <Code>fs.watch</Code> event on <Code>api-keys.json</Code> — no restart needed to change providers or keys.
            </P>
          </Step>
          <Step n={6} title="Session memory update">
            <P>
              After <Code>question_answer_complete</Code>, the Q&A pair is stored in <Code>InterviewTranscriptBuffer</Code>. When 5 pairs accumulate, an async Ollama call compresses them into a ~150-token summary. This happens fire-and-forget — it never delays the next answer.
            </P>
          </Step>
        </Section>

        <Section title="Service 3: Electron HUD">
          <Step n={7} title="Always-on-top, content-protected overlay">
            <P>
              The HUD is a frameless Electron window (380×460 px) pinned above all other windows at <Code>screen-saver</Code> level. <Code>setContentProtection(true)</Code> makes it invisible to every software-based screen capture tool. Socket.IO connects over <Code>ws://localhost:4000</Code>.
            </P>
          </Step>
          <Step n={8} title="Live strip + streaming answer render">
            <P>
              <Code>stt_partial</Code> events update the live strip: committed words render bright, tentative words render dim/italic. When <Code>question_answer_token</Code> events arrive, they are appended to the answer card in real time. The card is visible and updating while the model is still generating.
            </P>
          </Step>
        </Section>

        <Section title="Flow 2: Screenshot analysis">
          <P>
            A second, parallel flow handles screenshot-based questions. <Code>screenshot-monitor.service.js</Code> polls the <Code>uploads/</Code> directory. New images are preprocessed with Sharp (contrast enhancement, grayscale) then passed to Tesseract for OCR. The extracted text is treated as the question and sent through the same AI pipeline — same provider cascade, same streaming HUD render.
          </P>
        </Section>

        <div style={{ display: "flex", gap: "1.5rem", paddingTop: "2.5rem", borderTop: "1px solid rgba(139,92,246,0.12)", flexWrap: "wrap" }}>
          <Link href="/screenshare-invisibility" style={{ color: "#a855f7", fontSize: "0.875rem", textDecoration: "none", fontWeight: 600 }}>
            ← How screenshare invisibility works
          </Link>
          <Link href="/latency" style={{ color: "#64748b", fontSize: "0.875rem", textDecoration: "none" }}>
            ← Why it&apos;s fast
          </Link>
        </div>
      </div>
    </main>
  );
}
