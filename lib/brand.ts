// Brand palette (kept from the original theme; white-label)
// (public/brand/fastbreak-logo.png; median of the red and navy pixels).
// The same values are CSS variables in app/globals.css (--brand-*); use these constants
// where CSS variables can't reach (inline styles, email-safe HTML, the customer e-sign page).
export const BRAND = {
  red: "#B12E39", // accent red
  redDark: "#8E2430", // hover/pressed shade of red
  blue: "#26446E", // navy
  blueLight: "#3A5F93", // lighter step of the navy (secondary banners)
  blueDark: "#1B3252", // hover/pressed shade of navy
  gray: "#424649", // secondary text
  ink: "#172033",
  // Not in the logo: Owner asked for the e-signed banner to be green ("like we've made money").
  success: "#2E7D4F",
} as const;

export const LOGO_PATH = "/brand/fastbreak-logo.png";
