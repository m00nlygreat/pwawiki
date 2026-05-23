const state = {
  vaultName: "",
  files: new Map(),
  assets: new Map(),
  tree: makeDir(""),
  columns: [],
  recent: [],
  query: "",
  showGraph: true,
  activePath: "",
  pendingScroll: "",
  sidebarTab: "files",
  collapsedDirs: new Set(),
  sidebarRenderTimer: 0,
  columnRevealTimer: 0,
  columnWidth: 0,
  columnResize: null,
  paletteMode: "files",
  paletteQuery: "",
  paletteIndex: 0,
  paletteItems: [],
  graph: {
    frame: 0,
    nodes: new Map(),
    edges: [],
    dragging: null,
    moved: false,
    zoom: 1.55,
    distance: new Map(),
    energy: 1,
    revealTimer: 0,
    resetOnNextInit: false
  }
};

const els = {
  status: document.getElementById("status"),
  vaultName: document.getElementById("vault-name"),
  vaultSummary: document.getElementById("vault-summary"),
  sidebarTabs: document.getElementById("sidebar-tabs"),
  fileNav: document.getElementById("file-nav"),
  emptyState: document.getElementById("empty-state"),
  columnRail: document.getElementById("column-rail"),
  stack: document.getElementById("stack"),
  workspace: document.getElementById("workspace"),
  searchInput: document.getElementById("search-input"),
  folderInput: document.getElementById("folder-input"),
  fileInput: document.getElementById("file-input"),
  supportNote: document.getElementById("support-note"),
  palette: document.getElementById("palette"),
  paletteMode: document.getElementById("palette-mode"),
  paletteInput: document.getElementById("palette-input"),
  paletteList: document.getElementById("palette-list")
};

const markdownRenderer = createMarkdownRenderer();
const markdownSanitizeConfig = {
  ADD_TAGS: ["button", "details", "summary", "aside", "iframe", "video", "audio", "source", "svg", "polyline"],
  ADD_ATTR: ["class", "type", "data-source-path", "data-link-target", "target", "rel", "aria-hidden", "aria-label", "src", "alt", "title", "controls", "open", "viewBox", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "points", "focusable"],
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|blob):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i
};

boot();

async function boot() {
  restoreColumnWidth();
  document.documentElement.dataset.markdownEngine = markdownRenderer ? "markdown-it" : "fallback";
  bindEvents();
  restoreCachedVault();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./service-worker.js", { updateViaCache: "none" })
      .then((registration) => registration.update())
      .catch(() => {});
  }
  els.supportNote.textContent = window.showDirectoryPicker
    ? "이 브라우저는 폴더 권한과 상태 복원을 지원합니다."
    : "이 브라우저는 폴더 선택 대체 입력과 드래그/드롭을 사용합니다.";
  if (!markdownRenderer) setStatus("Markdown 렌더러를 불러오지 못해 원문으로 표시합니다", true);
}

function bindEvents() {
  on("open-folder", "click", openFolder);
  on("empty-open-folder", "click", openFolder);
  on("open-file", "click", openSingleFile);
  on("empty-open-file", "click", openSingleFile);
  on("graph-toggle", "click", () => {
    state.showGraph = !state.showGraph;
    render();
  });
  on("show-files", "click", () => setMobileMode("show-files"));
  on("show-workspace", "click", () => setMobileMode(""));
  on("show-graph", "click", () => {
    state.showGraph = true;
    setMobileMode("show-graph");
    render();
  });
  els.folderInput.addEventListener("change", () => loadInputFiles([...els.folderInput.files], "선택한 vault"));
  els.fileInput.addEventListener("change", () => loadInputFiles([...els.fileInput.files], "단일 파일"));
  els.searchInput.addEventListener("input", () => {
    state.query = els.searchInput.value.trim().toLowerCase();
    renderSidebar();
  });
  els.paletteInput.addEventListener("input", handlePaletteInput);
  els.paletteInput.addEventListener("keydown", handlePaletteKeydown);
  els.paletteList.addEventListener("click", handlePaletteClick);
  els.palette.addEventListener("click", (event) => {
    if (event.target.closest("[data-palette-close]")) closePalette();
  });
  document.addEventListener("keydown", (event) => {
    const commandKey = event.ctrlKey || event.metaKey;
    if (commandKey && event.key.toLowerCase() === "p") {
      event.preventDefault();
      openPalette(event.shiftKey ? "commands" : "files");
      return;
    }
    if (event.key === "Escape" && !els.palette.hidden) {
      event.preventDefault();
      closePalette();
      return;
    }
    if (event.key === "/" && document.activeElement !== els.searchInput) {
      event.preventDefault();
      els.searchInput.focus();
    }
    if (event.key === "Escape") els.searchInput.blur();
  });
  document.addEventListener("dragover", (event) => {
    event.preventDefault();
    els.emptyState.classList.add("dragging");
  });
  document.addEventListener("dragleave", () => els.emptyState.classList.remove("dragging"));
  document.addEventListener("drop", handleDrop);
  els.stack.addEventListener("click", handleStackClick);
  els.stack.addEventListener("pointerdown", handleColumnResizeStart);
  window.addEventListener("pointermove", handleColumnResizeMove);
  window.addEventListener("pointerup", handleColumnResizeEnd);
  els.fileNav.addEventListener("click", handleNavClick);
  els.sidebarTabs.addEventListener("click", handleSidebarTabClick);
}

function on(id, type, handler) {
  document.getElementById(id).addEventListener(type, handler);
}

async function openFolder() {
  if (window.showDirectoryPicker) {
    try {
      const handle = await window.showDirectoryPicker({ mode: "read" });
      await loadDirectoryHandle(handle);
      return;
    } catch (error) {
      if (error.name === "AbortError") return;
      setStatus("폴더를 열 수 없습니다", true);
    }
  }
  els.folderInput.click();
}

async function openSingleFile() {
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({
        multiple: false,
        types: [{ description: "Markdown", accept: { "text/markdown": [".md", ".markdown"], "text/plain": [".md", ".markdown"] } }]
      });
      const file = await handle.getFile();
      if (window.showDirectoryPicker) {
        setStatus("파일이 속한 vault 폴더를 선택하세요");
        try {
          const dirHandle = await window.showDirectoryPicker({ mode: "read" });
          await loadDirectoryHandle(dirHandle);
          const selected = [...state.files.keys()].find((path) => path.toLowerCase().endsWith(file.name.toLowerCase()));
          if (selected) openDocument(selected, { mode: "replace" });
          return;
        } catch (folderError) {
          if (folderError.name !== "AbortError") setStatus("폴더를 열 수 없어 단일 파일만 엽니다", true);
        }
      }
      await loadInputFiles([file], file.name.replace(/\.(md|markdown)$/i, ""));
      return;
    } catch (error) {
      if (error.name === "AbortError") return;
      setStatus("파일을 열 수 없습니다", true);
    }
  }
  els.fileInput.click();
}

async function handleDrop(event) {
  event.preventDefault();
  els.emptyState.classList.remove("dragging");
  const items = [...event.dataTransfer.items];
  const entries = items.map((item) => item.webkitGetAsEntry?.()).filter(Boolean);
  if (entries.length) {
    const files = [];
    for (const entry of entries) await readEntry(entry, "", files);
    await loadInputFiles(files, entries[0]?.name || "드롭한 vault");
    return;
  }
  await loadInputFiles([...event.dataTransfer.files], "드롭한 vault");
}

async function readEntry(entry, prefix, files) {
  if (entry.isFile) {
    await new Promise((resolve) => entry.file((file) => {
      files.push({
        name: file.name,
        webkitRelativePath: `${prefix}${file.name}`,
        size: file.size,
        lastModified: file.lastModified,
        text: () => file.text(),
        arrayBuffer: () => file.arrayBuffer(),
        type: file.type
      });
      resolve();
    }));
    return;
  }
  if (!entry.isDirectory) return;
  const reader = entry.createReader();
  while (true) {
    const batch = await new Promise((resolve) => reader.readEntries(resolve));
    if (!batch.length) break;
    for (const child of batch) await readEntry(child, `${prefix}${entry.name}/`, files);
  }
}

