import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const accountHosted = Boolean(process.env.NEXT_PUBLIC_WAYMARK_API_URL);

export const metadata: Metadata = {
  title: "Waymark",
  description: accountHosted
    ? "A trip planner with a street map and real road routes. Signed-in trips are saved to your Waymark account."
    : "A local-first trip planner with a street map and real road routes. Your trips stay in this browser.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full`}>
      <body className="h-full antialiased">{children}</body>
    </html>
  );
}
