import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SME Workspace Sentinel",
  description: "AI DLP and SOC2 readiness evidence pack for Google Workspace.",
  icons: {
    icon: "/favicon.svg"
  }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