async function loadDirectoryHandle(handle) {
  setStatus("Vault 인덱싱 중");
  prepareGraphForIndexing();
  const files = [];
  await walkDirectoryHandle(handle, "", files);
  await buildVault(handle.name, files);
  await saveHandle(handle);
}

async function walkDirectoryHandle(dirHandle, basePath, out) {
  for await (const [name, handle] of dirHandle.entries()) {
    const nextPath = basePath ? `${basePath}/${name}` : name;
    if (handle.kind === "directory") {
      await walkDirectoryHandle(handle, nextPath, out);
    } else if (isSupportedVaultFile(name)) {
      const file = await handle.getFile();
      out.push(await readVaultFile(nextPath, file));
    }
  }
}

async function loadInputFiles(fileList, vaultName) {
  prepareGraphForIndexing();
  const files = [];
  for (const file of fileList) {
    const path = normalizePath(file.webkitRelativePath || file.name);
    if (!isSupportedVaultFile(path)) continue;
    files.push(await readVaultFile(path, file));
  }
  await buildVault(vaultName, files);
}

function prepareGraphForIndexing() {
  stopGraphSimulation();
  state.graph.nodes.clear();
  state.graph.edges = [];
  state.graph.distance.clear();
  state.graph.resetOnNextInit = true;
  const graph = els.stack.querySelector(".graph-space");
  if (graph) {
    graph.classList.remove("ready");
    graph.classList.add("preparing");
  }
}

async function buildVault(vaultName, rawFiles) {
  state.vaultName = vaultName || "Markdown vault";
  revokeAssetUrls();
  state.files.clear();
  state.assets.clear();
  state.tree = makeDir("");
  for (const raw of rawFiles.sort((a, b) => a.path.localeCompare(b.path, "ko"))) {
    const path = normalizePath(raw.path);
    if (!isMarkdown(path)) {
      const asset = {
        ...raw,
        path,
        name: path.split("/").pop(),
        url: raw.blob ? URL.createObjectURL(raw.blob) : raw.url
      };
      state.assets.set(path, asset);
      continue;
    }
    const file = {
      ...raw,
      path,
      name: path.split("/").pop(),
      title: path.split("/").pop().replace(/\.(md|markdown)$/i, ""),
      headingTitle: titleFromMarkdown(raw.text) || "",
      links: []
    };
    state.files.set(path, file);
    addToTree(path, file);
  }
  for (const file of state.files.values()) file.links = parseLinks(file.text, file.path);
  restoreWorkspace();
  if (!state.columns.length && state.files.size) openDocument([...state.files.keys()][0], { persist: false, mode: "replace" });
  render();
  await saveCache();
  setStatus(`${state.files.size}개 Markdown 문서`);
}

function restoreWorkspace() {
  const saved = JSON.parse(localStorage.getItem("pwaWikiWorkspace") || "{}");
  const allDirs = collectDirectoryPaths(state.tree);
  state.recent = Array.isArray(saved.recent) ? saved.recent.filter((path) => state.files.has(path)).slice(0, 12) : [];
  state.columns = Array.isArray(saved.columns) ? saved.columns.filter((path) => state.files.has(path)) : [];
  state.activePath = state.columns.includes(saved.activePath) ? saved.activePath : state.columns.at(-1) || "";
  state.sidebarTab = saved.sidebarTab === "recent" ? "recent" : "files";
  state.collapsedDirs = restoreDirectoryState(saved, allDirs);
}

async function restoreCachedVault() {
  const cached = JSON.parse(localStorage.getItem("pwaWikiVaultCache") || "null");
  if (cached?.files?.length) {
    await buildVault(cached.vaultName || "캐시된 vault", cached.files);
    setStatus("오프라인 캐시에서 복원됨");
  }
  const handle = await readSavedHandle();
  if (handle && await verifyPermission(handle)) {
    await loadDirectoryHandle(handle);
  }
}

function openDocument(path, options = {}) {
  if (!state.files.has(path)) return;
  const normalizedOptions = typeof options === "boolean" ? { persist: options } : options;
  const persist = normalizedOptions.persist !== false;
  const mode = normalizedOptions.mode || "stack";
  if (mode === "replace") {
    state.columns = [path];
  } else {
    const existing = state.columns.includes(path);
    if (!existing) state.columns.push(path);
    state.activePath = path;
    state.pendingScroll = path;
    state.recent = [path, ...state.recent.filter((item) => item !== path)].slice(0, 12);
    if (persist) {
      persistWorkspace();
      if (existing) {
        renderSidebar();
        updateStackActiveState(path);
      } else {
        render();
      }
    }
    return;
  }
  state.activePath = path;
  state.pendingScroll = path;
  state.recent = [path, ...state.recent.filter((item) => item !== path)].slice(0, 12);
  if (persist) {
    persistWorkspace();
    render();
  }
}

function updateStackActiveState(path) {
  const target = els.stack.querySelector(`[data-column-path="${cssEscape(path)}"]`);
  const shouldReveal = target?.classList.contains("collapsed");
  clearTimeout(state.columnRevealTimer);
  if (shouldReveal) target.classList.add("revealing");
  for (const column of els.stack.querySelectorAll(".stack-column[data-column-path]")) {
    const isTarget = column.dataset.columnPath === path;
    column.classList.toggle("collapsed", !isTarget);
    if (!isTarget) column.classList.remove("revealing", "fading-in");
  }
  updateGraphFocus();
  if (shouldReveal) {
    state.columnRevealTimer = window.setTimeout(() => {
      target.classList.remove("revealing");
      target.classList.add("fading-in");
      requestAnimationFrame(() => {
        target.classList.remove("fading-in");
        target.scrollIntoView({ behavior: "auto", inline: "start", block: "nearest" });
      });
    }, 190);
    return;
  }
  requestAnimationFrame(() => {
    if (target) target.scrollIntoView({ behavior: "auto", inline: "start", block: "nearest" });
  });
}

function closeDocument(index) {
  const closedPath = state.columns[index];
  state.columns.splice(index, 1);
  if (state.activePath === closedPath) {
    state.activePath = state.columns[index - 1] || state.columns[index] || state.columns.at(-1) || "";
  }
  state.pendingScroll = state.activePath;
  persistWorkspace();
  render();
}

function handleColumnResizeStart(event) {
  const handle = event.target.closest("[data-column-resize]");
  if (!handle) return;
  const column = handle.closest(".stack-column");
  if (!column || column.classList.contains("collapsed")) return;
  event.preventDefault();
  event.stopPropagation();
  state.columnResize = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startWidth: column.getBoundingClientRect().width
  };
  handle.setPointerCapture?.(event.pointerId);
  document.body.classList.add("resizing-column");
}

function handleColumnResizeMove(event) {
  if (!state.columnResize || event.pointerId !== state.columnResize.pointerId) return;
  const nextWidth = clamp(state.columnResize.startWidth + event.clientX - state.columnResize.startX, 320, 760);
  setColumnWidth(nextWidth);
}

function handleColumnResizeEnd(event) {
  if (!state.columnResize || event.pointerId !== state.columnResize.pointerId) return;
  persistWorkspace();
  state.columnResize = null;
  document.body.classList.remove("resizing-column");
}

function handleNavClick(event) {
  const dir = event.target.closest("[data-dir-path]");
  if (dir) {
    toggleDirectory(dir.dataset.dirPath, dir);
    return;
  }
  const row = event.target.closest("[data-path]");
  if (!row) return;
  openDocument(row.dataset.path, { mode: "replace" });
  setMobileMode("");
}

function handleSidebarTabClick(event) {
  const tab = event.target.closest("[data-sidebar-tab]");
  if (!tab) return;
  state.sidebarTab = tab.dataset.sidebarTab;
  persistWorkspace();
  renderSidebar();
}

