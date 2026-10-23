export const STATUS_LABELS = Object.freeze({reference:"Reference",queued:"To model",modeling:"In progress",modeled:"Modeled","needs-reference":"Needs reference"});

export function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

export function ratingLabel(item) {
  return item.rating === null ? "Not specified" : `${item.rating.replaceAll(".", ",").replaceAll("+", " + ")} g`;
}

export function filterCatalog(items, filters, annotations = {}) {
  const query = (filters.query || "").trim().toLocaleLowerCase();
  const result = items.filter((item) => {
    const status = annotations[item.id]?.status || item.status;
    return (!filters.brand || item.brand === filters.brand) && (!filters.shape || item.shape === filters.shape) && (!filters.status || status === filters.status) && (!query || `${item.id} ${item.title} ${item.brand} ${item.sourceName} ${item.rating || ""}`.toLocaleLowerCase().includes(query));
  });
  return result.sort((a,b) => {
    if (filters.sort === "rating") return ((a.ratingValue ?? 100000) - (b.ratingValue ?? 100000)) || a.id.localeCompare(b.id);
    if (filters.sort === "name") return a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
    return a.id.localeCompare(b.id);
  });
}

export function validateImport(input, catalog) {
  if (!input || input.schemaVersion !== 1 || input.kind !== "float-atlas-backup" || !Array.isArray(input.annotations)) throw new Error("Choose a Float Atlas database export.");
  if (input.annotations.length > catalog.length) throw new Error("The backup contains too many records.");
  const validIds = new Set(catalog.map((item) => item.id));
  const seen = new Set();
  return input.annotations.map((entry) => {
    if (!entry || !validIds.has(entry.id) || seen.has(entry.id)) throw new Error("The backup contains an unknown or duplicate float.");
    if (!Object.hasOwn(STATUS_LABELS, entry.status) || typeof entry.notes !== "string" || entry.notes.length > 20000) throw new Error("The backup contains an invalid note or modeling status.");
    seen.add(entry.id);
    return {id:entry.id,status:entry.status,notes:entry.notes,updatedAt:typeof entry.updatedAt === "string" ? entry.updatedAt : null};
  });
}

export function modelingBrief(item, annotation = {}) {
  return [
    `${item.id} - ${item.title}`,
    `Source name: ${item.sourceName}`,
    `Catalog rating: ${ratingLabel(item)}`,
    `Dimensions: ${item.dimensions}`,
    `Material: ${item.material}`,
    "",
    `Body: ${item.body}`,
    `Antenna: ${item.antenna || "Not confirmed"}`,
    `Keel: ${item.keel || "Not confirmed"}`,
    `Attachment: ${item.attachment || "Not confirmed"}`,
    `Palette: ${item.palette}`,
    "",
    item.modelBrief,
    item.geometryNote,
    item.familyNote,
    item.model ? `Exported model: ${item.model.lengthMm} mm / ${item.model.scaleBasis} / ${item.model.triangles} triangles.` : "",
    item.model?.dimensionNote,
    "",
    `Modeling status: ${STATUS_LABELS[annotation.status || item.status]}`,
    annotation.notes ? `My notes: ${annotation.notes}` : "",
    "",
    `Source: ${item.sourceUrl}`
  ].filter((line) => line !== undefined && line !== null).join("\n");
}
