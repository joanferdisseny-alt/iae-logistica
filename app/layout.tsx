import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "IAE Logistica",
  description: "Inventario y logistica para operaciones de rescate con Supabase y Vercel."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className="ec-body">{children}</body>
    </html>
  );
}