function handleStackClick(event) {
  const close = event.target.closest("[data-close-index]");
  if (close) {
    closeDocument(Number(close.dataset.closeIndex));
    return;
  }
  const link = event.target.closest("[data-link-target]");
  if (link) {
    event.preventDefault();
    event.stopPropagation();
    const resolved = resolveLink(link.dataset.linkTarget, link.dataset.sourcePath);
    if (resolved) openDocument(resolved, { mode: "stack" });
    else setStatus(`문서를 찾을 수 없습니다: ${link.dataset.linkTarget}`, true);
    return;
  }
  const collapsedColumn = event.target.closest(".stack-column.collapsed[data-column-path]");
  if (collapsedColumn) {
    openDocument(collapsedColumn.dataset.columnPath, { mode: "stack" });
    return;
  }
  const graphNode = event.target.closest("[data-graph-path]");
  if (graphNode && !state.graph.moved) {
    openDocument(graphNode.dataset.graphPath, { mode: "replace" });
    setMobileMode("");
  }
}

function openPalette(mode = "files", query = "") {
  state.paletteMode = mode;
  state.paletteQuery = query;
  state.paletteIndex = 0;
  els.palette.hidden = false;
  els.paletteInput.value = query;
  renderPalette();
  requestAnimationFrame(() => {
    els.paletteInput.focus();
    els.paletteInput.select();
  });
}

function closePalette() {
  els.palette.hidden = true;
  state.paletteItems = [];
  state.paletteQuery = "";
}

function handlePaletteInput() {
  const value = els.paletteInput.value;
  if (state.paletteMode === "files" && value.startsWith(">")) {
    state.paletteMode = "commands";
    els.paletteInput.value = value.slice(1).trimStart();
  }
  state.paletteQuery = els.paletteInput.value;
  state.paletteIndex = 0;
  renderPalette();
}

function handlePaletteKeydown(event) {
  if (event.key === "Escape") {
    event.preventDefault();
    closePalette();
    return;
  }
  if (event.key === "ArrowDown") {
    event.preventDefault();
    movePaletteSelection(1);
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    movePaletteSelection(-1);
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    runPaletteItem(state.paletteItems[state.paletteIndex]);
  }
}

function handlePaletteClick(event) {
  const row = event.target.closest("[data-palette-index]");
  if (!row) return;
  state.paletteIndex = Number(row.dataset.paletteIndex);
  runPaletteItem(state.paletteItems[state.paletteIndex]);
}

function movePaletteSelection(delta) {
  if (!state.paletteItems.length) return;
  state.paletteIndex = (state.paletteIndex + delta + state.paletteItems.length) % state.paletteItems.length;
  renderPaletteList();
}

function renderPalette() {
  const modeLabel = state.paletteMode === "commands" ? "Commands" : "Files";
  els.paletteMode.textContent = modeLabel;
  els.paletteInput.placeholder = state.paletteMode === "commands" ? "명령 검색" : "파일 검색, > 명령";
  state.paletteItems = state.paletteMode === "commands" ? commandPaletteItems() : filePaletteItems();
  if (state.paletteIndex >= state.paletteItems.length) state.paletteIndex = Math.max(0, state.paletteItems.length - 1);
  renderPaletteList();
}

function renderPaletteList() {
  const items = state.paletteItems;
  if (!items.length) {
    els.paletteList.innerHTML = `<div class="palette-empty">결과 없음</div>`;
    return;
  }
  els.paletteList.innerHTML = items.map((item, index) => {
    const active = index === state.paletteIndex ? " active" : "";
    const meta = item.meta ? `<span class="palette-item-meta">${escapeHtml(item.meta)}</span>` : "";
    return `<button class="palette-item${active}" type="button" role="option" aria-selected="${String(index === state.paletteIndex)}" data-palette-index="${index}"><span class="palette-item-title">${escapeHtml(item.title)}</span>${meta}</button>`;
  }).join("");
  const active = els.paletteList.querySelector(".palette-item.active");
  if (active) active.scrollIntoView({ block: "nearest" });
}

function filePaletteItems() {
  const query = normalizeSearch(state.paletteQuery);
  return [...state.files.values()]
    .filter((file) => paletteMatch(`${file.title} ${file.path} ${file.headingTitle}`, query))
    .sort((a, b) => scorePaletteFile(a, query) - scorePaletteFile(b, query) || a.path.localeCompare(b.path, "ko"))
    .slice(0, 80)
    .map((file) => ({ kind: "file", title: file.title, meta: file.path, path: file.path }));
}

function commandPaletteItems() {
  const query = normalizeSearch(state.paletteQuery);
  return allCommandItems()
    .filter((item) => paletteMatch(`${item.title} ${item.meta || ""}`, query))
    .slice(0, 40);
}

function allCommandItems() {
  return [
    { kind: "command", title: "Search Files", meta: "Ctrl/Cmd+P", run: () => openPalette("files") },
    { kind: "command", title: "Toggle Graph", meta: state.showGraph ? "Hide graph" : "Show graph", run: () => { state.showGraph = !state.showGraph; render(); } },
    { kind: "command", title: "Show File Tree", meta: "Sidebar", run: () => { state.sidebarTab = "files"; persistWorkspace(); renderSidebar(); setMobileMode("show-files"); } },
    { kind: "command", title: "Show Recent Documents", meta: "Sidebar", run: () => { state.sidebarTab = "recent"; persistWorkspace(); renderSidebar(); setMobileMode("show-files"); } },
    { kind: "command", title: "Close Active Column", meta: state.activePath || "No open document", run: closeActiveColumn },
    { kind: "command", title: "Close All Columns", meta: `${state.columns.length} open`, run: closeAllColumns },
    { kind: "command", title: "Reset Column Width", meta: "Default", run: resetColumnWidth },
    { kind: "command", title: "Open Vault", meta: "Choose folder", run: openFolder },
    { kind: "command", title: "Open Markdown File", meta: "Choose file", run: openSingleFile }
  ];
}

function runPaletteItem(item) {
  if (!item) return;
  closePalette();
  if (item.kind === "file") {
    openDocument(item.path, { mode: "replace" });
    setMobileMode("");
    return;
  }
  item.run?.();
}

function closeActiveColumn() {
  const index = state.columns.indexOf(state.activePath);
  if (index >= 0) closeDocument(index);
}

function closeAllColumns() {
  state.columns = [];
  state.activePath = "";
  state.pendingScroll = "";
  persistWorkspace();
  render();
}

function resetColumnWidth() {
  state.columnWidth = 0;
  document.documentElement.style.removeProperty("--column-width");
  persistWorkspace();
}

function normalizeSearch(value) {
  return String(value || "").trim().toLowerCase();
}

function paletteMatch(value, query) {
  if (!query) return true;
  return normalizeSearch(value).includes(query);
}

function scorePaletteFile(file, query) {
  if (!query) return state.recent.indexOf(file.path) >= 0 ? state.recent.indexOf(file.path) : 999;
  const title = normalizeSearch(file.title);
  const path = normalizeSearch(file.path);
  if (title === query) return 0;
  if (title.startsWith(query)) return 1;
  if (path.includes(`/${query}`)) return 2;
  if (title.includes(query)) return 3;
  return 4;
}

function render() {
  els.vaultName.textContent = state.vaultName || "Vault 없음";
  els.vaultSummary.textContent = state.files.size ? `${state.files.size}개 문서, ${countFolders(state.tree)}개 폴더` : "폴더를 선택하거나 드래그하세요";
  els.emptyState.hidden = state.files.size > 0;
  els.columnRail.hidden = state.files.size === 0;
  renderSidebar();
  renderStack();
}

function renderSidebar() {
  renderSidebarTabs();
  const chunks = [];
  if (state.sidebarTab === "recent") {
    chunks.push(`<div class="nav-label">최근 문서</div>`);
    for (const path of state.recent) chunks.push(navRow(state.files.get(path), 0));
    if (!state.recent.length) chunks.push(`<div class="empty-list">최근에 연 문서가 없습니다.</div>`);
  } else {
    chunks.push(`<div class="nav-label">Vault 파일</div>`);
    renderTreeRows(state.tree, chunks, 0, "");
  }
  els.fileNav.innerHTML = chunks.join("") || `<div class="nav-label">문서 없음</div>`;
}

