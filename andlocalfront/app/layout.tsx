import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Portal de clientes | AND Local Ads",
  description: "Acceso a las cuentas prepago y Flex de AND Local Ads",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
