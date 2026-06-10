import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Genzzz!!",
  description: "A navy and white AI chat interface.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
