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

function faces(family, weights) {
  return weights.map((weight) => face(family, weight)).join("");
}

module.exports = {
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap":
    faces("Inter", ["400", "500", "600"]),
  "https://fonts.googleapis.com/css2?family=Cinzel:wght@600&display=swap":
    face("Cinzel", "600"),
  "https://fonts.googleapis.com/css2?family=Geist+Mono:wght@100..900&display=swap":
    face("Geist Mono", "100 900"),
};
