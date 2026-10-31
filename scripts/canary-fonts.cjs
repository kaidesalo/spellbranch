// Offline stand-in for Google Fonts, used only by scripts/secret-canary.sh so
// the canary build can run with no network. NEXT_FONT_GOOGLE_MOCKED_RESPONSES
// is next/font's own test hook: it maps each Google Fonts CSS URL to the CSS
// returned here. The font files point at a throwaway loopback server that the
// canary script starts (CANARY_FONT_URL); the build is scanned, never served.
const fontUrl = process.env.CANARY_FONT_URL;
if (!fontUrl) throw new Error("CANARY_FONT_URL is not set (run scripts/secret-canary.sh)");

function face(family, weights) {
  return `@font-face {
  font-family: '${family}';
  font-style: normal;
  font-weight: ${weights};
  font-display: swap;
  src: url(${fontUrl}) format('woff2');
}
`;
}

module.exports = {
  "https://fonts.googleapis.com/css2?family=Figtree:wght@300..900&display=swap":
    face("Figtree", "300 900"),
  "https://fonts.googleapis.com/css2?family=Syne:wght@400..800&display=swap":
    face("Syne", "400 800"),
  "https://fonts.googleapis.com/css2?family=Geist+Mono:wght@100..900&display=swap":
    face("Geist Mono", "100 900"),
};
