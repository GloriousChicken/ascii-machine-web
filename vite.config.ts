import { defineConfig } from "vite";

// `base: "./"` makes every asset URL relative, so the same build works from a
// GitHub Pages project subpath (https://user.github.io/repo/) and from a
// custom domain root. An absolute base would break one of the two.
export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    assetsInlineLimit: 0,
  },
});
