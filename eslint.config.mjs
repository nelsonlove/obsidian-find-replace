// The Obsidian team's official rules for community plugins (github.com/obsidianmd/eslint-plugin): command ids and names, sentence case in UI strings, no global `app`, forbidden DOM, view and component cleanup, platform guards, manifest and LICENSE shape.
// Install: npm i -D eslint eslint-plugin-obsidianmd
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  ...obsidianmd.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.*"],
        },
      },
    },
  },
  {
    ignores: ["main.js", "node_modules/", "scripts/", "version-bump.mjs", "esbuild.config.mjs"],
  },
]);
