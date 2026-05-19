import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://jmbt.dev',
  output: 'static',
  integrations: [sitemap()],
  build: {
    inlineStylesheets: 'always'
  },
  compressHTML: true
});
