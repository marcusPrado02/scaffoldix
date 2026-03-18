import { defineConfig } from "tsup";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("./package.json", "utf-8")) as { version: string };

export default defineConfig({
  entry: { cli: "src/cli/main.ts" },
  format: ["esm"],
  target: "es2022",
  sourcemap: true,
  clean: true,
  dts: false,
  banner: {
    js: "#!/usr/bin/env node",
  },
  define: {
    __SCAFFOLDIX_VERSION__: JSON.stringify(pkg.version),
  },
});
