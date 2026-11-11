import { redirect } from "next/navigation";

/** The deck list moved to My cards. Deck pages stay at /decks/[id]. */
export default function DecksIndexRedirect() {
  redirect("/my-cards");
}
