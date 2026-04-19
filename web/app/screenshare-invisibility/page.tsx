import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "How Screenshare Invisibility Works — SolveWatch AI",
  description:
    "setContentProtection(true) is an OS-level API that excludes the SolveWatch HUD from Zoom, Meet, Teams, Loom, and OBS — even during full-screen capture.",
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

const CodeBlock = ({ children }: { children: React.ReactNode }) => (
  <pre style={{ background: "rgba(17,17,24,0.9)", border: "1px solid rgba(139,92,246,0.15)", borderRadius: 12, padding: "1.25rem 1.5rem", overflowX: "auto", marginBottom: "1.25rem" }}>
    <code style={{ color: "#c4b5fd", fontSize: "0.85rem", fontFamily: "monospace", lineHeight: 1.7 }}>{children}</code>
  </pre>
);

export default function ScreenshareInvisibilityPage() {
  return (
    <main style={{ background: "#0a0a0f", minHeight: "100vh", padding: "0 1.5rem 6rem" }}>
      <div style={{ maxWidth: "52rem", margin: "0 auto" }}>

        {/* Nav */}
        <div style={{ padding: "2rem 0" }}>
          <Link href="/" style={{ color: "#a855f7", fontSize: "0.85rem", textDecoration: "none", fontWeight: 600 }}>
            ← Back to SolveWatch
          </Link>
        </div>

        {/* Hero */}
        <div style={{ marginBottom: "3.5rem", paddingBottom: "2.5rem", borderBottom: "1px solid rgba(139,92,246,0.12)" }}>
          <p style={{ fontSize: "0.75rem", fontWeight: 600, color: "#7c3aed", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "0.75rem" }}>
            Deep dive · Screenshare invisibility
          </p>
          <h1 style={{ fontSize: "clamp(2rem,5vw,3rem)", fontWeight: 800, color: "#fff", letterSpacing: "-0.03em", lineHeight: 1.15, marginBottom: "1.25rem" }}>
            How the HUD stays invisible — even during full-screen share
          </h1>
          <p style={{ fontSize: "1.05rem", color: "#64748b", lineHeight: 1.75 }}>
            Every screen capture tool — Zoom, Google Meet, Microsoft Teams, Loom, OBS — sees a blank space where the SolveWatch overlay sits. Here&apos;s the exact mechanism that makes it work, and why it&apos;s reliable even during entire screen recording.
          </p>
        </div>

        <Section title="The OS API: setContentProtection">
          <P>
            SolveWatch calls <Code>win.setContentProtection(true)</Code> on the Electron BrowserWindow immediately after creation. This maps to:
          </P>
          <ul style={{ color: "#94a3b8", lineHeight: 1.9, paddingLeft: "1.5rem", marginBottom: "1.25rem", fontSize: "0.95rem" }}>
            <li><strong style={{ color: "#e2e8f0" }}>macOS:</strong> <Code>NSWindow.sharingType = NSWindowSharingNone</Code> — the window compositor marks this layer as excluded from all capture streams.</li>
            <li style={{ marginTop: "0.5rem" }}><strong style={{ color: "#e2e8f0" }}>Windows:</strong> <Code>SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)</Code> — a Win32 API that flags the window as capture-exempt at the HWND level.</li>
          </ul>
          <P>
            These are not heuristics or CSS tricks — they are kernel-level flags that the OS compositor enforces. The capture pipeline (screen recording, screen sharing) reads these flags before compositing frames and omits flagged windows entirely.
          </P>
        </Section>

        <Section title="Why it works for entire screen share, not just window share">
          <P>
            A common misconception is that content protection only blocks window capture (where you pick a specific window). In reality, both <Code>NSWindowSharingNone</Code> and <Code>WDA_EXCLUDEFROMCAPTURE</Code> operate on the <em>compositor layer</em> — the step that assembles all visible windows into the final bitmap that capture tools read from.
          </P>
          <P>
            When you share your entire screen, the screen recording API still asks the compositor for a frame. The compositor produces a frame with the protected window replaced by whatever is behind it (typically your desktop wallpaper or another app). The capture tool never sees the overlay — it receives a frame that was never composed with it.
          </P>
          <P>
            This is the same mechanism used by: Apple Pay sheets, system passcode dialogs, Netflix in Safari (DRM), and banking apps that prevent screenshot of card numbers.
          </P>
        </Section>

        <Section title="The Electron code">
          <P>In <Code>electron/main.js</Code>, the relevant lines:</P>
          <CodeBlock>{`const win = new BrowserWindow({
  width: 380,
  height: 460,
  frame: false,
  alwaysOnTop: true,
  level: 'screen-saver',   // above all other windows
  transparent: true,
  // ...
});

win.setContentProtection(true);  // OS-level capture exclusion`}</CodeBlock>
          <P>
            The <Code>alwaysOnTop: true</Code> with <Code>level: 'screen-saver'</Code> keeps the overlay above system UI. The <Code>setContentProtection(true)</Code> call makes it invisible to any capture pipeline regardless of capture mode.
          </P>
        </Section>

        <Section title="Confirmed working on">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "0.625rem", marginBottom: "1.25rem" }}>
            {["Zoom (window + full screen)", "Google Meet", "Microsoft Teams", "Loom", "OBS Studio", "macOS Screenshot", "Windows Snipping Tool", "Discord Go Live"].map((app) => (
              <div key={app} style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem 0.75rem", borderRadius: 8, background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.15)", fontSize: "0.78rem", color: "#4ade80", fontWeight: 500 }}>
                ✓ {app}
              </div>
            ))}
          </div>
        </Section>

        <Section title="Limitations">
          <P>
            Hardware-level capture bypasses this protection. An external camera pointed at your screen, or a second physical monitor mirrored to a capture card, will show the overlay — because the OS compositor is not involved. For all software-based screen capture (which covers 100% of video interview tools), the protection holds.
          </P>
        </Section>

        {/* Footer nav */}
        <div style={{ display: "flex", gap: "1.5rem", paddingTop: "2.5rem", borderTop: "1px solid rgba(139,92,246,0.12)", flexWrap: "wrap" }}>
          <Link href="/latency" style={{ color: "#a855f7", fontSize: "0.875rem", textDecoration: "none", fontWeight: 600 }}>
            Next: Why SolveWatch is fast →
          </Link>
          <Link href="/how-it-works" style={{ color: "#64748b", fontSize: "0.875rem", textDecoration: "none" }}>
            The full pipeline →
          </Link>
        </div>
      </div>
    </main>
  );
}
