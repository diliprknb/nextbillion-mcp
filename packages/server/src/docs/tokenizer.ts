/**
 * One tokenizer for index and query time (spec §7). Identifiers such as `truck_weight`
 * or `option=flexible` are kept whole *and* split into parts; whole-identifier matches
 * are weighted higher by the search. Ordinary words are lower-cased, stop words and
 * question words dropped, and lightly stemmed (polygons → polygon, routing → rout).
 * Identifiers and words containing digits are never stemmed.
 */

/** Characters that join the parts of an identifier. */
const IDENTIFIER = /[a-z0-9]+(?:[_.\-=:/][a-z0-9]+)*/g;
const JOINER = /[_.\-=:/]/;

const STOPWORDS = new Set(
  (
    'a an the and or but if then else of to in on at by for with from as is are was were be been ' +
    'being do does did done can could should would will shall may might must have has had having ' +
    'i me my we our you your it its this that these those there here which what when where who ' +
    'whom whose why how any some all each both either neither not no yes so than too very just ' +
    'also only own same such into onto over under about above below between through during ' +
    'before after again further once up down out off while because until want need like ' +
    'please tell show give get got let make made using use used us them they their he she his her'
  ).split(' '),
);

export function stem(word: string): string {
  let w = word;
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && /(ss|ch|sh|x|z)es$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s') && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1);
  if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2);
  if (w.length > 4 && w.endsWith('e')) w = w.slice(0, -1);
  return w;
}

export interface TokenizeOptions {
  stem?: boolean;
}

function word(token: string, options: TokenizeOptions): string | undefined {
  if (/\d/.test(token)) return token;
  if (token.length < 2 || STOPWORDS.has(token)) return undefined;
  return options.stem === false ? token : stem(token);
}

/** Terms for one piece of text: whole identifiers plus their parts, and stemmed words. */
export function tokenize(text: string, options: TokenizeOptions = {}): string[] {
  const terms: string[] = [];
  for (const match of text.toLowerCase().matchAll(IDENTIFIER)) {
    const token = match[0];
    if (JOINER.test(token)) {
      terms.push(token);
      for (const part of token.split(JOINER)) {
        const term = word(part, options);
        if (term !== undefined) terms.push(term);
      }
      continue;
    }
    const term = word(token, options);
    if (term !== undefined) terms.push(term);
  }
  return terms;
}

/** True for a term that is a whole identifier (contains a joiner), e.g. `truck_weight`. */
export function isIdentifier(term: string): boolean {
  return JOINER.test(term);
}
