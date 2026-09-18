// @ts-check
import { defineConfig, fontProviders } from "astro/config";

import tailwindcss from "@tailwindcss/vite";

/** @param {number} weight */
const sora = (weight) =>
  `@fontsource/sora/files/sora-latin-${weight}-normal.woff2`;

// https://astro.build/config
export default defineConfig({
  site: "https://causa-mortis-rs.vercel.app",
  build: {
    inlineStylesheets: "always",
  },
  vite: {
    plugins: [tailwindcss()],
  },
  fonts: [
    {
      provider: fontProviders.local(),
      name: "Sora",
      cssVariable: "--font-sora",
      options: {
        variants: [
          { weight: 300, style: "normal", src: [sora(300)] },
          { weight: 400, style: "normal", src: [sora(400)] },
          { weight: 500, style: "normal", src: [sora(500)] },
          { weight: 700, style: "normal", src: [sora(700)] },
          { weight: 800, style: "normal", src: [sora(800)] },
        ],
      },
    },
  ],
});
