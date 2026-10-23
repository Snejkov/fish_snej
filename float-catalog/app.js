import {escapeHTML as h, STATUS_LABELS, ratingLabel, filterCatalog, validateImport, modelingBrief} from "./catalog-utils.js";
import {showModel,detachModel,setWireframe,resetModelView} from "./model-viewer.js";

const $ = (selector) => document.querySelector(selector);
const state = {items:[],models:{},annotations:{},selectedId:null,filters:{query:"",brand:"",shape:"",status:"",sort:"id"},db:null,saveTimer:null,toastTimer:null,pendingId:null,saveChain:Promise.resolve()};

function toast(message) {
  clearTimeout(state.toastTimer);
  $("#toast").textContent = message;
  $("#toast").classList.add("visible");
  state.toastTimer = setTimeout(() => $("#toast").classList.remove("visible"), 3300);
}

function transactionDone(transaction) {
  return new Promise((resolve,reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Database transaction failed."));
    transaction.onabort = () => reject(transaction.error || new Error("Database transaction was interrupted."));
  });
}

function requestResult(request) {
  return new Promise((resolve,reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function openDatabase(seed) {
  if (!window.indexedDB) throw new Error("Local database storage is unavailable.");
  const request = indexedDB.open("float-atlas-library", 1);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains("catalog")) db.createObjectStore("catalog", {keyPath:"id"});
    if (!db.objectStoreNames.contains("annotations")) db.createObjectStore("annotations", {keyPath:"id"});
  };
  const db = await requestResult(request);
  db.onversionchange = () => { db.close(); toast("The database changed in another tab. Reload this page."); };
  const catalogTransaction = db.transaction("catalog", "readwrite");
  const catalogDone = transactionDone(catalogTransaction);
  const catalogStore = catalogTransaction.objectStore("catalog");
  // Refresh immutable reference facts without replacing the owner's notes.
  for (const item of seed.items) catalogStore.put(item);
  await catalogDone;
  const readTransaction = db.transaction(["catalog","annotations"], "readonly");
  const [items, annotations] = await Promise.all([
    requestResult(readTransaction.objectStore("catalog").getAll()),
    requestResult(readTransaction.objectStore("annotations").getAll())
  ]);
  state.db = db;
  state.items = items.filter((item) => seed.items.some((current) => current.id === item.id));
  state.annotations = Object.fromEntries(annotations.filter((entry) => state.items.some((item) => item.id === entry.id)).map((entry) => [entry.id,entry]));
  $("#storage-state").textContent = "Local database ready";
}

function annotationFor(item) {
  return state.annotations[item.id] || {id:item.id,status:item.status,notes:"",updatedAt:null};
}

function stats() {
  $("#stat-total").textContent = state.items.length;
  $("#stat-images").textContent = state.items.filter((item) => item.imageStatus === "ready").length;
  $("#stat-modeled").textContent = Object.keys(state.models).length;
}

function populateFilters() {
  for (const [selector,key] of [["#brand-filter","brand"],["#shape-filter","shape"]]) {
    const values = [...new Set(state.items.map((item) => item[key]))].sort();
    for (const value of values) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      $(selector).append(option);
    }
  }
}

function filteredItems() { return filterCatalog(state.items,state.filters,state.annotations); }

function renderList() {
  const items = filteredItems();
  $("#result-count").textContent = items.length;
  $("#float-list").innerHTML = items.length ? items.map((item) => {
    const status = annotationFor(item).status;
    return `<button class="float-card${item.id === state.selectedId ? " active" : ""}" data-id="${h(item.id)}" type="button" aria-pressed="${item.id === state.selectedId}" aria-label="${h(item.id + ": " + item.title + ", " + ratingLabel(item))}">
      <span class="thumb">${item.image ? `<img src="${h(item.image)}" alt="" loading="lazy" data-thumbnail>` : `<span class="thumb-empty" aria-hidden="true">?</span>`}</span>
      <span class="card-content"><span class="card-top"><span>${h(item.id)} / ${h(item.brand)}</span>${status === "modeled" ? '<i class="modeled-dot" aria-label="Modeled"></i>' : ""}</span><span class="card-title">${h(item.title)}</span><span class="card-bottom"><span class="mini-rating">${h(ratingLabel(item))}</span><span>${h(item.length ? item.length + " mm" : item.shape)}</span></span></span>
    </button>`;
  }).join("") : '<p class="empty-list">No floats match.<small>Try a different name or clear your filters.</small></p>';
  $("#float-list").querySelectorAll("[data-thumbnail]").forEach((img) => img.addEventListener("error", () => { img.hidden = true; }, {once:true}));
  updateNavigation();
}

