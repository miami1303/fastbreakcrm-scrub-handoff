import { LOGO_PATH } from "@/lib/brand";

/** The Fast Break logo (from fastbreakcrm.test), used in CRM headers. */
export default function BrandLogo({ height = 44 }: { height?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={LOGO_PATH} alt="Fastbreak CRM" height={height} style={{ height, width: "auto", display: "block" }} />;
}
