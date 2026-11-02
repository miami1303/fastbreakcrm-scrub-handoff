import TabLinks from "@/app/components/TabLinks";
import IdleSignOut from "@/app/components/IdleSignOut";
import type { Metadata } from "next";
import "./globals.css";

// Explicit viewport (customer e-sign pages open on phones from the email).
export const viewport = { width: "device-width", initialScale: 1 };

export const metadata: Metadata = {
  title: "Fastbreak CRM",
  description: "Fastbreak CRM",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><TabLinks /><IdleSignOut />{children}</body></html>;
}