function updateNavigation() {
  const items = filteredItems();
  const index = items.findIndex((item) => item.id === state.selectedId);
  const counter = $("#detail-counter");
  if (!counter) return;
  counter.textContent = index < 0 ? `Outside filter / ${items.length}` : `${String(index+1).padStart(2,"0")} / ${String(items.length).padStart(2,"0")}`;
  $("#previous-float").disabled = index <= 0;
  $("#next-float").disabled = index < 0 || index >= items.length-1;
}

function renderDetail() {
  detachModel();
  const item = state.items.find((entry) => entry.id === state.selectedId);
  if (!item) return;
  const annotation = annotationFor(item);
  const model = state.models[item.id];
  const missing = !item.image;
  const imageContent = missing
    ? '<div class="image-missing"><strong>A reference is missing.</strong><span>The source photos show fishing line instead of this float. Its catalog facts are retained; the shape has not been invented.</span></div>'
    : `<img id="reference-image" class="reference-image" src="${h(item.image)}" alt="${h(item.title)} - one complete upright float on a neutral background"><button id="zoom-image" class="zoom-button" type="button">View full size &#8599;</button>`;
  const fact = (label,value) => `<div><dt>${h(label)}</dt><dd>${h(value || "Not confirmed")}</dd></div>`;
  $("#detail").innerHTML = `
    <div class="detail-top"><div class="breadcrumb">Collection <span aria-hidden="true"> / </span> ${h(item.brand)} <span aria-hidden="true"> / </span> <b>${h(item.shape)}</b></div><div class="detail-nav"><span id="detail-counter"></span><button id="previous-float" class="nav-button" type="button" aria-label="Previous float">&#8592;</button><button id="next-float" class="nav-button" type="button" aria-label="Next float">&#8594;</button></div></div>
    <div class="object-heading"><div><h2>${h(item.title)}</h2><p class="source-name" lang="ru">${h(item.sourceName)}</p></div><span class="object-code">${h(item.id)}</span></div>
    <div class="object-layout">
      <div class="image-column"><div class="reference-frame"><span class="frame-tag">FRONT REFERENCE / VERTICAL</span>${imageContent}</div><div class="image-meta"><span>INDIVIDUAL REFERENCE</span><span>PROPORTIONS ARE ILLUSTRATIVE</span></div><div class="image-actions">${missing ? "" : `<a class="button small" href="${h(item.image)}" download="${h(item.id.toLowerCase())}-float-reference.png">Download PNG <span aria-hidden="true">&#8595;</span></a>`}<a class="button secondary small" href="${h(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">Source product <span aria-hidden="true">&#8599;</span></a></div></div>
      <div class="construction-column"><p class="section-label">OBJECT / CONSTRUCTION</p><div class="fact-row"><div class="fact-box"><span>CATALOG RATING</span><strong${item.rating === null ? ' class="small-value"' : ""}>${h(ratingLabel(item))}</strong><small>${item.ratingSource === "catalog name" ? "Original catalog marking" : item.ratingSource === "not specified on product page" ? "No rating given by source" : "Verified in product details"}</small></div><div class="fact-box"><span>LISTED SIZE</span><strong${!item.length || item.id === "F09" || item.id === "F40" ? ' class="small-value"' : ""}>${h(item.length ? item.length + " mm" : "Not specified")}</strong><small>${item.id === "F09" || item.id === "F40" ? "h-16 designation; assembly unconfirmed" : "Source length; no inferred diameter"}</small></div></div><dl class="detail-facts">${fact("Profile",item.shape)}${fact("Body",item.body)}${fact("Antenna",item.antenna)}${fact("Keel",item.keel)}${fact("Attachment",item.attachment)}${fact("Material",item.material)}</dl><p class="construction-note">${h(item.geometryNote)}</p></div>
    </div>
    <section class="modeling-section" aria-label="3D modeling notes"><div class="modeling-header"><h3>From reference to 3D</h3><label class="status-field">Modeling status<select id="model-status" aria-label="Modeling status">${Object.entries(STATUS_LABELS).map(([key,label]) => `<option value="${h(key)}"${annotation.status === key ? " selected" : ""}>${h(label)}</option>`).join("")}</select></label></div><p class="brief-text">${h(item.modelBrief)}</p>${item.familyNote ? `<p class="family-note">${h(item.familyNote)}</p>` : ""}<label class="notes-label" for="model-notes">YOUR MODELING NOTES</label><textarea id="model-notes" maxlength="20000" placeholder="Add measurements, modeling decisions, texture notes, or the location of your 3D file...">${h(annotation.notes)}</textarea><div class="notes-footer"><span id="save-state">${annotation.updatedAt ? "Saved on this device" : "Notes save automatically on this device"}</span><button id="copy-brief" class="button small copy-brief" type="button">Copy 3D brief</button></div></section>`;
  $("#detail").setAttribute("aria-busy","false");
  if (model) installModelPanel(item,model);
  updateNavigation();
  $("#previous-float").addEventListener("click", () => navigate(-1));
  $("#next-float").addEventListener("click", () => navigate(1));
  $("#model-notes").addEventListener("input", () => queueSave(item.id));
  $("#model-notes").addEventListener("blur", () => flushSave());
  $("#model-status").addEventListener("change", () => { queueSave(item.id); flushSave(); });
  $("#copy-brief").addEventListener("click", () => copyBrief(item));
  if (!missing) {
    $("#reference-image").addEventListener("error", (event) => {
      event.currentTarget.hidden = true;
      $("#zoom-image").hidden = true;
      const message = document.createElement("div");
      message.className = "image-missing";
      message.innerHTML = '<strong>Reference rendering in progress.</strong><span>This individual image is being prepared. Reload the page when the collection is complete.</span>';
      $(".reference-frame").append(message);
    }, {once:true});
    $("#zoom-image").addEventListener("click", () => {
      $("#full-image").src = item.image;
      $("#full-image").alt = `${item.id} - ${item.title}`;
      $("#full-image-caption").textContent = `${item.id} / ${item.title} / ${ratingLabel(item)}`;
      $("#image-dialog").showModal();
    });
  }
}

function installModelPanel(item,model) {
  const base=`assets/models/${item.id.toLowerCase()}/`;
  const frame=$(".reference-frame");
  const controls=document.createElement("div");
  controls.className="view-controls";
  controls.innerHTML='<div class="view-tabs"><button id="view-model" class="active" type="button" aria-pressed="true">3D model</button><button id="view-reference" type="button" aria-pressed="false">Reference</button></div><div class="view-tools"><button id="wireframe" type="button" aria-pressed="false">Wireframe</button><button id="reset-view" type="button">Reset view</button></div>';
  frame.before(controls);
  const host=document.createElement("div");
  host.className="model-viewport";
  host.innerHTML='<p class="viewer-caption" role="status">Loading Blender model...</p>';
  frame.prepend(host);
  const setView=(three) => {
    host.hidden=!three;
    $("#reference-image").hidden=three;
    $("#zoom-image").hidden=three;
    $(".frame-tag").textContent=three ? "LOW-POLY / Y-UP / METERS" : "FRONT REFERENCE / VERTICAL";
    for (const [id,active] of [["#view-model",three],["#view-reference",!three]]) {
      $(id).classList.toggle("active",active);$(id).setAttribute("aria-pressed",String(active));
    }
    $(".view-tools").hidden=!three;
  };
  $("#view-model").addEventListener("click",() => setView(true));
  $("#view-reference").addEventListener("click",() => setView(false));
  $("#wireframe").addEventListener("click",(event) => {
    const active=event.currentTarget.getAttribute("aria-pressed")!=="true";
    event.currentTarget.setAttribute("aria-pressed",String(active));
    setWireframe(active);
  });
  $("#reset-view").addEventListener("click",resetModelView);
  setView(true);
  $(".image-meta").innerHTML=`<span>${model.triangles} TRIANGLES / 1 MATERIAL</span><span>256 x 1024 / WEBP Q90</span>`;
  const downloads=document.createElement("div");
  downloads.className="model-downloads";
  downloads.innerHTML=`<a class="button" href="${h(base+model.files.fbx)}" download>Download FBX &#8595;</a><a class="button secondary" href="${h(base+model.files.texture)}" download="${h(item.id.toLowerCase())}-basecolor.webp">WebP texture &#8595;</a><a href="downloads/${h(item.id.toLowerCase())}.zip" download>Model package</a><a href="${h(base+model.files.blend)}" download>Blender source</a><a href="${h(base+model.files.glb)}" download>GLB</a><a href="${h(base)}model.json" target="_blank" rel="noopener">Model details</a>`;
  $(".image-actions").before(downloads);
  const dimensions=document.createElement("section");
  dimensions.className="model-dimensions";
  const exact=model.scaleBasis==="catalog-length";
  dimensions.innerHTML=`<p class="section-label">EXPORTED MODEL</p><div class="model-size"><strong>${model.lengthMm} <small>mm</small></strong><span class="scale-badge${exact ? "" : " estimated"}">${exact ? "Catalog length" : model.scaleBasis==="catalog-range-midpoint" ? "Range midpoint" : "Estimated scale"}</span></div><p>${h(model.dimensionNote)}</p><dl><div><dt>Approx. diameter</dt><dd>${Number(Math.max(...model.dimensionsMm.slice(0,2))).toFixed(2)} mm</dd></div><div><dt>Topology</dt><dd>${model.triangles} triangles / 12 radial sides</dd></div><div><dt>Material</dt><dd>1 UV texture / WebP quality 90</dd></div><div><dt>Origin / axis</dt><dd>Bottom center / Y-up exports</dd></div></dl>`;
  $(".construction-column").prepend(dimensions);
  showModel(model,host);
}

