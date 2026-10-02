import type { Metadata } from "next";
import "./globals.css";
import SplashScreen from "@/components/SplashScreen";

export const metadata: Metadata = {
  title: "Controle Agrícola · CRV Industrial",
  description: "Acompanhamento agrícola da safra — CRV Industrial, Unidade Capinópolis-MG.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="font-sans antialiased">
        <SplashScreen />
        {children}
      </body>
    </html>
  );
}
