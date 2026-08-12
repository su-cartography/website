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

async function fileFromZip(zip, kind, id) {
  const path = `map-icon-${kind}/${id}.${kind}`;
  const file = zip.file(path);
  if (!file) return null;

  if (kind === "svg") {
    const text = svgForBrowser(await file.async("text"));
    return URL.createObjectURL(new Blob([text], { type: "image/svg+xml" }));
  }

  const bytes = await file.async("arraybuffer");
  return URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
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
    renderGrid();
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
  renderGrid();
}

function enableDownloads() {
  $(".dl-btn").prop("disabled", false);
}

async function downloadZenodoFile(filename) {
  const url = files[filename];
  if (!url) {
    alert("Download link is not ready yet. Wait for icons to finish loading.");
    return;
  }

  const $btn = $(`.dl-btn[data-file="${filename}"]`);
  const $label = $btn.find(".dl-label");
  const label = $label.text();
  $btn.prop("disabled", true);
  $label.text("Downloading…");

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
  } catch (err) {
    console.error(err);
    alert("Could not download that file. Please try again.");
  } finally {
    $btn.prop("disabled", false);
    $label.text(label);
  }
}

function showStatus(msg, error) {
  $("#icon-grid")
    .addClass("is-status")
    .toggleClass("is-error", !!error)
    .html(`<p class="icons-status">${msg}</p>`);
}

function renderGrid() {
  const $grid = $("#icon-grid").removeClass("is-status is-error").empty();
  icons.forEach((icon, i) => {
    $grid.append(
      `<button type="button" class="icon-card" data-i="${i}" style="--i:${i}">
        <img src="${iconSrc(icon)}" alt="" loading="lazy" width="128" height="128">
        <span>${icon.label}</span>
      </button>`
    );
  });
  requestAnimationFrame(() => $grid.find(".icon-card").addClass("is-in"));
}

async function openMini(i) {
  selected = icons[i];
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
  }

  const $mini = $("#mini").prop("hidden", false);
  $("body").addClass("mini-open");
  requestAnimationFrame(() => requestAnimationFrame(() => $mini.addClass("is-open")));
}

function closeMini() {
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

    renderGrid();
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

  $("#icon-grid").on("click", ".icon-card", function () {
    openMini(+$(this).data("i"));
  });

  $(".dl-btn").on("click", function () {
    downloadZenodoFile($(this).data("file"));
  });

  $("#rainbow-toggle").on("click", async function () {
    const next = format === "png" ? "svg" : "png";
    $(this).prop("disabled", true);
    await setGridFormat(next);
    $(this).prop("disabled", false);
  });

  $("#detail-close, #mini-backdrop").on("click", closeMini);

  $(document).on("keydown", function (e) {
    if (e.key === "Escape" && !$("#mini").prop("hidden")) closeMini();
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
