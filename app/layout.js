import "./globals.css";

export const metadata = {
  title: "Raio-X de Campanhas — Onfly",
  description: "Negócios por campanha (first_click_utm_campaing), funil de etapas e visão mensal, filtrados por True Data MQL.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
