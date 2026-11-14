import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';

/*
 * `site` is the one place the public origin is written. The canonical URL, the
 * og:url and the og:image are all derived from it in the layout, so moving the
 * page to another domain is a one-line change here rather than a hunt for hard
 * coded URLs in <head>.
 */
export default defineConfig({
  site: 'https://hilbras-sdk.vercel.app',
  integrations: [sitemap()],
  build: {
    /*
     * The whole stylesheet goes into the HTML. For a site with one page there is
     * nothing to be gained by letting the browser cache it separately, and
     * inlining removes a render-blocking round trip before first paint.
     */
    inlineStylesheets: 'always',
  },
});
