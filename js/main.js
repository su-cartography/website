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

function enableDownloads() {
  $(".downloads .dl-btn").prop("disabled", false);
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

async function downloadZenodoFile(filename) {
  filename = filename || "";
  const url = files[filename];
  if (!url) {
    alert("Download link is not ready yet. Wait for icons to finish loading.");
    return;
  }

  const $btn = $(`.downloads .dl-btn[data-file="${filename}"]`);
  const label = $btn.text();
  $btn.prop("disabled", true).text("Downloading…");

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    saveBlob(await res.blob(), filename);
  } catch (err) {
    console.error(err);
    window.open(url, "_blank", "noopener");
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

function renderGrid(list) {
  const items = list || filteredIcons();
  const $grid = $("#icon-grid").removeClass("is-status is-error is-empty").empty();
  updateSearchCount(items.length);

  if (!items.length) {
    const msg = ($("#q").val() || "").trim()
      ? "No icons match your search."
      : "No icons found.";
    $grid.addClass("is-status is-empty").html(`<p class="icons-status">${msg}</p>`);
    return;
  }

  items.forEach((icon, i) => {
    const index = icons.indexOf(icon);
    $grid.append(
      `<button type="button" class="icon-card" data-i="${index}" style="--i:${i}">
        <img src="${iconSrc(icon)}" alt="" loading="lazy" width="128" height="128">
        <span>${icon.label}</span>
      </button>`
    );
  });
  requestAnimationFrame(() => $grid.find(".icon-card").addClass("is-in"));
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
    enableDownloads();
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

  $("#icon-grid").on("click", ".icon-card", function () {
    openMini(+$(this).data("i"));
  });

  $(".downloads .dl-btn").on("click", function () {
    downloadZenodoFile($(this).attr("data-file"));
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
    if (!$("#mini").prop("hidden")) closeMini();
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
