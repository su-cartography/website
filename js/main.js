/**
 * Gallery of Possibilities
 */
const API = "https://zenodo.org/api/records/16882204";
const FIELDS = [
  ["designer", "Designer"],
  ["metadata-source", "Metadata Source"],
  ["uploader", "Uploader"],
  ["primary-tags", "Primary Tag"],
  ["secondary-tags", "Secondary Tags"],
  ["when-created", "When Created"],
  ["when-uploaded", "When Uploaded"],
  ["where-created", "Where Created"],
  ["icon-geography", "Icon Geography"],
  ["icon-description", "Icon Description"],
  ["icon-context", "Icon Context"],
  ["creation-context", "Creation Context"],
  ["notes", "Notes"],
];

let icons = [];
let files = {};
let pngZip;
let svgZip;
let selected = null;
let format = "png";
let selectMode = false;
const picked = new Set();

function parseCSV(text) {
  const src = text.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let q = false;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const n = src[i + 1];
    if (q) {
      if (c === '"' && n === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n") {
      row.push(cell);
      cell = "";
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else if (c !== "\r") cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((vals) =>
    Object.fromEntries(headers.map((h, i) => [h, (vals[i] || "").trim()]))
  );
}


function svgForBrowser(text) {
  return text.replace(/param\([^)]+\),\s*/g, "").replace(/param\([^)]+\)/g, "#000");
}

async function blobFromZip(zip, kind, id) {
  const path = `map-icon-${kind}/${id}.${kind}`;
  const file = zip.file(path);
  if (!file) return null;

  if (kind === "svg") {
    const text = svgForBrowser(await file.async("text"));
    return new Blob([text], { type: "image/svg+xml" });
  }

  const bytes = await file.async("arraybuffer");
  return new Blob([bytes], { type: "image/png" });
}

async function fileFromZip(zip, kind, id) {
  const blob = await blobFromZip(zip, kind, id);
  return blob ? URL.createObjectURL(blob) : null;
}

async function ensureSvgZip() {
  if (svgZip) return;
  const url = files["map-icon-svg.zip"];
  if (!url) throw new Error("map-icon-svg.zip missing from Zenodo record");
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to download map-icon-svg.zip");
  svgZip = await JSZip.loadAsync(await res.arrayBuffer());
}

async function ensureAllSvgs() {
  await ensureSvgZip();
  await Promise.all(
    icons.map(async (icon) => {
      if (!icon.svg) icon.svg = await fileFromZip(svgZip, "svg", icon.id);
    })
  );
}

function iconSrc(icon) {
  if (format === "svg") return icon.svg || icon.png;
  return icon.png;
}

async function previewSrc(icon) {
  if (format === "png") return icon.png;

  $("#format-status").prop("hidden", false).text("Loading SVG…");
  try {
    await ensureSvgZip();
    if (!icon.svg) icon.svg = await fileFromZip(svgZip, "svg", icon.id);

    if (!icon.svg) {
      $("#format-status").text(`No SVG file named ${icon.id}.svg in the zip.`);
      return icon.png;
    }

    $("#format-status").prop("hidden", true).text("");
    return icon.svg;
  } catch (err) {
    console.error(err);
    $("#format-status").text(String(err.message || err));
    return icon.png;
  }
}

function setFormat(next) {
  format = next;
  $(".format-btn").removeClass("is-active").attr("aria-pressed", "false");
  $(`.format-btn[data-format="${next}"]`).addClass("is-active").attr("aria-pressed", "true");
  $("#rainbow-toggle")
    .toggleClass("is-svg", next === "svg")
    .attr("aria-pressed", next === "svg" ? "true" : "false");
  $("#format-mode").text(next === "svg" ? "Showing SVGs" : "Showing PNGs");
}

async function setGridFormat(next) {
  if (next === format && icons.length) {
    applySearch();
    return;
  }

  if (next === "svg") {
    showStatus("Loading SVGs…");
    try {
      await ensureAllSvgs();
    } catch (err) {
      console.error(err);
      showStatus("Could not load SVG zip from Zenodo.", true);
      return;
    }
  }

  setFormat(next);
  applySearch();
}

