import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "اوردرات | Orderat",
  description: "حوّل رسائل العملاء إلى طلبات مؤكدة وخطة يوم واضحة.",
  icons: { icon: "/orderat/favicon.svg" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
