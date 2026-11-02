import Link from "next/link";

/** Centered card used by every menu page (same look as the main menu), with Exit back to it. */
export default function MenuCard({ title, children, wide = false, testId, right }: { title: string; children: React.ReactNode; wide?: boolean; testId?: string; right?: React.ReactNode }) {
  return (
    <main className="app-shell menu-shell">
      <section className={`menu-card page-card${wide ? " wide" : ""}`} data-testid={testId}>
        <div className="page-bar"><span className="page-bar-side">{right}</span><h1>{title}</h1><span className="page-bar-side end"><Link href="/user-menu" className="page-exit" data-testid="page-exit">Exit</Link></span></div>
        {children}
      </section>
    </main>
  );
}