function renderSidebarTabs() {
  for (const tab of els.sidebarTabs.querySelectorAll("[data-sidebar-tab]")) {
    const active = tab.dataset.sidebarTab === state.sidebarTab;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  }
}

function renderTreeRows(dir, chunks, depth, dirPath) {
  for (const child of [...dir.dirs.values()].sort((a, b) => a.name.localeCompare(b.name, "ko"))) {
    const childPath = dirPath ? `${dirPath}/${child.name}` : child.name;
    const collapsed = !state.query && state.collapsedDirs.has(childPath);
    chunks.push(dirRow(child, childPath, depth, collapsed));
    if (!collapsed || state.query) renderTreeRows(child, chunks, depth + 1, childPath);
  }
  for (const file of dir.files.sort((a, b) => a.name.localeCompare(b.name, "ko"))) {
    const haystack = `${file.path} ${file.title} ${file.headingTitle} ${file.links.map((l) => l.label).join(" ")}`.toLowerCase();
    if (state.query && !haystack.includes(state.query)) continue;
    chunks.push(navRow(file, depth));
  }
}

function navRow(file, depth) {
  const active = state.activePath === file.path ? " active" : "";
  return `<button class="file-row${active}" type="button" data-path="${escapeAttr(file.path)}" style="padding-left:${8 + depth * 14}px"><span class="kind">MD</span><span class="name">${escapeHtml(file.name)}</span></button>`;
}

function dirRow(dir, path, depth, collapsed) {
  return `<button class="file-row folder-row" type="button" data-dir-path="${escapeAttr(path)}" aria-expanded="${String(!collapsed)}" style="padding-left:${8 + depth * 14}px"><span class="folder-caret" aria-hidden="true">${chevronSvg()}</span><span class="kind">DIR</span><span class="name">${escapeHtml(dir.name)}</span></button>`;
}

function toggleDirectory(path, row) {
  const willExpand = state.collapsedDirs.has(path);
  if (willExpand) state.collapsedDirs.delete(path);
  else state.collapsedDirs.add(path);
  persistWorkspace();
  if (!row || state.query) {
    renderSidebar();
    return;
  }
  row.setAttribute("aria-expanded", String(willExpand));
  clearTimeout(state.sidebarRenderTimer);
  state.sidebarRenderTimer = window.setTimeout(renderSidebar, 160);
}

function renderStack() {
  const graphKey = graphSignature();
  const existingGraph = els.stack.querySelector(".graph-space");
  const reusableGraph = !state.graph.resetOnNextInit && existingGraph?.dataset.graphKey === graphKey ? existingGraph : null;
  if (reusableGraph) reusableGraph.remove();
  const activeIndex = state.columns.includes(state.activePath) ? state.columns.indexOf(state.activePath) : state.columns.length - 1;
  const columns = state.columns.map((path, index) => {
    const file = state.files.get(path);
    const collapsed = index !== activeIndex ? " collapsed" : "";
    return `<section class="stack-column${collapsed}" data-column-path="${escapeAttr(file.path)}" aria-label="${escapeAttr(file.title)}">
      <h2 title="${escapeAttr(file.path)}"><span class="stack-index">${String(index + 1).padStart(2, "0")}</span><span class="stack-label">${escapeHtml(file.title)}</span><button class="stack-close" type="button" data-close-index="${index}" aria-label="닫기"><span aria-hidden="true">×</span></button></h2>
      <div class="stack-body"><article class="doc">
        <div class="doc-meta"><span class="chip">${escapeHtml(file.path)}</span><span class="chip">읽기 전용</span></div>
        <div class="markdown">${renderMarkdown(file.text, file.path)}</div>
      </article></div><span class="column-resize-handle" data-column-resize aria-hidden="true"></span>
    </section>`;
  });
  els.stack.innerHTML = columns.join("");
  if (state.showGraph && state.files.size) {
    if (reusableGraph) {
      els.stack.appendChild(reusableGraph);
      updateGraphFocus();
    } else {
      els.stack.insertAdjacentHTML("beforeend", renderGraph(graphKey));
    }
  }
  const targetPath = state.pendingScroll;
  state.pendingScroll = "";
  requestAnimationFrame(() => {
    const target = targetPath ? els.stack.querySelector(`[data-column-path="${cssEscape(targetPath)}"]`) : null;
    if (target) target.scrollIntoView({ behavior: "auto", inline: "start", block: "nearest" });
    if (!reusableGraph) initGraphSimulation();
  });
}

function renderGraph(graphKey = graphSignature()) {
  const open = new Set(state.columns);
  const nodes = [...state.files.values()].slice(0, 80);
  const edges = [];
  for (const file of nodes) {
    for (const link of file.links) {
      const target = resolveLink(link.target, file.path);
      if (target && state.files.has(target)) edges.push([file.path, target]);
    }
  }
  const { width, height } = graphBounds();
  const viewBox = graphViewBox();
  const lines = edges.map(([from, to]) => `<line data-edge-from="${escapeAttr(from)}" data-edge-to="${escapeAttr(to)}"></line>`).join("");
  const circles = nodes.map((file) => {
    const label = file.title.length > 18 ? `${file.title.slice(0, 17)}…` : file.title;
    const active = open.has(file.path) ? " active" : "";
    const focused = file.path === state.activePath ? " focused" : "";
    return `<g class="graph-node${active}${focused}" data-graph-path="${escapeAttr(file.path)}"><circle r="${file.path === state.activePath ? 14 : open.has(file.path) ? 12 : 8}"></circle><text x="14" y="4">${escapeHtml(label)}</text></g>`;
  }).join("");
  return `<aside class="graph-space" data-graph-key="${escapeAttr(graphKey)}" aria-label="문서 링크 그래프"><div class="graph-canvas"><svg viewBox="${viewBox}" role="img" aria-label="문서 링크 그래프"><g class="graph-links">${lines}</g><g class="graph-nodes">${circles}</g></svg></div></aside>`;
}

function graphSignature() {
  const nodes = [...state.files.values()].slice(0, 80);
  const nodePaths = nodes.map((file) => file.path).join("\n");
  const edges = [];
  for (const file of nodes) {
    for (const link of file.links) {
      const target = resolveLink(link.target, file.path);
      if (target && state.files.has(target)) edges.push(`${file.path}->${target}`);
    }
  }
  return `${nodePaths}\n--\n${edges.sort().join("\n")}`;
}

function initGraphSimulation() {
  const svg = els.stack.querySelector(".graph-canvas svg");
  if (!svg) {
    stopGraphSimulation();
    return;
  }
  const graphSpace = svg.closest(".graph-space");
  const shouldReveal = graphSpace && !graphSpace.classList.contains("ready");
  if (shouldReveal) {
    graphSpace.classList.add("preparing");
    clearTimeout(state.graph.revealTimer);
  }
  const nodeEls = [...svg.querySelectorAll(".graph-node")];
  const edgeEls = [...svg.querySelectorAll("[data-edge-from]")];
  const { width, height } = graphBounds();
  const degree = graphDegreeMap(edgeEls);
  const resetPositions = state.graph.resetOnNextInit;
  const next = new Map();
  nodeEls.forEach((el, index) => {
    const path = el.dataset.graphPath;
    const existing = state.graph.nodes.get(path);
    const point = graphInitialPoint(path, index, nodeEls.length, degree.get(path) || 0);
    const canReuse = !resetPositions && existing && isGraphPointInsideSoftBounds(existing.x, existing.y);
    next.set(path, {
      path,
      el,
      degree: degree.get(path) || 0,
      x: canReuse ? existing.x : point.x,
      y: canReuse ? existing.y : point.y,
      anchorX: canReuse ? existing.anchorX : point.x,
      anchorY: canReuse ? existing.anchorY : point.y,
      vx: canReuse ? existing.vx : point.vx,
      vy: canReuse ? existing.vy : point.vy,
      fixed: existing?.fixed || false
    });
  });
  state.graph.nodes = next;
  state.graph.edges = edgeEls.map((el) => ({
    el,
    from: el.dataset.edgeFrom,
    to: el.dataset.edgeTo
  }));
  state.graph.resetOnNextInit = false;
  updateGraphFocus({ animate: false });
  svg.onpointerdown = handleGraphPointerDown;
  svg.onwheel = handleGraphWheel;
  svg.setAttribute("viewBox", graphViewBox());
  window.removeEventListener("pointermove", handleGraphPointerMove);
  window.removeEventListener("pointerup", handleGraphPointerUp);
  window.addEventListener("pointermove", handleGraphPointerMove);
  window.addEventListener("pointerup", handleGraphPointerUp);
  settleGraph(96);
  drawGraph();
  if (shouldReveal) {
    state.graph.revealTimer = window.setTimeout(() => {
      graphSpace.classList.remove("preparing");
      graphSpace.classList.add("ready");
    }, 120);
  }
  state.graph.energy = 0;
}

