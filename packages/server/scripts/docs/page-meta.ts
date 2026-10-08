/**
 * Page-level metadata derived from the repo path: category, API or SDK name, platform
 * and page type (spec §6). Build-time only.
 */
import { slugify } from './mapping.js';
import type { PageType } from '../../src/docs/types.js';

export interface PageMeta {
  category: string;
  api: string;
  sdk?: string;
  page_type: PageType;
}

/** SDK folders (slugified) → product name and platform. Keys mirror the folder aliases. */
export const SDK_FOLDERS: Record<string, { api: string; sdk: string }> = {
  'maps/mobile-sdks/android': { api: 'Android Maps SDK', sdk: 'Android' },
  'maps/mobile-sdks/ios': { api: 'iOS Maps SDK', sdk: 'iOS' },
  'maps/mobile-sdks/flutter': { api: 'Flutter Maps SDK', sdk: 'Flutter' },
  'maps/mobile-sdks/jetpack-compose': { api: 'Maps SDK Jetpack Compose Extension', sdk: 'Android' },
  'maps/mobile-sdks/web-maps': { api: 'Web Maps SDK', sdk: 'Web' },
  'maps/mobile-sdks/ios-offline-maps': { api: 'iOS Offline Maps', sdk: 'iOS' },
  'routing/mobile-sdks/android': { api: 'Android Navigation SDK', sdk: 'Android' },
  'routing/mobile-sdks/ios': { api: 'iOS Navigation SDK', sdk: 'iOS' },
  'routing/mobile-sdks/flutter': { api: 'Flutter Navigation SDK', sdk: 'Flutter' },
  'routing/mobile-sdks/jetpack': {
    api: 'Navigation SDK Jetpack Compose Extension',
    sdk: 'Android',
  },
  'routing/mobile-sdks/ios-offline-navigation': { api: 'iOS Offline Navigation', sdk: 'iOS' },
  'tracking/mobile-sdks/android': { api: 'Android Tracking SDK', sdk: 'Android' },
  'tracking/mobile-sdks/ios': { api: 'iOS Tracking SDK', sdk: 'iOS' },
  'tracking/mobile-sdks/flutter': { api: 'Flutter Tracking SDK', sdk: 'Flutter' },
};

/** Folders that organise pages rather than name a product. */
const STRUCTURAL = new Set([
  'examples',
  'tutorials',
  'tutorial',
  'references',
  'style-specification',
]);

export function pageMeta(relPath: string): PageMeta {
  const segments = relPath.replace(/\.md$/i, '').split('/');
  const folders = segments.slice(0, -1);
  const category = folders[0] ?? '';
  const slugs = folders.map(slugify);

  let page_type: PageType = 'reference';
  if (slugs.includes('examples')) page_type = 'example';
  else if (slugs.includes('tutorials') || slugs.includes('tutorial')) page_type = 'guide';

  for (let n = slugs.length; n >= 1; n -= 1) {
    const sdk = SDK_FOLDERS[slugs.slice(0, n).join('/')];
    if (sdk) return { category, api: sdk.api, sdk: sdk.sdk, page_type };
  }
  if (slugs[1] === 'mobile-sdks') {
    throw new Error(`no SDK_FOLDERS entry for ${relPath}; add one in scripts/docs/page-meta.ts`);
  }
  const named = folders.filter((f) => !STRUCTURAL.has(slugify(f)));
  return { category, api: named[named.length - 1] ?? category, page_type };
}
