import { ItemView, Notice, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import {
  Match,
  MatchMode,
  applyReplacements,
  buildMatcher,
  expandReplacement,
  findMatches,
} from "./replace";

const VIEW_TYPE = "find-replace-view";
/** Cap on matches collected per search, to keep the UI responsive. */
const MAX_MATCHES = 2000;
/** Above this many checked matches, Apply asks for a second confirmation. */
const CONFIRM_THRESHOLD = 200;

type Scope = "vault" | "folder" | "file" | "selection";

interface SelectableMatch extends Match {
  checked: boolean;
}

/** A file (or the active selection) with its matches. */
interface Hit {
  /** null for the selection pseudo-scope. */
  file: TFile | null;
  /** Text the matches were computed against (for staleness detection). */
  content: string;
  matches: SelectableMatch[];
}

export default class FindReplacePlugin extends Plugin {
  async onload() {
    this.registerView(VIEW_TYPE, (leaf) => new FindReplaceView(leaf, this));

    this.addRibbonIcon("replace", "Find & Replace", () => this.openPanel());

    this.addCommand({
      id: "open",
      name: "Open Find & Replace panel",
      callback: () => this.openPanel(),
    });

    this.addCommand({
      id: "open-folder",
      name: "Find & Replace in the current file's folder",
      callback: () => {
        const active = this.app.workspace.getActiveFile();
        const folder = active?.parent?.path ?? "";
        this.openPanel({ scope: "folder", folder });
      },
    });
  }

  async openPanel(preset?: { scope: Scope; folder?: string }) {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf(true);
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    workspace.revealLeaf(leaf);
    if (preset && leaf.view instanceof FindReplaceView) {
      leaf.view.applyPreset(preset);
    }
  }
}

class FindReplaceView extends ItemView {
  private plugin: FindReplacePlugin;

  private findInput!: HTMLInputElement;
  private replaceInput!: HTMLInputElement;
  private scopeSelect!: HTMLSelectElement;
  private folderInput!: HTMLInputElement;
  private modeSelect!: HTMLSelectElement;
  private caseToggle!: HTMLInputElement;
  private wordToggle!: HTMLInputElement;
  private resultsEl!: HTMLElement;
  private footerEl!: HTMLElement;

  private hits: Hit[] = [];

  constructor(leaf: WorkspaceLeaf, plugin: FindReplacePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return VIEW_TYPE;
  }
  getDisplayText() {
    return "Find & Replace";
  }
  getIcon() {
    return "replace";
  }

  applyPreset(preset: { scope: Scope; folder?: string }) {
    this.scopeSelect.value = preset.scope;
    if (preset.folder !== undefined) this.folderInput.value = preset.folder;
    this.syncScopeControls();
  }

  async onOpen() {
    const root = this.contentEl;
    root.empty();
    root.addClass("find-replace-view");

    const controls = root.createDiv({ cls: "fr-controls" });

    this.findInput = controls.createEl("input", {
      cls: "fr-input",
      attr: { type: "text", placeholder: "Find" },
    });
    this.replaceInput = controls.createEl("input", {
      cls: "fr-input",
      attr: { type: "text", placeholder: "Replace with" },
    });

    const opts = controls.createDiv({ cls: "fr-options" });
    this.modeSelect = opts.createEl("select", { cls: "fr-mode" });
    this.modeSelect.createEl("option", { text: "Text", value: "text" });
    this.modeSelect.createEl("option", { text: "Regex", value: "regex" });
    this.caseToggle = this.labeledCheckbox(opts, "Aa", "Case-sensitive off = match any case");
    this.wordToggle = this.labeledCheckbox(opts, "\\b", "Whole word");

    const scopeRow = controls.createDiv({ cls: "fr-scope-row" });
    this.scopeSelect = scopeRow.createEl("select", { cls: "fr-scope" });
    this.scopeSelect.createEl("option", { text: "Whole vault", value: "vault" });
    this.scopeSelect.createEl("option", { text: "Folder…", value: "folder" });
    this.scopeSelect.createEl("option", { text: "Current file", value: "file" });
    this.scopeSelect.createEl("option", { text: "Selection", value: "selection" });
    this.folderInput = scopeRow.createEl("input", {
      cls: "fr-input fr-folder",
      attr: { type: "text", placeholder: "folder/path" },
    });
    this.scopeSelect.addEventListener("change", () => this.syncScopeControls());

    const searchBtn = controls.createEl("button", {
      cls: "mod-cta fr-search",
      text: "Search",
    });
    searchBtn.addEventListener("click", () => void this.runSearch());
    this.findInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") void this.runSearch();
    });

    this.resultsEl = root.createDiv({ cls: "fr-results" });
    this.footerEl = root.createDiv({ cls: "fr-footer" });

    this.syncScopeControls();
  }

  private labeledCheckbox(parent: HTMLElement, label: string, title: string) {
    const wrap = parent.createEl("label", { cls: "fr-check", attr: { title } });
    const input = wrap.createEl("input", { attr: { type: "checkbox" } });
    wrap.createSpan({ text: label });
    return input;
  }

  private syncScopeControls() {
    const scope = this.scopeSelect.value as Scope;
    this.folderInput.toggle(scope === "folder");
  }

  private currentOptions() {
    return {
      query: this.findInput.value,
      mode: this.modeSelect.value as MatchMode,
      caseInsensitive: !this.caseToggle.checked,
      wholeWord: this.wordToggle.checked,
    };
  }

  private async filesForScope(scope: Scope): Promise<TFile[]> {
    const { vault, workspace } = this.plugin.app;
    if (scope === "vault") return vault.getMarkdownFiles();
    if (scope === "file") {
      const f = workspace.getActiveFile();
      return f ? [f] : [];
    }
    // folder
    const raw = this.folderInput.value.replace(/\/+$/, "");
    const prefix = raw === "" ? "" : raw + "/";
    return vault
      .getMarkdownFiles()
      .filter((f) => (prefix === "" ? true : f.path.startsWith(prefix)));
  }

  private async runSearch() {
    const built = buildMatcher(this.currentOptions());
    if ("error" in built) {
      new Notice(`Find & Replace: ${built.error}`);
      return;
    }
    const scope = this.scopeSelect.value as Scope;

    this.hits = [];
    let total = 0;
    let capped = false;

    if (scope === "selection") {
      const editor = this.plugin.app.workspace.activeEditor?.editor;
      const text = editor?.getSelection() ?? "";
      if (text === "") {
        new Notice("Find & Replace: no text selected.");
        this.renderResults(0, false);
        return;
      }
      const matches = findMatches(text, built.regex).map((m) => ({
        ...m,
        checked: true,
      }));
      if (matches.length) this.hits.push({ file: null, content: text, matches });
      total = matches.length;
    } else {
      const files = await this.filesForScope(scope);
      for (const file of files) {
        if (total >= MAX_MATCHES) {
          capped = true;
          break;
        }
        const content = await this.plugin.app.vault.cachedRead(file);
        const found = findMatches(content, built.regex);
        if (found.length === 0) continue;
        const room = MAX_MATCHES - total;
        const slice = found.slice(0, room);
        if (slice.length < found.length) capped = true;
        this.hits.push({
          file,
          content,
          matches: slice.map((m) => ({ ...m, checked: true })),
        });
        total += slice.length;
      }
    }

    this.renderResults(total, capped);
  }

  private renderResults(total: number, capped: boolean) {
    this.resultsEl.empty();
    this.footerEl.empty();

    if (total === 0) {
      this.resultsEl.createDiv({ cls: "fr-empty", text: "No matches." });
      return;
    }

    const replacement = this.replaceInput.value;

    for (const hit of this.hits) {
      const fileEl = this.resultsEl.createDiv({ cls: "fr-file" });
      const header = fileEl.createDiv({ cls: "fr-file-header" });
      const fileCheck = header.createEl("input", { attr: { type: "checkbox" } });
      fileCheck.checked = true;
      header.createSpan({
        cls: "fr-file-name",
        text: hit.file ? hit.file.path : "Selection",
      });
      header.createSpan({ cls: "fr-file-count", text: `${hit.matches.length}` });

      const rowEls: HTMLInputElement[] = [];
      for (const m of hit.matches) {
        const row = fileEl.createDiv({ cls: "fr-match" });
        const cb = row.createEl("input", { attr: { type: "checkbox" } });
        cb.checked = m.checked;
        cb.addEventListener("change", () => {
          m.checked = cb.checked;
          this.updateFooter();
        });
        rowEls.push(cb);
        row.createSpan({ cls: "fr-line", text: `${m.line + 1}` });
        const preview = row.createSpan({ cls: "fr-preview" });
        preview.createSpan({ cls: "fr-before", text: m.matched });
        preview.createSpan({ text: " → " });
        preview.createSpan({
          cls: "fr-after",
          text: expandReplacement(m, replacement),
        });
      }

      fileCheck.addEventListener("change", () => {
        for (let i = 0; i < hit.matches.length; i++) {
          hit.matches[i].checked = fileCheck.checked;
          rowEls[i].checked = fileCheck.checked;
        }
        this.updateFooter();
      });
    }

    if (capped) {
      this.resultsEl.createDiv({
        cls: "fr-capped",
        text: `Showing the first ${MAX_MATCHES} matches — narrow the scope to see all.`,
      });
    }

    this.updateFooter();
  }

  private checkedCount(): number {
    let n = 0;
    for (const hit of this.hits) for (const m of hit.matches) if (m.checked) n++;
    return n;
  }

  private updateFooter() {
    this.footerEl.empty();
    const n = this.checkedCount();
    this.footerEl.createSpan({
      cls: "fr-count",
      text: `${n} match${n === 1 ? "" : "es"} selected`,
    });
    const applyBtn = this.footerEl.createEl("button", {
      cls: "mod-warning fr-apply",
      text: "Apply",
    });
    applyBtn.disabled = n === 0;
    applyBtn.addEventListener("click", () => void this.apply());
  }

  private async apply() {
    const n = this.checkedCount();
    if (n === 0) return;
    if (
      n >= CONFIRM_THRESHOLD &&
      !window.confirm(
        `Replace ${n} matches across ${this.hits.length} location(s)? This cannot be undone in one step.`,
      )
    ) {
      return;
    }

    const replacement = this.replaceInput.value;
    const { vault, workspace } = this.plugin.app;
    let applied = 0;
    let skipped = 0;

    for (const hit of this.hits) {
      const checked = hit.matches.filter((m) => m.checked);
      if (checked.length === 0) continue;

      if (hit.file === null) {
        // Selection scope: write back through the active editor.
        const editor = workspace.activeEditor?.editor;
        if (editor && editor.getSelection() === hit.content) {
          editor.replaceSelection(
            applyReplacements(hit.content, checked, replacement),
          );
          applied += checked.length;
        } else {
          skipped += checked.length;
        }
        continue;
      }

      await vault.process(hit.file, (current) => {
        if (current !== hit.content) {
          // File changed since the search — offsets are stale, skip it.
          skipped += checked.length;
          return current;
        }
        applied += checked.length;
        return applyReplacements(current, checked, replacement);
      });
    }

    const note =
      `Replaced ${applied} match${applied === 1 ? "" : "es"}` +
      (skipped ? `; skipped ${skipped} (file changed since search)` : "");
    new Notice(`Find & Replace: ${note}`);

    // Re-run so the panel reflects the new state.
    void this.runSearch();
  }
}
