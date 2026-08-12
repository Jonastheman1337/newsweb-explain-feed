/**
 * The Newsweb API returns category strings with double-encoded UTF-8
 * (UTF-8 bytes interpreted as Windows-1252, then re-encoded as UTF-8).
 * For example, Å (UTF-8: c3 85) becomes Ã… (c3→U+00C3, 85→U+2026 in CP1252).
 * This reverses the double-encoding so category comparisons work.
 */
const CP1252_TO_BYTE = new Map<number, number>([
  [0x20AC, 0x80], [0x201A, 0x82], [0x0192, 0x83], [0x201E, 0x84],
  [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87], [0x02C6, 0x88],
  [0x2030, 0x89], [0x0160, 0x8A], [0x2039, 0x8B], [0x0152, 0x8C],
  [0x017D, 0x8E], [0x2018, 0x91], [0x2019, 0x92], [0x201C, 0x93],
  [0x201D, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02DC, 0x98], [0x2122, 0x99], [0x0161, 0x9A], [0x203A, 0x9B],
  [0x0153, 0x9C], [0x017E, 0x9E], [0x0178, 0x9F]
]);

export function fixDoubleEncodedUtf8(text: string): string {
  try {
    const bytes = new Uint8Array([...text].map((ch) => {
      const cp = ch.codePointAt(0) ?? 0;
      if (cp <= 0xFF) return cp;
      return CP1252_TO_BYTE.get(cp) ?? 0;
    }));
    // If unmapped characters produced zero bytes, keep the original
    if (bytes.includes(0) && !text.includes("\0")) return text;
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return text;
  }
}
