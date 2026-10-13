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
    // The plugin's own name is a proper noun: "Find & Replace" stays as written in tooltips, titles and notices. Add other brand names and acronyms here as they come up.
    rules: {
      "obsidianmd/ui/sentence-case": ["warn", { brands: ["Find & Replace"], acronyms: [] }],
    },
  },
  {
    ignores: ["main.js", "node_modules/", "scripts/", "version-bump.mjs", "esbuild.config.mjs"],
  },
]);
