import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

export const metadata: Metadata = {
  title: "Pord | ویرایشگر سند فارسی — ساخت PDF و Word",
  description:
    "Pord (Persian Word) — ساخت و خروجی گرفتن از اسناد حرفه‌ای PDF و Word فارسی با تم و فونت سایت. افزودن و جابجایی بلوک‌ها و عکس‌ها با درگ اند دراپ.",
  keywords: [
    "Pord",
    "Persian Word",
    "ویرایشگر سند فارسی",
    "PDF",
    "Word",
    "Vazirmatn",
    "ساخت PDF",
    "خروجی سند",
  ],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <body className="antialiased">{children}</body>
    </html>
  );
}
