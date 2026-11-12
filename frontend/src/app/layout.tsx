import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "macmini ops board",
  description: "Arr Dashboard — ObsidianUI rebuild",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "macmini",
    statusBarStyle: "black-translucent",
  },
  other: {
    "apple-mobile-web-app-capable": "yes",
    "mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#080b09",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="board-dark" className="dark" suppressHydrationWarning>
      <body className="h-dvh overflow-hidden antialiased">
        {children}
      </body>
    </html>
  );
}
