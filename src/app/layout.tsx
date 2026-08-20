import type { Metadata } from "next";
import localFont from "next/font/local";

import "./globals.css";

const DESCRIPTION = "HAM is a group of friends who make things on the internet.";

/**
 * Display face. Bricolage Grotesque is a variable font (weight 400–800) with an
 * optical-size axis, which the browser drives automatically from font-size.
 */
const display = localFont({
  src: "./fonts/BricolageGrotesque-Variable.woff2",
  variable: "--font-ham-display",
  weight: "400 800",
  display: "swap",
  fallback: ["system-ui", "Arial Black", "sans-serif"],
});

/** Body & UI face. Atkinson Hyperlegible, chosen for legibility. */
const body = localFont({
  src: [
    {
      path: "./fonts/AtkinsonHyperlegible-Regular.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "./fonts/AtkinsonHyperlegible-Bold.woff2",
      weight: "700",
      style: "normal",
    },
  ],
  variable: "--font-ham-body",
  display: "swap",
  fallback: ["Verdana", "system-ui", "sans-serif"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://teamham.world"),
  title: "HAM",
  description: DESCRIPTION,
  openGraph: {
    title: "HAM",
    description: DESCRIPTION,
    url: "/",
    siteName: "HAM",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${body.variable} h-full`}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
