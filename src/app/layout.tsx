import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Relay · File & Image Toolkit",
  description:
    "Copy, organise, inspect. A practical workspace for Google Drive datasets.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
