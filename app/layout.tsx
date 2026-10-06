import type { Metadata } from "next";
import "./globals.css";
import SplashScreen from "@/components/SplashScreen";

export const metadata: Metadata = {
  title: "Controle Agrícola · CRV Industrial",
  description: "Acompanhamento agrícola da safra — CRV Industrial, Unidade Capinópolis-MG.",
  // o sistema já está em português: sem isso o navegador "traduz" rótulos curtos (Cód. virava Bacalhau)
  other: { google: "notranslate" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" translate="no" suppressHydrationWarning>
      <head>
        {/* aplica o tema escolhido antes da tela abrir, sem piscar */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem("ca_tema")==="escuro")document.documentElement.classList.add("dark")}catch(e){}`,
          }}
        />
      </head>
      <body className="font-sans antialiased">
        <SplashScreen />
        {children}
      </body>
    </html>
  );
}