function stopGraphSimulation() {
  if (state.graph.frame) cancelAnimationFrame(state.graph.frame);
  clearTimeout(state.graph.revealTimer);
  state.graph.frame = 0;
  state.graph.dragging = null;
}

function updateGraphFocus(options = {}) {
  const animate = options.animate !== false;
  const nodes = [...state.graph.nodes.values()];
  if (!nodes.length) return;
  const adjacency = new Map(nodes.map((node) => [node.path, new Set()]));
  for (const edge of state.graph.edges) {
    if (!adjacency.has(edge.from) || !adjacency.has(edge.to)) continue;
    adjacency.get(edge.from).add(edge.to);
    adjacency.get(edge.to).add(edge.from);
  }
  const distance = new Map();
  const queue = [];
  const focusPaths = state.columns.filter((path) => adjacency.has(path));
  for (const path of focusPaths) {
    const rank = path === state.activePath ? 0 : 0.35;
    if ((distance.get(path) ?? Infinity) <= rank) continue;
    distance.set(path, rank);
    queue.push(path);
  }
  while (queue.length) {
    const path = queue.shift();
    const base = distance.get(path);
    for (const next of adjacency.get(path) || []) {
      const nextDistance = Math.floor(base) + 1;
      if ((distance.get(next) ?? Infinity) <= nextDistance) continue;
      distance.set(next, nextDistance);
      queue.push(next);
    }
  }
  state.graph.distance = distance;
  if (animate) state.graph.energy = Math.max(state.graph.energy, 0.34);
  for (const node of nodes) {
    node.distance = distance.get(node.path) ?? Infinity;
    node.el.classList.toggle("focused", node.path === state.activePath);
    node.el.classList.toggle("active", state.columns.includes(node.path));
    const circle = node.el.querySelector("circle");
    if (circle) circle.setAttribute("r", String(node.path === state.activePath ? 14 : state.columns.includes(node.path) ? 12 : 8));
  }
  if (animate && state.graph.energy && !state.graph.frame) tickGraph();
}

function tickGraph() {
  const motion = stepGraph();
  drawGraph();
  if (state.graph.dragging) {
    state.graph.energy = 0.8;
  } else {
    state.graph.energy *= 0.9;
  }
  const nodes = [...state.graph.nodes.values()];
  if (!state.graph.dragging && state.graph.energy < 0.006 && motion < nodes.length * 0.008) {
    state.graph.energy = 0;
    state.graph.frame = 0;
    return;
  }
  state.graph.frame = requestAnimationFrame(tickGraph);
}

function settleGraph(iterations) {
  const previousEnergy = state.graph.energy;
  state.graph.energy = 1;
  for (let index = 0; index < iterations; index++) {
    stepGraph();
    state.graph.energy *= 0.93;
  }
  for (const node of state.graph.nodes.values()) {
    node.vx *= 0.1;
    node.vy *= 0.1;
  }
  state.graph.energy = previousEnergy;
}

function stepGraph() {
  const nodes = [...state.graph.nodes.values()];
  const { width, height } = graphBounds();
  const centerX = width / 2;
  const centerY = height / 2;
  const energy = state.graph.dragging ? 0.8 : state.graph.energy;
  let motion = 0;
  for (const edge of state.graph.edges) {
    const a = state.graph.nodes.get(edge.from);
    const b = state.graph.nodes.get(edge.to);
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const distance = Math.hypot(dx, dy) || 1;
    const targetLength = graphEdgeLength(a, b);
    const force = (distance - targetLength) * 0.0058 * energy;
    const fx = dx / distance * force;
    const fy = dy / distance * force;
    if (!a.fixed) {
      a.vx += fx;
      a.vy += fy;
    }
    if (!b.fixed) {
      b.vx -= fx;
      b.vy -= fy;
    }
  }
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distanceSq = Math.max(dx * dx + dy * dy, 120);
      const distance = Math.sqrt(distanceSq);
      const force = Math.min(2.6, graphRepulsionStrength(a, b) / distanceSq) * energy;
      const fx = dx / distance * force;
      const fy = dy / distance * force;
      if (!a.fixed) {
        a.vx -= fx;
        a.vy -= fy;
      }
      if (!b.fixed) {
        b.vx += fx;
        b.vy += fy;
      }
    }
  }
  for (const node of nodes) {
    if (!node.fixed) {
      const target = graphNodeTarget(node);
      node.vx += (target.x - node.x) * target.pull;
      node.vy += (target.y - node.y) * target.pull;
      applyGraphBoundaryForce(node);
      node.vx *= 0.82;
      node.vy *= 0.82;
      node.x += node.vx;
      node.y += node.vy;
    }
    motion += Math.abs(node.vx) + Math.abs(node.vy);
  }
  return motion;
}

function drawGraph() {
  updateGraphLabelScale();
  for (const node of state.graph.nodes.values()) {
    node.el.setAttribute("transform", `translate(${node.x.toFixed(1)} ${node.y.toFixed(1)})`);
  }
  for (const edge of state.graph.edges) {
    const a = state.graph.nodes.get(edge.from);
    const b = state.graph.nodes.get(edge.to);
    if (!a || !b) continue;
    edge.el.setAttribute("x1", a.x.toFixed(1));
    edge.el.setAttribute("y1", a.y.toFixed(1));
    edge.el.setAttribute("x2", b.x.toFixed(1));
    edge.el.setAttribute("y2", b.y.toFixed(1));
  }
}

function updateGraphLabelScale() {
  const scale = (state.graph.zoom * 1.65).toFixed(3);
  for (const node of state.graph.nodes.values()) {
    const label = node.el.querySelector("text");
    if (label) label.setAttribute("transform", `scale(${scale})`);
  }
}

function graphEdgeLength(a, b) {
  const rank = Math.min(graphDistanceRank(a), graphDistanceRank(b));
  if (rank <= 0) return 72;
  if (rank <= 1) return 118;
  if (rank <= 2) return 190;
  if (rank <= 3) return 280;
  return 380;
}

function graphNodeTarget(node) {
  const { width, height } = graphBounds();
  const centerX = width / 2;
  const centerY = height / 2;
  const rank = graphDistanceRank(node);
  if (rank <= 0) return { x: centerX, y: centerY, pull: 0.007 };
  if (rank <= 3) return graphFocusRingTarget(node, rank, centerX, centerY);
  const seed = hashString(node.path);
  const angle = seed * Math.PI * 2;
  const radius = Math.min(width, height) * 0.45;
  return {
    x: centerX + Math.cos(angle) * radius,
    y: centerY + Math.sin(angle) * radius,
    pull: 0.00042
  };
}

function graphFocusRingTarget(node, rank, centerX, centerY) {
  const seed = hashString(node.path);
  const angle = seed * Math.PI * 2;
  const radius = rank <= 1 ? 170 : rank <= 2 ? 330 : 500;
  const pull = rank <= 1 ? 0.0028 : rank <= 2 ? 0.0015 : 0.00085;
  return {
    x: centerX + Math.cos(angle) * radius,
    y: centerY + Math.sin(angle) * radius,
    pull
  };
}

