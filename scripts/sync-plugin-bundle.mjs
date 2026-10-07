// Copies the built single-file server into the Claude Code plugin directory, so the
// plugin starts with `node ${CLAUDE_PLUGIN_ROOT}/dist/index.js` — no npx, no network,
// no dependency install at launch. Run after `npm run build`; CI verifies the copy is
// byte-identical to the build output (`--check`).
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';

// The server and its documentation index travel together: the bundle resolves the index
// at ../data/docs-index.json relative to itself.
const files = [
  ['packages/server/dist/index.js', 'distributions/claude-code/dist/index.mjs'],
  ['packages/server/data/docs-index.json', 'distributions/claude-code/data/docs-index.json'],
];
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

if (process.argv.includes('--check')) {
  for (const [built, shipped] of files) {
    if (sha(built) !== sha(shipped)) {
      console.error(
        `${shipped} is out of date — run: npm run build && node scripts/sync-plugin-bundle.mjs`,
      );
      process.exit(1);
    }
    try {
      execFileSync('git', ['ls-files', '--error-unmatch', shipped], { stdio: 'ignore' });
    } catch {
      console.error(
        `${shipped} is not tracked by git — the plugin fetched from GitHub would be incomplete.`,
      );
      process.exit(1);
    }
  }
  console.log(
    'Plugin bundle and documentation index match the build output and are tracked by git.',
  );
} else {
  for (const [built, shipped] of files) {
    mkdirSync(dirname(shipped), { recursive: true });
    copyFileSync(built, shipped);
    console.log(`Copied ${built} -> ${shipped}`);
  }
}
