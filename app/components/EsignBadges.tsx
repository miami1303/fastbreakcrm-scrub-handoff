// Small e-sign indicators: green "$" = contract/job order e-signed, blue "CC" = CC form e-signed.
export default function EsignBadges({ quote, cc, caption = true }: { quote: boolean; cc: boolean; caption?: boolean }) {
  if (!quote && !cc) return null;
  return (
    <span className="esign-badges" data-testid="esign-badges">
      <span className="boxes">
        {quote && <span className="esign-box green" title="Contract e-signed" aria-label="Contract e-signed">$</span>}
        {cc && <span className="esign-box blue" title="CC form e-signed" aria-label="CC form e-signed">CC</span>}
      </span>
      {caption && <small>E-sign received</small>}
    </span>
  );
}
