/**
 * Quote marks as a keyboard types them.
 *
 * A phone keyboard, Word and WhatsApp turn " into ” or “ as you type, and
 * people write inches as ″ - all of which look like the same mark on screen
 * but are different characters. So an item made on a phone as 6MM*8” Bolt
 * could not be found by searching 6MM*8" on the website (21 Oct 2026:
 * MRPPL-ENG-933). Names are stored with plain quotes, and searches compare
 * with them, so it does not matter which one somebody typed.
 */
const DOUBLE = /[“”„‟″‶«»＂]/g;
const SINGLE = /[‘’‚‛′‵＇]/g;

/** The text with every look-alike double quote as " and single quote as '. */
export const plainQuotes = (value) =>
  String(value ?? "").replace(DOUBLE, '"').replace(SINGLE, "'");
