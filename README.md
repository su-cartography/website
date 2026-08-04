# Gallery of Possibilities

A website for **Gallery of Possibilities** a feminist map icon gallery and QGIS plugin.


## What’s here

| Path | Purpose |
|------|---------|
| `index.html` | Homepage shell (search/gallery, about etc) |
| `resources.html` | Resources page  |
| `css/styles.css` | Minimal layout/nav styles |
| `js/main.js` | Loads icons from Zenodo (CSV + PNG zip) |
| `assets/` | Brand logo and QGIS map preview |

## Open locally

No install required. From the repo root:

**Option A — open the file**

1. Open `index.html` in a browser (double-click, or drag into a browser window).

**Option B — local server (required for icons)**

Icons load from Zenodo in the browser, so open the site over `http://` (not by double-clicking the file):

```bash
# Python 3
python -m http.server 8000
```

Then visit http://localhost:8000


