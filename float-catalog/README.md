# Float reference preview

A buildless local asset viewer with 54 Blender low-poly models, individual references, construction descriptions, and modeling notes. Rotate the model, toggle its wireframe, compare the reference, and download individual FBX, WebP, GLB, Blender sources, or the complete ZIP. Open `index.html` through a static HTTP server. No Node runtime, installation, CDN, or build step is required by the application.

From this directory:

```powershell
python -m http.server 8765 --bind 127.0.0.1
```

Then open `http://127.0.0.1:8765/` in a browser.

## Data

- `data/catalog.json` contains 55 entries and the source URLs, exact source names, catalog ratings, stated lengths, construction descriptions, and modeling guidance.
- `assets/floats/` contains an individual upright reference PNG for each of the 54 entries with a usable source image. The remaining entry, F53, has incorrect source photos showing fishing line; no replacement shape is invented.
- Model families with reused source photos share a normalized illustration. Each catalog entry still has its own PNG filename. Physical differences between rating variants are not inferred from the rating.
- The source names are preserved verbatim as requested. JSON uses ASCII Unicode escapes; the interface, documentation, and modeling descriptions are English.
- The source ratings are markings, not verified object masses. Expert's compound marking remains compound. Widths and part dimensions are not measured.

## Blender assets

- `assets/models/fNN/` contains the FBX (with embedded WebP), external `basecolor.webp`, self-contained GLB, editable `.blend`, and `model.json` for each illustrated catalog entry.
- `float-library.blend`, `.fbx` and `.glb` contain all 54 models in real meter units. Native Blender uses Z up; FBX and GLB exports use Y up. Each model has one triangulated mesh, one material, a UV map, and its origin at the bottom center. Named vertex groups separate the rotational form and the open line eye. The combined FBX uses uniquely named WebP images in `assets/library-textures/`.
- Textures use lossy WebP quality 90 at 256 x 1024 pixels. F11 preserves alpha. The palette is flattened from the illustrations to remove baked photographic highlights.
- 14 models use a single source length; F47 uses the 195 mm midpoint of the 190-200 mm range. The other 39 lengths are working estimates. All diameters and component proportions are approximate. Shared illustrations are not evidence of exact differences between load variants.
- `data/models.json` records dimensions, scale basis, triangle counts, and export paths. `data/model-validation.json` records the FBX reimport checks, exact embedded texture bytes, WebP encoding and standalone GLB checks.
- `downloads/` has the combined archive, 54 individual model packages, a CSV index, and a direct download table. `assets/model-library.webp` is the numbered Blender contact render.
- `tools/prepare_models.py` derives rotational profiles and band textures with Python/Pillow/NumPy. `tools/build_models.py` builds, exports, saves and reimports through Blender. `tools/package_models.py` validates and packages the results. These are offline developer tools, not application dependencies.

## Local database and backup

The browser's IndexedDB stores the catalog and a separate annotations collection. Modeling statuses and notes persist across reloads on the same browser origin. Source facts refresh from the seed file without replacing notes.

Use **Download database** to save the full catalog and your notes as JSON. **Import notes** validates the complete backup before applying its notes and statuses in one transaction. It does not replace the reference facts or images. Keep a backup when changing browsers, ports, or computers. No data is sent to a server.

## Checks

Developer validation uses Node's test runner only; it is not an application dependency:

```powershell
node --test tests/catalog.test.mjs tests/models.test.mjs tests/library-import.test.mjs tests/thumbnails.test.mjs
```

## Asset-library import

`tools/prepare_publication.py` prepares the reviewed collection for the owner's existing asset library at `http://144.31.28.132/`. It uses the existing `bobbers` category and UI, preserves all unrelated catalog records, and adds one entry for each of the 54 available floats. `tools/render_thumbnails.py` imports each exact exported GLB separately and renders a complete centered thumbnail. `data/thumbnails.json` binds every icon to its catalog ID and GLB checksum. Publication verifies both the GLB and icon checksums, and uses versioned thumbnail URLs to refresh caches. Entries are marked as reserve assets with no claimed game integration.

`data/library-import.json` records the imported entries; `data/library-publication.json` records the destination, baseline and candidate catalog checksums, and release identifier. No credentials are stored. The ignored `publication/` directory holds the fetched public UI snapshot, local review, payload, and file checksums. The local review is available under `/publication/preview/#/category/bobbers` when serving this directory.

The publication payload changes only the catalog and adds namespaced float assets, thumbnails, individual archives, and the complete collection. It does not replace the asset-library UI or existing model files. Publishing follows the repository's preview acceptance rules.

### Server-readable model feed

After publication, `http://144.31.28.132/assets/floats/catalog.json` provides a stable JSON manifest for later server integration. `data/library-feed.json` is the local copy. The feed lists all 54 models, source names and loading ratings, meter dimensions, scale limitations, triangle counts, and absolute GLB/FBX/WebP/package URLs with byte lengths and SHA-256 checksums. Asset URLs include a content version query so caches refresh when an asset changes.

The game server can fetch the manifest, compare its `version`, download changed `items[].files.glb.url` resources, verify `sha256`, and keep a local cache. GLB already embeds its WebP texture. Separate FBX and WebP URLs are also provided. Hosting this feed prepares the download contract; game-side fetching and model replacement are a later integration step.
