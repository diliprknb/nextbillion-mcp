/**
 * Shape of the packed documentation index (`data/docs-index.json`), the only thing that
 * crosses from build time (scripts/docs/build-index.ts) to runtime (src/docs/*).
 * Plain chunks, no prebuilt term index: ranking can change without a docs rebuild.
 */
export type PageType = 'reference' | 'example' | 'guide';
export type ChunkType = 'content' | 'example' | 'response_schema';

export interface DocsIndexMeta {
  format: 2;
  /** Commit of nextbillion-ai/nb-public-docs the index was built from. */
  commit_sha: string;
  /** Commit date of that docs commit (deterministic, so rebuilds without changes are no-ops). */
  built_at: string;
  pages: number;
  chunks: number;
  parameters: number;
}

export interface PageRecord {
  /** Slugified repo path without `.md`, e.g. `routing/directions-api/directions-api`. */
  doc_id: string;
  title: string;
  /** Top-level docs folder, e.g. `Routing`, `Places`, `Map Data`. */
  category: string;
  /** Product or SDK the page belongs to, e.g. `Directions API`, `Android Maps SDK`. */
  api: string;
  /** Platform for SDK pages: `Android`, `iOS`, `Flutter`, `Web`. Absent for REST pages. */
  sdk?: string;
  page_type: PageType;
  source_url: string;
  /** Repo-relative path of the Markdown file. */
  path: string;
  /** Section outline: H1 to H3 headings in document order. */
  sections: SectionRecord[];
}

export interface SectionRecord {
  heading: string;
  level: number;
  /** Fragment id the live site uses for the heading. */
  anchor: string;
}

export interface ChunkRecord {
  /** `<doc_id>#<n>`, n counting from 0 within the page. */
  chunk_id: string;
  doc_id: string;
  chunk_type: ChunkType;
  /** Open headings from H1 down to the chunk's own H2/H3. */
  heading_path: string[];
  /** Verbatim Markdown lines; joining a page's chunks with `\n` reproduces the page. */
  text: string;
}

/** One request parameter of a REST endpoint, parsed from a reference page table (spec §6). */
export interface ParameterRecord {
  /** `<api-slug>[/<variant>]`, e.g. `directions/flexible`, `geofence/create`. */
  endpoint: string;
  name: string;
  type: string | null;
  /** null when the table layout does not state it. */
  required: boolean | null;
  default: string | null;
  allowed_values: string[];
  example?: string;
  minimum?: string;
  maximum?: string;
  /** Unit stated in the docs; null when not stated (never inferred). */
  units: string | null;
  location: 'query' | 'body' | 'path' | null;
  description: string;
  heading_path: string[];
  doc_id: string;
}

export interface DocsIndexFile {
  meta: DocsIndexMeta;
  pages: PageRecord[];
  chunks: ChunkRecord[];
  parameters: ParameterRecord[];
}
