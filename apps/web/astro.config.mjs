// @ts-check

import vercel from '@astrojs/vercel';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

// Server output, not static.
//
// Three things force it, and none is negotiable:
//
//  1. **The password gate (T022, HU-07).** A static build would ship every page
//     to the CDN and the middleware would guard nothing.
//  2. **N4.** The database has RLS with no policies and `anon` revoked, so
//     there is no public read. Every quote has to be fetched server-side with a
//     server key, and that key must never reach a browser bundle (plan.md §2.3).
//  3. **Freshness (T026).** The capture runs every 15 minutes; a build-time
//     snapshot would be stale the moment it deployed.
//
// The cost is that every request runs a function. That is the price of not
// having a public read, and it was accepted when N4 was recorded as a risk
// rather than resolved.
export default defineConfig({
  output: 'server',
  adapter: vercel(),
  // The interface is in Spanish (CLAUDE.md); the code is not.
  site: 'https://dolarito.example',
  // Tailwind v4 has no config file: it is a Vite plugin plus an @theme block
  // in global.css. The design tokens live there, not here.
  vite: { plugins: [tailwindcss()] },
  build: {
    // Keep the server entry out of the client graph by default.
    inlineStylesheets: 'auto',
  },
});