function graphRepulsionStrength(a, b) {
  const ar = graphDistanceRank(a);
  const br = graphDistanceRank(b);
  if (ar <= 2 && br <= 2) return 2500;
  if (ar <= 3 || br <= 3) return 7200;
  return 9800;
}

function graphDistanceRank(node) {
  const value = state.graph.distance.get(node.path);
  return Number.isFinite(value) ? value : 5;
}

function handleGraphPointerDown(event) {
  const group = event.target.closest(".graph-node");
  if (!group) return;
  const node = state.graph.nodes.get(group.dataset.graphPath);
  if (!node) return;
  event.preventDefault();
  group.setPointerCapture?.(event.pointerId);
  const point = graphPointerPoint(event);
  state.graph.dragging = {
    pointerId: event.pointerId,
    path: node.path,
    offsetX: node.x - point.x,
    offsetY: node.y - point.y
  };
  state.graph.moved = false;
  state.graph.energy = 1;
  node.fixed = true;
  node.vx = 0;
  node.vy = 0;
  group.classList.add("dragging");
}

function handleGraphPointerMove(event) {
  const drag = state.graph.dragging;
  if (!drag || event.pointerId !== drag.pointerId) return;
  const node = state.graph.nodes.get(drag.path);
  if (!node) return;
  const point = graphPointerPoint(event);
  const next = constrainGraphPoint(point.x + drag.offsetX, point.y + drag.offsetY);
  const nextX = next.x;
  const nextY = next.y;
  if (Math.hypot(nextX - node.x, nextY - node.y) > 2) state.graph.moved = true;
  node.x = nextX;
  node.y = nextY;
  node.anchorX = nextX;
  node.anchorY = nextY;
}

function handleGraphWheel(event) {
  event.preventDefault();
  const nextZoom = clamp(state.graph.zoom * Math.exp(event.deltaY * 0.001), 0.62, 2.35);
  state.graph.zoom = nextZoom;
  const svg = event.currentTarget;
  svg.setAttribute("viewBox", graphViewBox());
  updateGraphLabelScale();
}

function handleGraphPointerUp(event) {
  const drag = state.graph.dragging;
  if (!drag || event.pointerId !== drag.pointerId) return;
  const node = state.graph.nodes.get(drag.path);
  const group = node?.el;
  const shouldOpen = !state.graph.moved;
  if (node) node.fixed = false;
  if (group) group.classList.remove("dragging");
  state.graph.dragging = null;
  state.graph.energy = Math.max(state.graph.energy, 0.5);
  if (shouldOpen) {
    state.graph.moved = true;
    openDocument(drag.path, { mode: "replace" });
    setMobileMode("");
  }
  if (!state.graph.frame) tickGraph();
  window.setTimeout(() => { state.graph.moved = false; }, 0);
}

function graphPointerPoint(event) {
  const svg = els.stack.querySelector(".graph-canvas svg");
  if (!svg) return { x: 0, y: 0 };
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const transformed = point.matrixTransform(svg.getScreenCTM().inverse());
  return { x: transformed.x, y: transformed.y };
}

function graphDegreeMap(edgeEls) {
  const degree = new Map();
  for (const edge of edgeEls) {
    degree.set(edge.dataset.edgeFrom, (degree.get(edge.dataset.edgeFrom) || 0) + 1);
    degree.set(edge.dataset.edgeTo, (degree.get(edge.dataset.edgeTo) || 0) + 1);
  }
  return degree;
}

function graphInitialPoint(path, index, total, degree) {
  const { width, height } = graphBounds();
  const centerX = width / 2;
  const centerY = height / 2;
  const seed = hashString(path);
  const golden = Math.PI * (3 - Math.sqrt(5));
  const angle = seed * Math.PI * 2 + index * golden;
  const rank = total <= 1 ? 0 : index / (total - 1);
  const baseRadius = degree ? 0.12 + rank * 0.42 : 0.36 + (seed * 0.34);
  const wobble = 0.84 + seededRandom(seed + 3.7) * 0.28;
  const radius = Math.min(width, height) * baseRadius * wobble;
  return {
    x: centerX + Math.cos(angle) * radius,
    y: centerY + Math.sin(angle) * radius,
    vx: (seededRandom(seed + 1.3) - 0.5) * 1.4,
    vy: (seededRandom(seed + 2.1) - 0.5) * 1.4
  };
}

function applyGraphBoundaryForce(node) {
  const { width, height } = graphBounds();
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(width, height) * 0.48;
  const dx = node.x - centerX;
  const dy = node.y - centerY;
  const distance = Math.hypot(dx, dy);
  const normalized = distance / radius;
  if (normalized <= 1) return;
  const push = (normalized - 1) * 9.5;
  node.vx -= dx / distance * push;
  node.vy -= dy / distance * push;
}

function isGraphPointInsideSoftBounds(x, y) {
  const { width, height } = graphBounds();
  return Math.hypot(x - width / 2, y - height / 2) < Math.min(width, height) * 0.53;
}

function constrainGraphPoint(x, y) {
  const { width, height } = graphBounds();
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(width, height) * 0.53;
  const dx = x - centerX;
  const dy = y - centerY;
  const distance = Math.hypot(dx, dy);
  if (distance <= radius) return { x, y };
  return {
    x: centerX + dx / distance * radius,
    y: centerY + dy / distance * radius
  };
}

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function seededRandom(seed) {
  const value = Math.sin(seed * 10000) * 10000;
  return value - Math.floor(value);
}

function graphBounds() {
  return { width: 1700, height: 1050 };
}

function graphViewBox() {
  const { width, height } = graphBounds();
  const viewWidth = width * state.graph.zoom;
  const viewHeight = height * state.graph.zoom;
  return `${((width - viewWidth) / 2).toFixed(1)} ${((height - viewHeight) / 2).toFixed(1)} ${viewWidth.toFixed(1)} ${viewHeight.toFixed(1)}`;
}

function renderMarkdown(text, sourcePath) {
  const source = stripFrontmatter(text).body;
  if (!markdownRenderer) {
    return `<pre><code>${escapeHtml(source)}</code></pre>`;
  }
  const rendered = markdownRenderer.render(source, { sourcePath, internalLinkStack: [] });
  return DOMPurify.sanitize(rendered, markdownSanitizeConfig);
}

function linkButton(label, target, sourcePath) {
  return `<button class="linklike" type="button" data-source-path="${escapeAttr(sourcePath)}" data-link-target="${escapeAttr(target)}">${escapeHtml(label)}</button>`;
}

function createMarkdownRenderer() {
  if (!window.markdownit || !window.DOMPurify) return null;
  const md = window.markdownit({
    html: false,
    linkify: true,
    typographer: true,
    breaks: false
  });
  md.inline.ruler.before("image", "wikilink", wikiLinkRule);
  md.renderer.rules.wiki_link = (tokens, index, options, env) => {
    const meta = tokens[index].meta;
    return meta.embed ? renderEmbed(meta.target, env.sourcePath, env.embedStack || []) : linkButton(meta.label, meta.target, env.sourcePath);
  };
  md.renderer.rules.image = (tokens, index, options, env) => {
    const token = tokens[index];
    const src = token.attrGet("src") || "";
    const label = token.content || token.attrGet("alt") || src;
    return renderEmbed(src, env.sourcePath, env.embedStack || [], label);
  };
  md.renderer.rules.link_open = (tokens, index, options, env, self) => {
    const href = tokens[index].attrGet("href") || "";
    const internal = isVaultHref(href);
    env.internalLinkStack = env.internalLinkStack || [];
    env.internalLinkStack.push(internal);
    if (internal) {
      return `<button class="linklike" type="button" data-source-path="${escapeAttr(env.sourcePath)}" data-link-target="${escapeAttr(href)}">`;
    }
    tokens[index].attrSet("target", "_blank");
    tokens[index].attrSet("rel", "noreferrer");
    return self.renderToken(tokens, index, options);
  };
  md.renderer.rules.link_close = (tokens, index, options, env, self) => {
    const internal = env.internalLinkStack?.pop();
    return internal ? "</button>" : self.renderToken(tokens, index, options);
  };
  md.renderer.rules.paragraph_open = (tokens, index, options, env, self) => {
    return paragraphContainsOnlyEmbed(tokens, index) ? "" : self.renderToken(tokens, index, options);
  };
  md.renderer.rules.paragraph_close = (tokens, index, options, env, self) => {
    return paragraphContainsOnlyEmbed(tokens, index - 2) ? "" : self.renderToken(tokens, index, options);
  };
  return md;
}

