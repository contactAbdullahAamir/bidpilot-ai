const STOPWORDS = new Set(
  "a an and are as at be been being but by can could do does for from had has have how if in into is it its may must no not of on or our shall should such than that the their them then there these they this those to under up was we were what when where which while who will with within would you your all any each other per via including include provide provided ensure able also vendor vendors solution proposed proposal department current least".split(
    " "
  )
);

export function keywords(text: string): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9.\s-]/g, " ")
        .split(/[\s-]+/)
        .map((t) => t.replace(/^\.+|\.+$/g, ""))
        .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    )
  );
}

/** Fraction of `a`'s keywords that appear in `b`. */
export function overlap(a: string, b: string): number {
  const ka = keywords(a);
  if (ka.length === 0) return 0;
  const kb = new Set(keywords(b));
  return ka.filter((k) => kb.has(k)).length / ka.length;
}

export function sentences(text: string): string[] {
  return text
    .split(/\n+/)
    // Split at sentence ends, but never right after a list code such as "M-2." or "4.".
    .flatMap((line) => line.split(/(?<=[.!?;])(?<!^\s*(?:[A-Z]{1,4}-?)?\d{1,3}[.)])\s+(?=[A-Z(])/))
    .map((s) => s.trim())
    .filter((s) => s.length > 3);
}

export function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
