import { fileURLToPath } from 'node:url';
import { configureDocsIndex } from '../src/docs/store.js';

/** Every test file starts with the committed documentation fixture as the docs index. */
export const DOCS_FIXTURE = fileURLToPath(new URL('./fixtures/docs-index.json', import.meta.url));
configureDocsIndex({ file: DOCS_FIXTURE });
