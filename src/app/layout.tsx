import type { Metadata } from "next";
import "./globals.css";
import { Suspense } from "react";
import { AppNav } from "@/components/nav/app-nav";

export const metadata: Metadata = {
  title: "Backtester",
  description: "Backtest, optimise and compare trading strategies on historical prices.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <Suspense fallback={null}>
          <AppNav />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
