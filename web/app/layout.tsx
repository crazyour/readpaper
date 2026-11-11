import type { Metadata, Viewport } from "next";
import "./globals.css";
import ThemeScript from "@/components/ThemeScript";
import RootProviders from "@/components/RootProviders";

export const viewport: Viewport = { interactiveWidget: "resizes-content" };

export const metadata: Metadata = {
  title: "论文精读训练",
  description: "通过聚焦提问与反馈，深入理解研究论文。",
  icons: {
    icon: [
      { url: "/brand/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/brand/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: "/brand/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      suppressHydrationWarning
      data-scroll-behavior="smooth"
    >
      <head>
        <ThemeScript />
      </head>
      <body
        className="font-sans bg-[var(--background)] text-[var(--foreground)]"
        suppressHydrationWarning
      >
        <RootProviders>{children}</RootProviders>
      </body>
    </html>
  );
}