function paragraphContainsOnlyEmbed(tokens, index) {
  const inline = tokens[index + 1];
  const close = tokens[index + 2];
  if (!inline || !close || inline.type !== "inline" || close.type !== "paragraph_close") return false;
  const meaningful = (inline.children || []).filter((token) => token.type !== "text" || token.content.trim());
  return meaningful.length > 0 && meaningful.every((token) => token.type === "image" || token.type === "wiki_link" && token.meta?.embed);
}

function wikiLinkRule(state, silent) {
  const start = state.pos;
  const isEmbed = state.src.charCodeAt(start) === 0x21;
  const linkStart = isEmbed ? start + 1 : start;
  if (state.src.charCodeAt(linkStart) !== 0x5B || state.src.charCodeAt(linkStart + 1) !== 0x5B) return false;
  const end = state.src.indexOf("]]", linkStart + 2);
  if (end < 0) return false;
  const raw = state.src.slice(linkStart + 2, end).trim();
  if (!raw) return false;
  if (!silent) {
    const divider = raw.indexOf("|");
    const target = (divider >= 0 ? raw.slice(0, divider) : raw).trim();
    const label = (divider >= 0 ? raw.slice(divider + 1) : target).trim() || target;
    const token = state.push("wiki_link", "", 0);
    token.meta = { target, label, embed: isEmbed };
  }
  state.pos = end + 2;
  return true;
}

function isVaultHref(href) {
  return Boolean(href) && !href.startsWith("#") && !href.startsWith("//") && !/^[a-z][a-z0-9+.-]*:/i.test(href);
}

function stripFrontmatter(text) {
  const normalized = text.replace(/\r\n?/g, "\n");
  if (!normalized.startsWith("---\n")) return { body: normalized, frontmatter: "" };
  const end = normalized.indexOf("\n---", 4);
  if (end < 0) return { body: normalized, frontmatter: "" };
  const closeEnd = normalized.indexOf("\n", end + 4);
  return {
    frontmatter: normalized.slice(4, end).trim(),
    body: normalized.slice(closeEnd < 0 ? normalized.length : closeEnd + 1)
  };
}

function parseLinks(text) {
  const links = [];
  const wiki = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
  const md = /\[([^\]]+)\]\(([^)]+)\)/g;
  for (const match of text.matchAll(wiki)) links.push({ label: match[2] || match[1], target: match[1] });
  for (const match of text.matchAll(md)) {
    if (!/^[a-z][a-z0-9+.-]*:/i.test(match[2])) links.push({ label: match[1], target: match[2] });
  }
  return links;
}

async function readVaultFile(path, file) {
  const normalized = normalizePath(path);
  const base = { path: normalized, name: file.name, size: file.size, mtime: file.lastModified, mime: file.type || mimeFromPath(normalized) };
  if (isMarkdown(normalized)) return { ...base, text: await file.text() };
  const blob = file instanceof Blob ? file : new Blob([await file.arrayBuffer()], { type: base.mime });
  return { ...base, blob };
}

function renderEmbed(target, sourcePath, embedStack, label = target) {
  const resolved = resolveVaultTarget(target, sourcePath);
  if (!resolved) {
    return `<span class="embed-missing">임베드 대상을 찾을 수 없습니다: ${escapeHtml(label)}</span>`;
  }
  if (resolved.kind === "asset") return renderAssetEmbed(resolved.asset, label);
  if (resolved.kind === "document") return renderDocumentEmbed(resolved.file, resolved.ref, sourcePath, embedStack);
  return linkButton(label, target, sourcePath);
}

function renderAssetEmbed(asset, label) {
  const title = label && label !== asset.path ? label : asset.name;
  let content = `<a href="${escapeAttr(asset.url)}" target="_blank" rel="noreferrer">${escapeHtml(asset.name)}</a>`;
  if (isImage(asset.path)) content = `<img class="embed-image" src="${escapeAttr(asset.url)}" alt="${escapeAttr(label || asset.name)}">`;
  else if (isVideo(asset.path)) content = `<video class="embed-media" src="${escapeAttr(asset.url)}" controls></video>`;
  else if (isAudio(asset.path)) content = `<audio class="embed-media" src="${escapeAttr(asset.url)}" controls></audio>`;
  else if (isPdf(asset.path)) content = `<iframe class="embed-pdf" src="${escapeAttr(asset.url)}" title="${escapeAttr(asset.name)}"></iframe>`;
  return renderEmbedCard(title || asset.name, content);
}

function renderDocumentEmbed(file, ref, sourcePath, embedStack) {
  const stack = new Set(embedStack);
  if (stack.has(file.path)) {
    return renderEmbedCard("순환 임베드", `<p>${escapeHtml(file.path)} 문서는 이미 이 임베드 경로에 있습니다.</p>`, { className: "embed-warning" });
  }
  const body = extractEmbedBody(file.text, ref);
  const nextStack = [...stack, file.path];
  const content = markdownRenderer
    ? DOMPurify.sanitize(markdownRenderer.render(body, { sourcePath: file.path, embedStack: nextStack, internalLinkStack: [] }), markdownSanitizeConfig)
    : `<pre><code>${escapeHtml(body)}</code></pre>`;
  const action = `<button class="embed-open" type="button" data-source-path="${escapeAttr(sourcePath)}" data-link-target="${escapeAttr(file.path)}" aria-label="열기" title="열기">${chevronSvg()}</button>`;
  return renderEmbedCard(file.title, content, { action });
}

function renderEmbedCard(title, content, options = {}) {
  const className = options.className ? ` ${options.className}` : "";
  const action = options.action ? `<span class="embed-title-action">${options.action}</span>` : "";
  return `<details class="embed-card${className}" open><summary class="embed-title"><span class="embed-caret" aria-hidden="true">${chevronSvg()}</span><span class="embed-title-text">${escapeHtml(title)}</span>${action}</summary><div class="embed-body">${content}</div></details>`;
}

function chevronSvg() {
  return `<svg class="chevron-svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false"><polyline points="6 4 10 8 6 12"></polyline></svg>`;
}

function extractEmbedBody(text, ref) {
  const body = stripFrontmatter(text).body;
  if (!ref) return body;
  if (ref.startsWith("^")) return extractBlockReference(body, ref.slice(1)) || `> 블록을 찾을 수 없습니다: ${ref}`;
  return extractHeadingSection(body, ref) || body;
}

function extractHeadingSection(text, heading) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const wanted = slugifyHeading(heading);
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const match = /^(#{1,6})\s+(.+)$/.exec(lines[i]);
    if (match && slugifyHeading(match[2]) === wanted) {
      start = i;
      level = match[1].length;
      break;
    }
  }
  if (start < 0) return "";
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const match = /^(#{1,6})\s+/.exec(lines[i]);
    if (match && match[1].length <= level) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

function extractBlockReference(text, blockId) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const marker = `^${blockId}`;
  const index = lines.findIndex((line) => line.trim().endsWith(marker));
  if (index < 0) return "";
  return lines[index].replace(marker, "").trim();
}

function resolveVaultTarget(target, sourcePath) {
  const parsed = parseTarget(target);
  const docPath = resolveLink(parsed.path, sourcePath);
  if (docPath) return { kind: "document", file: state.files.get(docPath), ref: parsed.ref };
  const assetPath = resolveAssetPath(parsed.path, sourcePath);
  if (assetPath) return { kind: "asset", asset: state.assets.get(assetPath), ref: parsed.ref };
  return null;
}

