"use client";

// Keeps the customer document on ONE printed letter page: when long Extra Stop / Notes
// make the sheet taller than a page, printing scales it down just enough (never up).
import { useEffect } from "react";

const PAGE_PX = 960; // letter page minus 0.4in margins, at 96 dpi, with a little slack

export default function PrintFit() {
  useEffect(() => {
    const fit = () => {
      const sheet = document.querySelector<HTMLElement>(".doc-sheet");
      if (!sheet) return;
      const h = sheet.scrollHeight;
      document.documentElement.style.setProperty("--print-zoom", String(h > PAGE_PX ? Math.max(0.6, PAGE_PX / h) : 1));
    };
    fit();
    window.addEventListener("resize", fit);
    window.addEventListener("beforeprint", fit);
    return () => { window.removeEventListener("resize", fit); window.removeEventListener("beforeprint", fit); };
  }, []);
  return null;
}