function queueSave(id) {
  clearTimeout(state.saveTimer);
  const item = state.items.find((entry) => entry.id === id);
  state.annotations[id] = {id,notes:$("#model-notes").value,status:$("#model-status").value,updatedAt:new Date().toISOString()};
  state.pendingId = id;
  $("#save-state").textContent = "Saving...";
  state.saveTimer = setTimeout(() => flushSave(), 350);
  stats();
  if (!item) return;
}

async function flushSave() {
  clearTimeout(state.saveTimer);
  const id = state.pendingId;
  state.pendingId = null;
  if (!id) return state.saveChain;
  const entry = {...state.annotations[id]};
  state.saveChain = state.saveChain.then(async () => {
    if (!state.db) {
      if (state.selectedId === id && $("#save-state")) $("#save-state").textContent = "Session only - database unavailable";
      return;
    }
    const transaction = state.db.transaction("annotations", "readwrite");
    const done = transactionDone(transaction);
    transaction.objectStore("annotations").put(entry);
    await done;
    if (state.selectedId === id && $("#save-state")) $("#save-state").textContent = "Saved on this device";
    renderList();
  }).catch((error) => { if ($("#save-state")) $("#save-state").textContent = "Could not save - export a backup"; toast(error.message || "Could not save this note."); });
  return state.saveChain;
}

