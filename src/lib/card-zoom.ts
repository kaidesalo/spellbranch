/**
 * What the card zoom lightbox shows: the card's name and one large image per
 * face. Double-faced cards (transform, modal DFC) have two faces; everything
 * else has one.
 *
 * Two sources feed it:
 * - Saved cards (deck list, compare, commander, favorites) only keep the
 *   Scryfall "normal" image URL, so we point the same URL at the "large"
 *   size and keep the original as a fallback if the large one fails.
 * - Live Scryfall results (search, commander picker) carry every size and,
 *   for double-faced cards, card_faces[i].image_uris.
 */

export interface ZoomFace {
  /** Face name, e.g. "Delver of Secrets" / "Insectile Aberration". */
  name: string;
  src: string;
  /** Smaller image to show if `src` fails to load; null when there's none. */
  fallbackSrc: string | null;
}

export interface ZoomCard {
  name: string;
  faces: ZoomFace[];
}

/** The image sizes we read from a Scryfall card or face. */
interface ScryfallImageUris {
  small?: string;
  normal?: string;
  large?: string;
  png?: string;
}

/** The parts of a Scryfall card the zoom needs (ScryfallCard fits). */
export interface ScryfallZoomSource {
  name: string;
  image_uris?: ScryfallImageUris;
  card_faces?: Array<{ name?: string; image_uris?: ScryfallImageUris }>;
}

// https://cards.scryfall.io/normal/front/a/b/<id>.jpg?123 -> /large/...
const SCRYFALL_SIZED_IMAGE = /^https:\/\/cards\.scryfall\.io\/(small|normal)\//;

/**
 * The "large" (672×936) version of a Scryfall card image URL. URLs that
 * aren't sized Scryfall card images come back unchanged.
 */
export function largeScryfallImage(url: string): string {
  return url.replace(SCRYFALL_SIZED_IMAGE, "https://cards.scryfall.io/large/");
}

/** Zoom data for a saved card; null when the card has no image. */
export function zoomCardFromSaved(
  name: string,
  imageUri: string | null | undefined,
): ZoomCard | null {
  if (!imageUri) return null;
  const large = largeScryfallImage(imageUri);
  return {
    name,
    faces: [{ name, src: large, fallbackSrc: large === imageUri ? null : imageUri }],
  };
}

function faceFromUris(name: string, uris: ScryfallImageUris | undefined): ZoomFace | null {
  const src = uris?.large || uris?.png || uris?.normal || uris?.small;
  if (!src) return null;
  const fallback = uris?.normal || uris?.small || null;
  return { name, src, fallbackSrc: fallback === src ? null : fallback };
}

/**
 * Zoom data for a live Scryfall card. A card with its own image_uris (normal
 * cards, split and adventure cards) has one face; otherwise each card face
 * with an image becomes a face. Null when there's no image at all.
 */
export function zoomCardFromScryfall(card: ScryfallZoomSource): ZoomCard | null {
  const single = faceFromUris(card.name, card.image_uris);
  if (single) return { name: card.name, faces: [single] };

  const faces = (card.card_faces ?? [])
    .map((face, i) => faceFromUris(face.name || `${card.name} (face ${i + 1})`, face.image_uris))
    .filter((face): face is ZoomFace => face !== null);
  return faces.length > 0 ? { name: card.name, faces } : null;
}
