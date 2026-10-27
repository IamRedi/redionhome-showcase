import { sq, type MessageKey } from "./sq.ts";
import { de } from "./de.ts";
import { en } from "./en.ts";
export type Locale = "sq" | "de" | "en";
export const catalogs: Record<Locale, Record<MessageKey, string>> = {
  sq,
  de,
  en,
};
// Albanian is the only enabled product locale. Full copy extraction precedes a locale selector.
export const messages = catalogs.sq;