async function selectFloat(id, updateHash = true) {
  if (!state.items.some((item) => item.id === id)) return;
  await flushSave();
  state.selectedId = id;
  if (updateHash) history.replaceState(null,"",`#${id}`);
  renderList();
  renderDetail();
}

async function navigate(direction) {
  const items = filteredItems();
  const index = items.findIndex((item) => item.id === state.selectedId);
  const item = items[index + direction];
  if (item) await selectFloat(item.id);
}

async function copyBrief(item) {
  await flushSave();
  const text = modelingBrief(item,annotationFor(item));
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else {
      const field = document.createElement("textarea");
      field.value = text;
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.append(field);
      field.select();
      if (!document.execCommand("copy")) throw new Error("Copy is unavailable in this browser.");
      field.remove();
    }
    toast("3D modeling brief copied.");
  } catch { toast("Copy is unavailable. Export the database to keep the complete brief."); }
}

async function exportDatabase() {
  await flushSave();
  const backup = {kind:"float-atlas-backup",schemaVersion:1,exportedAt:new Date().toISOString(),catalog:state.items,annotations:state.items.map((item) => annotationFor(item))};
  const blob = new Blob([JSON.stringify(backup,null,2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "float-atlas-database.json";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("Database exported with all catalog facts and modeling notes.");
}

async function importDatabase(file) {
  if (!file) return;
  try {
    if (!state.db) throw new Error("Local storage is unavailable. A backup cannot be imported safely.");
    if (file.size > 3_000_000) throw new Error("Choose a database backup smaller than 3 MB.");
    const imported = validateImport(JSON.parse(await file.text()),state.items);
    await flushSave();
    const transaction = state.db.transaction("annotations", "readwrite");
    const done = transactionDone(transaction);
    for (const entry of imported) transaction.objectStore("annotations").put(entry);
    await done;
    for (const entry of imported) state.annotations[entry.id] = entry;
    renderList();
    renderDetail();
    stats();
    toast(`Imported notes and statuses for ${imported.length} floats.`);
  } catch (error) { toast(error.message || "This backup could not be imported. Existing notes are unchanged."); }
  finally { $("#import-file").value = ""; }
}

function bindEvents() {
  $("#float-list").addEventListener("click", (event) => { const card = event.target.closest("[data-id]"); if (card) selectFloat(card.dataset.id); });
  $("#search").addEventListener("input", (event) => { state.filters.query = event.target.value; renderList(); });
  for (const [selector,key] of [["#brand-filter","brand"],["#shape-filter","shape"],["#status-filter","status"],["#sort","sort"]]) {
    $(selector).addEventListener("change", (event) => { state.filters[key] = event.target.value; renderList(); });
  }
  $("#clear-filters").addEventListener("click", () => {
    state.filters = {query:"",brand:"",shape:"",status:"",sort:"id"};
    $("#search").value = "";
    for (const selector of ["#brand-filter","#shape-filter","#status-filter"]) $(selector).value = "";
    $("#sort").value = "id";
    renderList();
  });
  $("#export-db").addEventListener("click", exportDatabase);
  $("#import-db").addEventListener("click", () => $("#import-file").click());
  $("#import-file").addEventListener("change", (event) => importDatabase(event.target.files[0]));
  $("#close-image").addEventListener("click", () => $("#image-dialog").close());
  $("#image-dialog").addEventListener("click", (event) => { if (event.target === $("#image-dialog")) $("#image-dialog").close(); });
  addEventListener("hashchange", () => selectFloat(location.hash.slice(1).toUpperCase(), false));
  addEventListener("pagehide", () => flushSave());
}

async function initialize() {
  try {
    const response = await fetch("data/catalog.json", {cache:"no-store"});
    if (!response.ok) throw new Error("The reference database could not be loaded.");
    const seed = await response.json();
    const modelResponse = await fetch("data/models.json",{cache:"no-store"});
    if (modelResponse.ok) {
      const manifest=await modelResponse.json();
      state.models=Object.fromEntries(manifest.models.map((model) => [model.id,model]));
    }
    if (seed.schemaVersion !== 1 || !Array.isArray(seed.items) || !seed.items.length) throw new Error("The reference database has an unsupported format.");
    state.items = seed.items;
    try { await openDatabase(seed); }
    catch { $("#storage-state").textContent = "Session only - storage unavailable"; toast("Local storage is unavailable. Export notes before closing this page."); }
    populateFilters();
    bindEvents();
    stats();
    const requested = location.hash.slice(1).toUpperCase();
    await selectFloat(state.items.some((item) => item.id === requested) ? requested : state.items[0].id);
  } catch (error) {
    document.body.classList.add("error");
    $("#detail").textContent = error.message || "The collection could not be opened.";
    $("#float-list").textContent = "Open this folder through a local HTTP preview server.";
    $("#detail").setAttribute("aria-busy","false");
  }
}

initialize();
