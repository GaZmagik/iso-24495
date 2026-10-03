import { codeSpanEnds, inlineText } from "./parse.ts";
import entities from "./html-entities.json";

interface Run { marker: string; length: number; original: number; open: boolean; close: boolean }
interface Token { text: string; literal: boolean; run?: Run }
const ESCAPABLE = /^[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]$/;
const PUNCTUATION = /[\p{P}\p{S}]/u;

/** Render wording without interpreting escaped punctuation or code as emphasis. */
export function renderInline(source: string): string {
  const text = inlineText(source);
  const spans = codeSpanEnds(text);
  const tokens: Token[] = [];
  for (let index = 0; index < text.length;) {
    if (text[index] === "\\" && ESCAPABLE.test(text[index + 1] ?? "")) {
      tokens.push({ text: text[index + 1], literal: true });
      index += 2;
      continue;
    }
    const span = spans.get(index);
    if (span !== undefined) {
      const ticks = /^`+/.exec(text.slice(index))[0].length;
      let content = text.slice(index + ticks, span - ticks).replace(/\r\n|\r|\n/g, " ");
      if (content.startsWith(" ") && content.endsWith(" ") && /\S/.test(content)) content = content.slice(1, -1);
      tokens.push({ text: content, literal: true });
      index = span;
      continue;
    }
    if (text[index] === "*" || text[index] === "_") {
      const marker = text[index];
      let end = index + 1;
      while (text[end] === marker) end++;
      const before = [...text.slice(0, index)].at(-1) ?? " ";
      const after = [...text.slice(end)][0] ?? " ";
      const left = !/\s/.test(after) && (!PUNCTUATION.test(after) || /\s/.test(before) || PUNCTUATION.test(before));
      const right = !/\s/.test(before) && (!PUNCTUATION.test(before) || /\s/.test(after) || PUNCTUATION.test(after));
      const length = end - index;
      tokens.push({ text: marker.repeat(length), literal: true, run: { marker, length, original: length, open: left && (marker === "*" || !right || PUNCTUATION.test(before)), close: right && (marker === "*" || !left || PUNCTUATION.test(after)) } });
      index = end;
      continue;
    }
    const previous = tokens.at(-1);
    if (previous !== undefined && !previous.literal) previous.text += text[index];
    else tokens.push({ text: text[index], literal: false });
    index++;
  }
  for (let closing = 0; closing < tokens.length; closing++) {
    const closer = tokens[closing].run;
    if (closer === undefined || !closer.close) continue;
    for (let opening = closing - 1; opening >= 0 && closer.length > 0; opening--) {
      const opener = tokens[opening].run;
      if (opener === undefined || !opener.open || opener.marker !== closer.marker || opener.length === 0) continue;
      // CommonMark's rule of three keeps ambiguous intraword runs literal.
      if ((opener.close || closer.open) && (opener.original + closer.original) % 3 === 0 && (opener.original % 3 !== 0 || closer.original % 3 !== 0)) continue;
      const used = opener.length >= 2 && closer.length >= 2 ? 2 : 1;
      opener.length -= used;
      closer.length -= used;
      tokens[opening].text = opener.marker.repeat(opener.length);
      tokens[closing].text = closer.marker.repeat(closer.length);
      for (let inside = opening + 1; inside < closing; inside++) tokens[inside].run = undefined;
      if (opener.length > 0) opening++;
    }
  }
  return tokens.map(token => token.literal ? token.text : decodeEntities(token.text)).join("");
}

function decodeEntities(text: string): string {
  return text.replace(/&(#(?:x[0-9a-f]+|\d+)|[a-z][a-z0-9]+);/gi, (whole, name: string) => {
    if (!name.startsWith("#")) return (entities as Record<string, string>)[`${name};`] ?? whole;
    const point = name[1].toLowerCase() === "x" ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
    return point === 0 || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff) ? "\ufffd" : String.fromCodePoint(point);
  });
}
