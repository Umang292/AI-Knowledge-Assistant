import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Quill — Your AI document workspace",
  description: "Ask thoughtful questions. Get answers grounded in your documents.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
