/** In-memory BM25 over one field. Built once per process from the packed index. */
export class Bm25Field {
  private readonly postings = new Map<string, { docs: number[]; tfs: number[] }>();
  private readonly lengths: number[];
  private readonly avgLength: number;
  readonly size: number;

  constructor(
    documents: ReadonlyArray<ReadonlyArray<string>>,
    private readonly k1 = 1.2,
    private readonly b = 0.75,
  ) {
    this.size = documents.length;
    this.lengths = documents.map((d) => d.length);
    this.avgLength = this.size === 0 ? 0 : this.lengths.reduce((a, l) => a + l, 0) / this.size;
    documents.forEach((terms, docIndex) => {
      const counts = new Map<string, number>();
      for (const term of terms) counts.set(term, (counts.get(term) ?? 0) + 1);
      for (const [term, tf] of counts) {
        let posting = this.postings.get(term);
        if (posting === undefined) {
          posting = { docs: [], tfs: [] };
          this.postings.set(term, posting);
        }
        posting.docs.push(docIndex);
        posting.tfs.push(tf);
      }
    });
  }

  has(term: string): boolean {
    return this.postings.has(term);
  }

  /** Accumulate weighted BM25 scores for the query terms into `scores`. */
  scoreInto(scores: Float64Array, terms: ReadonlyMap<string, number>): void {
    for (const [term, weight] of terms) {
      const posting = this.postings.get(term);
      if (posting === undefined) continue;
      const df = posting.docs.length;
      const idf = Math.log(1 + (this.size - df + 0.5) / (df + 0.5));
      for (let i = 0; i < posting.docs.length; i += 1) {
        const doc = posting.docs[i]!;
        const tf = posting.tfs[i]!;
        const norm = this.k1 * (1 - this.b + (this.b * this.lengths[doc]!) / this.avgLength);
        scores[doc] = scores[doc]! + weight * idf * ((tf * (this.k1 + 1)) / (tf + norm));
      }
    }
  }
}