function parseTarget(target) {
  const decoded = decodeURIComponent(String(target)).replace(/\\/g, "/").replace(/^\.\//, "");
  const [path, ref = ""] = decoded.split("#");
  return { path, ref };
}

function resolveAssetPath(target, sourcePath) {
  const clean = decodeURIComponent(String(target).split("#")[0]).replace(/\\/g, "/").replace(/^\.\//, "");
  if (!clean) return "";
  const sourceDir = sourcePath.includes("/") ? sourcePath.slice(0, sourcePath.lastIndexOf("/")) : "";
  const candidates = [
    sourceDir ? normalizePath(`${sourceDir}/${clean}`) : clean,
    normalizePath(clean)
  ];
  for (const candidate of candidates) {
    if (state.assets.has(candidate)) return candidate;
    const byName = [...state.assets.keys()].find((path) => path.toLowerCase().endsWith(`/${candidate.toLowerCase()}`) || path.toLowerCase() === candidate.toLowerCase());
    if (byName) return byName;
  }
  return "";
}

function resolveLink(target, sourcePath) {
  const clean = decodeURIComponent(String(target).split("#")[0]).replace(/\\/g, "/").replace(/^\.\//, "");
  if (!clean) return "";
  const candidates = [];
  if (/\.(md|markdown)$/i.test(clean)) candidates.push(clean);
  else candidates.push(`${clean}.md`, `${clean}.markdown`, clean);
  const sourceDir = sourcePath.includes("/") ? sourcePath.slice(0, sourcePath.lastIndexOf("/")) : "";
  for (const candidate of candidates) {
    const relative = normalizePath(sourceDir ? `${sourceDir}/${candidate}` : candidate);
    if (state.files.has(relative)) return relative;
    const direct = normalizePath(candidate);
    if (state.files.has(direct)) return direct;
    const byName = [...state.files.keys()].find((path) => path.toLowerCase().endsWith(`/${direct.toLowerCase()}`) || path.toLowerCase() === direct.toLowerCase());
    if (byName) return byName;
    const byTitle = [...state.files.values()].find((file) => file.title.toLowerCase() === clean.toLowerCase() || file.headingTitle.toLowerCase() === clean.toLowerCase() || file.name.replace(/\.(md|markdown)$/i, "").toLowerCase() === clean.toLowerCase());
    if (byTitle) return byTitle.path;
  }
  return "";
}

function titleFromMarkdown(text) {
  return /(^|\n)#\s+(.+)/.exec(text)?.[2]?.trim();
}

function makeDir(name) {
  return { name, dirs: new Map(), files: [] };
}

function addToTree(path, file) {
  const parts = path.split("/");
  let cursor = state.tree;
  for (const part of parts.slice(0, -1)) {
    if (!cursor.dirs.has(part)) cursor.dirs.set(part, makeDir(part));
    cursor = cursor.dirs.get(part);
  }
  cursor.files.push(file);
}

function countFolders(dir) {
  let total = dir.dirs.size;
  for (const child of dir.dirs.values()) total += countFolders(child);
  return total;
}

function collectDirectoryPaths(dir, prefix = "") {
  const paths = new Set();
  for (const child of dir.dirs.values()) {
    const path = prefix ? `${prefix}/${child.name}` : child.name;
    paths.add(path);
    for (const nested of collectDirectoryPaths(child, path)) paths.add(nested);
  }
  return paths;
}

function restoreDirectoryState(saved, allDirs) {
  if (Array.isArray(saved.expandedDirs)) {
    const expanded = new Set(saved.expandedDirs.filter((path) => allDirs.has(path)));
    return new Set([...allDirs].filter((path) => !expanded.has(path)));
  }
  if (Array.isArray(saved.collapsedDirs) && saved.collapsedDirs.length) {
    return new Set(saved.collapsedDirs.filter((path) => allDirs.has(path)));
  }
  return allDirs;
}

function expandedDirectoryPaths() {
  const allDirs = collectDirectoryPaths(state.tree);
  return [...allDirs].filter((path) => !state.collapsedDirs.has(path));
}

function normalizePath(path) {
  const parts = String(path).replace(/\\/g, "/").split("/");
  const out = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

function isMarkdown(name) {
  return /\.(md|markdown)$/i.test(name);
}

function isSupportedVaultFile(name) {
  return isMarkdown(name) || isEmbeddableAsset(name);
}

function isEmbeddableAsset(name) {
  return /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico|pdf|mp3|wav|ogg|m4a|mp4|webm|mov)$/i.test(name);
}

function isImage(name) {
  return /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i.test(name);
}

function isAudio(name) {
  return /\.(mp3|wav|ogg|m4a)$/i.test(name);
}

function isVideo(name) {
  return /\.(mp4|webm|mov)$/i.test(name);
}

function isPdf(name) {
  return /\.pdf$/i.test(name);
}

function mimeFromPath(path) {
  const ext = path.split(".").pop()?.toLowerCase();
  return {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    avif: "image/avif",
    bmp: "image/bmp",
    ico: "image/x-icon",
    pdf: "application/pdf",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",
    m4a: "audio/mp4",
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    md: "text/markdown",
    markdown: "text/markdown"
  }[ext] || "application/octet-stream";
}

function revokeAssetUrls() {
  for (const asset of state.assets.values()) {
    if (asset.url?.startsWith("blob:")) URL.revokeObjectURL(asset.url);
  }
}

function slugifyHeading(value) {
  return String(value)
    .trim()
    .replace(/[#`*_~[\]()]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function setStatus(message, isError = false) {
  els.status.innerHTML = `<span class="dot" style="${isError ? `background:var(--danger)` : ""}"></span><span>${escapeHtml(message)}</span>`;
}

function setMobileMode(mode) {
  els.workspace.classList.remove("show-files", "show-graph");
  if (mode) els.workspace.classList.add(mode);
  document.getElementById("show-files")?.classList.toggle("primary", mode === "show-files");
  document.getElementById("show-workspace")?.classList.toggle("primary", !mode);
  document.getElementById("show-graph")?.classList.toggle("primary", mode === "show-graph");
}

function restoreColumnWidth() {
  const saved = Number(JSON.parse(localStorage.getItem("pwaWikiWorkspace") || "{}").columnWidth);
  if (Number.isFinite(saved) && saved > 0) setColumnWidth(saved);
}

function setColumnWidth(width) {
  state.columnWidth = Math.round(clamp(width, 320, 760));
  document.documentElement.style.setProperty("--column-width", `${state.columnWidth}px`);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function persistWorkspace() {
  localStorage.setItem("pwaWikiWorkspace", JSON.stringify({
    columns: state.columns,
    recent: state.recent,
    activePath: state.activePath,
    sidebarTab: state.sidebarTab,
    columnWidth: state.columnWidth || undefined,
    expandedDirs: expandedDirectoryPaths(),
    collapsedDirs: [...state.collapsedDirs]
  }));
}

async function saveCache() {
  try {
    const files = [...state.files.values()].map(({ path, name, text, size, mtime, mime }) => ({ path, name, text, size, mtime, mime }));
    localStorage.setItem("pwaWikiVaultCache", JSON.stringify({ vaultName: state.vaultName, files }));
    persistWorkspace();
  } catch {
    setStatus("Vault가 커서 앱 셸만 캐시됩니다", true);
    persistWorkspace();
  }
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("pwawiki", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("handles");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveHandle(handle) {
  try {
    const db = await openDb();
    const tx = db.transaction("handles", "readwrite");
    tx.objectStore("handles").put(handle, "vault");
  } catch {
    localStorage.setItem("pwaWikiHandleUnavailable", "1");
  }
}

async function readSavedHandle() {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const tx = db.transaction("handles", "readonly");
      const request = tx.objectStore("handles").get("vault");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function verifyPermission(handle) {
  if (!handle?.queryPermission) return false;
  if (await handle.queryPermission({ mode: "read" }) === "granted") return true;
  return await handle.requestPermission({ mode: "read" }) === "granted";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function cssEscape(value) {
  if (window.CSS?.escape) return CSS.escape(value);
  return String(value).replace(/["\\]/g, "\\$&");
}
