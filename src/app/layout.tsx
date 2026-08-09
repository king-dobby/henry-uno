import type { Metadata } from "next";
import "./globals.css";
import TelemetryProvider from "@/components/TelemetryProvider";

export const metadata: Metadata = {
  title: "Henry Portal",
  description: "Your shared workspace powered by Henry",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body>
        <TelemetryProvider />
        {children}
      </body>
    </html>
  );
}
