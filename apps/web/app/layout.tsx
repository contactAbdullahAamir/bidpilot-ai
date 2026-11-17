import type { Metadata, Viewport } from "next";
import { ToastProvider } from "../components/ui";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "BidPilot AI", template: "%s · BidPilot AI" },
  description: "Evidence-backed RFP and proposal response orchestration"
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7f3" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1513" }
  ]
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