function triggerDownload(url, filename) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function saveBlob(blob, filename) {
  const file =
    blob.type && blob.type !== "application/octet-stream"
      ? new Blob([blob], { type: "application/octet-stream" })
      : blob;
  const objectUrl = URL.createObjectURL(file);
  triggerDownload(objectUrl, filename);
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

async function saveFile(blob, filename) {
  if (window.showSaveFilePicker) {
    try {
      const ext = filename.includes(".") ? filename.slice(filename.lastIndexOf(".")) : "";
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: ext
          ? [{ description: "File", accept: { [blob.type || "application/octet-stream"]: [ext] } }]
          : undefined,
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (err) {
      if (err.name === "AbortError") return;
    }
  }
  saveBlob(blob, filename);
}

async function ensureIconSvg(icon) {
  if (icon.svg) return icon.svg;
  await ensureSvgZip();
  icon.svg = await fileFromZip(svgZip, "svg", icon.id);
  return icon.svg;
}

async function downloadSelectedIcon(kind, $btn) {
  if (!selected) return;
  const filename = `${selected.id}.${kind}`;

  // Chrome needs the download click in the same user gesture — no await before this.
  if (kind === "png") {
    if (!selected.png) {
      alert("This icon’s PNG is not loaded yet.");
      return;
    }
    triggerDownload(selected.png, filename);
    return;
  }

  if (selected.svg) {
    triggerDownload(selected.svg, filename);
    return;
  }

  const label = $btn.text();
  $btn.prop("disabled", true).text("Loading…");

  try {
    await ensureSvgZip();
    const blob = await blobFromZip(svgZip, "svg", selected.id);
    if (!blob) {
      alert(`No SVG file named ${selected.id}.svg in the zip.`);
      return;
    }
    selected.svg = URL.createObjectURL(blob);
    // After async work Chrome blocks silent downloads — use Save dialog when available.
    await saveFile(blob, filename);
  } catch (err) {
    console.error(err);
    alert("Could not download that SVG.");
  } finally {
    $btn.prop("disabled", false).text(label);
  }
}

function showStatus(msg, error) {
  $("#icon-grid")
    .addClass("is-status")
    .removeClass("is-empty")
    .toggleClass("is-error", !!error)
    .html(`<p class="icons-status">${msg}</p>`);
}

function matchesQuery(icon, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  const m = icon.meta || {};
  const haystack = [
    m["primary-tags"],
    m["secondary-tags"],
    m["icon-geography"],
    m.designer,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

function filteredIcons() {
  const query = ($("#q").val() || "").trim();
  return icons.filter((icon) => matchesQuery(icon, query));
}

function updateSearchCount(shown) {
  const $count = $("#search-count");
  const query = ($("#q").val() || "").trim();
  if (!icons.length || !query) {
    $count.prop("hidden", true).text("");
    return;
  }
  $count.prop("hidden", false).text(`${shown} of ${icons.length} icons`);
}

function pickedIcons() {
  return icons.filter((icon) => picked.has(icon.id));
}

function updateSelectBar() {
  const n = picked.size;
  $("#select-count").text(n === 1 ? "1 selected" : `${n} selected`);
  $("#select-dl-png, #select-dl-svg, #select-dl-csv").prop("disabled", n === 0);
  $("#select-bar").prop("hidden", !selectMode);
  $("#select-toggle")
    .attr("aria-pressed", selectMode ? "true" : "false")
    .text(selectMode ? "Selecting…" : "Select");
  $("#icon-grid").toggleClass("is-selecting", selectMode);
}

function setSelectMode(on) {
  selectMode = !!on;
  if (!selectMode) picked.clear();
  if (!$("#mini").prop("hidden")) closeMini();
  updateSelectBar();
  applySearch();
}

function togglePicked(id) {
  if (picked.has(id)) picked.delete(id);
  else picked.add(id);
  updateSelectBar();
  $(`.icon-card[data-id="${id}"]`).toggleClass("is-picked", picked.has(id));
  $(`.icon-card[data-id="${id}"] .icon-check`).prop("checked", picked.has(id));
}

function csvEscape(value) {
  const text = String(value == null ? "" : value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function selectedMetadataCsv(list) {
  const headers = ["unique-ID", ...FIELDS.map(([key]) => key)];
  const lines = [headers.join(",")];
  list.forEach((icon) => {
    const row = headers.map((key) => {
      if (key === "unique-ID") return csvEscape(icon.id);
      return csvEscape((icon.meta && icon.meta[key]) || "");
    });
    lines.push(row.join(","));
  });
  return lines.join("\r\n");
}

async function downloadPicked(kind, $btn) {
  const list = pickedIcons();
  if (!list.length) return;

  const label = $btn.text();
  $btn.prop("disabled", true).text("Preparing…");

  try {
    if (kind === "csv") {
      const blob = new Blob([selectedMetadataCsv(list)], { type: "text/csv;charset=utf-8" });
      await saveFile(blob, "selected-icons-metadata.csv");
      return;
    }

    if (kind === "svg") await ensureSvgZip();
    if (kind === "png" && !pngZip) throw new Error("PNG zip is not loaded yet.");

    const out = new JSZip();
    let added = 0;
    for (const icon of list) {
      const blob = await blobFromZip(kind === "png" ? pngZip : svgZip, kind, icon.id);
      if (!blob) continue;
      out.file(`${icon.id}.${kind}`, blob);
      added++;
    }

    if (!added) {
      alert(`None of the selected icons had a ${kind.toUpperCase()} file.`);
      return;
    }

    const zipBlob = await out.generateAsync({ type: "blob" });
    await saveFile(zipBlob, `selected-icons-${kind}.zip`);
  } catch (err) {
    console.error(err);
    alert(`Could not prepare that ${kind.toUpperCase()} download.`);
  } finally {
    $btn.prop("disabled", false).text(label);
    updateSelectBar();
  }
}

function renderGrid(list) {
  const items = list || filteredIcons();
  const $grid = $("#icon-grid").removeClass("is-status is-error is-empty").empty();
  updateSearchCount(items.length);

  if (!items.length) {
    const msg = ($("#q").val() || "").trim()
      ? "No icons match your search."
      : "No icons found.";
    $grid.addClass("is-status is-empty").html(`<p class="icons-status">${msg}</p>`);
    updateSelectBar();
    return;
  }

  items.forEach((icon, i) => {
    const index = icons.indexOf(icon);
    const isPicked = picked.has(icon.id);
    const check = selectMode
      ? `<label class="icon-check-wrap" aria-label="Select ${icon.label || icon.id}">
          <input type="checkbox" class="icon-check" ${isPicked ? "checked" : ""} tabindex="-1">
        </label>`
      : "";
    $grid.append(
      `<div class="icon-card${isPicked ? " is-picked" : ""}" role="button" tabindex="0" data-i="${index}" data-id="${icon.id}" style="--i:${i}">
        ${check}
        <img src="${iconSrc(icon)}" alt="" loading="lazy" width="128" height="128">
        <span>${icon.label}</span>
      </div>`
    );
  });
  requestAnimationFrame(() => $grid.find(".icon-card").addClass("is-in"));
  updateSelectBar();
}

function applySearch() {
  if (!icons.length) return;
  renderGrid(filteredIcons());
}

function closeMiniDlMenu() {
  $("#mini-dl-toggle").attr("aria-expanded", "false");
  $("#mini-dl-menu").prop("hidden", true);
}

function toggleMiniDlMenu() {
  const $toggle = $("#mini-dl-toggle");
  const open = $toggle.attr("aria-expanded") === "true";
  $toggle.attr("aria-expanded", open ? "false" : "true");
  $("#mini-dl-menu").prop("hidden", open);
  if (!open && selected) ensureIconSvg(selected).catch(console.error);
}

async function openMini(i) {
  selected = icons[i];
  closeMiniDlMenu();
  setFormat(format);
  $("#format-status").prop("hidden", true).text("");

  $(".icon-card").removeClass("is-selected");
  $(`.icon-card[data-i="${i}"]`).addClass("is-selected");

  $("#mini-title").text(selected.label || "Icon details");
  $("#detail-preview").attr({ src: iconSrc(selected), alt: selected.label || selected.id });
  $("#detail-meta").html(
    FIELDS.map(([key, label], m) => {
      const value = selected.meta[key] || "";
      return `<div style="--m:${m}"><dt>${label}</dt><dd>${value || "—"}</dd></div>`;
    }).join("")
  );

  // If current mode is SVG, make sure this icon's SVG is ready for the preview
  if (format === "svg") {
    $("#detail-preview").attr("src", await previewSrc(selected));
  } else {
    // Preload SVG in the background so Chrome can download it on the first click.
    ensureIconSvg(selected).catch(console.error);
  }

  const $mini = $("#mini").prop("hidden", false);
  $("body").addClass("mini-open");
  requestAnimationFrame(() => requestAnimationFrame(() => $mini.addClass("is-open")));
}

function closeMini() {
  closeMiniDlMenu();
  const $mini = $("#mini").removeClass("is-open");
  setTimeout(() => {
    selected = null;
    $mini.prop("hidden", true);
    $("body").removeClass("mini-open");
    $(".icon-card").removeClass("is-selected");
  }, 250);
}

async function loadGallery() {
  showStatus("Loading icons from Zenodo…");
  try {
    const record = await (await fetch(API)).json();
    files = Object.fromEntries((record.files || []).map((f) => [f.key, f.links.self]));

    const [csv, pngBuf] = await Promise.all([
      fetch(files["map-icon-metadata.csv"]).then((r) => r.text()),
      fetch(files["map-icon-png.zip"]).then((r) => r.arrayBuffer()),
    ]);

    showStatus("Unpacking icons…");
    pngZip = await JSZip.loadAsync(pngBuf);

    icons = (
      await Promise.all(
        parseCSV(csv).map(async (row) => {
          const id = row["unique-ID"];
          if (!id) return null;
          // Filename must be {unique-ID}.png inside map-icon-png/
          const png = await fileFromZip(pngZip, "png", id);
          if (!png) return null;
          return {
            id,
            label: row["primary-tags"] || "", // leave empty if no primary tag
            meta: row,
            png,
          };
        })
      )
    ).filter(Boolean);

    applySearch();
  } catch (err) {
    console.error(err);
    showStatus("Could not load icons. Use a local server (http://localhost), not a file:// page.", true);
  }
}

$(function () {
  loadGallery();

  // Sticky header shadow + scroll reveals
  const onScroll = () => $("header").toggleClass("is-scrolled", $(window).scrollTop() > 8);
  $(window).on("scroll", onScroll);
  onScroll();

  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && $(e.target).addClass("is-visible")),
      { threshold: 0.15 }
    );
    $(".reveal").each(function () {
      io.observe(this);
    });
  } else {
    $(".reveal").addClass("is-visible");
  }

  // Smooth in-page nav
  $('a[href^="#"]').on("click", function (e) {
    const id = $(this).attr("href");
    if (id.length > 1 && $(id).length) {
      e.preventDefault();
      $("html, body").animate({ scrollTop: $(id).offset().top - 72 }, 450);
    }
  });

  $("#search").on("submit", function (e) {
    e.preventDefault();
    applySearch();
  });

  $("#q").on("input", applySearch);

  $("#icon-grid").on("click", ".icon-card", function (e) {
    const i = +$(this).data("i");
    if (selectMode) {
      e.preventDefault();
      togglePicked(icons[i].id);
      return;
    }
    openMini(i);
  });

  $("#icon-grid").on("keydown", ".icon-card", function (e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    $(this).trigger("click");
  });

  $("#icon-grid").on("click", ".icon-check-wrap", function (e) {
    e.preventDefault();
    e.stopPropagation();
    const id = $(this).closest(".icon-card").data("id");
    togglePicked(id);
  });

  $("#select-toggle").on("click", function () {
    setSelectMode(!selectMode);
  });

  $("#select-done").on("click", function () {
    setSelectMode(false);
  });

  $("#select-clear").on("click", function () {
    picked.clear();
    applySearch();
  });

  $("#select-all").on("click", function () {
    filteredIcons().forEach((icon) => picked.add(icon.id));
    applySearch();
  });

  $("#select-dl-png").on("click", function () {
    downloadPicked("png", $(this));
  });

  $("#select-dl-svg").on("click", function () {
    downloadPicked("svg", $(this));
  });

  $("#select-dl-csv").on("click", function () {
    downloadPicked("csv", $(this));
  });

  $("#mini").on("click", ".mini-dl-option", function (e) {
    e.stopPropagation();
    downloadSelectedIcon($(this).attr("data-kind"), $(this));
    closeMiniDlMenu();
  });

  $("#mini-dl-toggle").on("click", function (e) {
    e.stopPropagation();
    toggleMiniDlMenu();
  });

  $("#mini-dl").on("mouseenter", function () {
    if (selected) ensureIconSvg(selected).catch(console.error);
  });

  $(document).on("click", function () {
    if ($("#mini-dl-toggle").attr("aria-expanded") === "true") closeMiniDlMenu();
  });

  $("#rainbow-toggle").on("click", async function () {
    const next = format === "png" ? "svg" : "png";
    $(this).prop("disabled", true);
    await setGridFormat(next);
    $(this).prop("disabled", false);
  });

  $("#detail-close, #mini-backdrop").on("click", closeMini);

  $(document).on("keydown", function (e) {
    if (e.key !== "Escape") return;
    if ($("#mini-dl-toggle").attr("aria-expanded") === "true") {
      closeMiniDlMenu();
      return;
    }
    if (!$("#mini").prop("hidden")) {
      closeMini();
      return;
    }
    if (selectMode) setSelectMode(false);
  });

  $("#mini").on("click", ".format-btn", async function () {
    if (!selected) return;
    const next = $(this).data("format");
    await setGridFormat(next);
    const $preview = $("#detail-preview").addClass("is-swapping");
    $preview.attr("src", await previewSrc(selected));
    setTimeout(() => $preview.removeClass("is-swapping"), 180);
  });
});
