import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "FORM — Your virtual fitting studio",
  description:
    "Create a measurement-driven mannequin, customise garments and preview your designs in 3D.",
  icons: { icon: "/favicon.svg" },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
