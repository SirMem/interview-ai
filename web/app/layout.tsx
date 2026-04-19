import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SolveWatch AI — Invisible AI for Interviews",
  description:
    "Real-time interview assistant. Live transcription → instant AI answers → stealth HUD overlay. Completely invisible in Zoom, Meet, and every screenshare tool.",
  openGraph: {
    title: "SolveWatch AI",
    description: "The invisible AI layer for your next technical interview.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
