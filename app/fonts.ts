import { IBM_Plex_Mono, IBM_Plex_Sans_Arabic, Inter } from "next/font/google";

/** English UI — single primary product font */
export const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

/** Arabic UI — single Arabic product font */
export const ibmPlexSansArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-ibm-plex-sans-arabic",
  display: "swap",
});

/** Clinical / numeric data only */
export const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-ibm-plex-mono",
  display: "swap",
});

export const rasqFontVariables = `${inter.variable} ${ibmPlexSansArabic.variable} ${ibmPlexMono.variable}`;
