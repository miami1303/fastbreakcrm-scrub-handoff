"use client";

/** Small "Route" pill next to the miles: opens the driving route in Google Maps in a NEW TAB
 *  (next to this one; plain target=_blank, no popup window). With no usable address it still
 *  opens Google Maps so the rep can search. Generic red map-pin icon (not Google's logo). */
export default function RouteMapButton({ href, label = "Route", testId = "route-map", title = "Open route in Google Maps (new tab)" }: { href: string; label?: string; testId?: string; title?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="route-pill" title={title} data-testid={testId}>
      <svg width="12" height="14" viewBox="0 0 12 16" aria-hidden="true"><path d="M6 0C2.7 0 0 2.6 0 5.9 0 10.3 6 16 6 16s6-5.7 6-10.1C12 2.6 9.3 0 6 0Z" fill="#EA4335" /><circle cx="6" cy="5.9" r="2.2" fill="#fff" /></svg>
      <span>{label}</span>
    </a>
  );
}
