import { CATALOG, findItem } from "./gear/catalog.js";
import { CLOTHING_SLOTS } from "./gear/inventory.js";

const textElement = (tag, className, text) => {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
};
export const formatPlaytime = (seconds) => `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m`;

export class SnejUI {
  constructor(game) {
    this.game = game;
    this.hudVisible = true;
    this.buildOpen = false;
    this.profileOpen = false;
    this.inventoryOpen = false;
    this.profileTab = "profile";
    this.currentInventoryCategory = "rod";
    this.inventoryFocus = null;
    this.draggedGearId = null;
    this.modalOpen = false;
    this.fpsTimer = 0;
    this.frames = 0;
    this.fps = 0;
    this.toastTimer = 0;
    this.el = {
      registration: document.getElementById("registration-screen"),
      registrationName: document.getElementById("registration-name"),
      registrationValidation: document.getElementById("registration-validation"),
      register: document.getElementById("register-player"),
      title: document.getElementById("title-screen"),
      launcherProfileInitial: document.getElementById("launcher-profile-initial"),
      launcherProfileName: document.getElementById("launcher-profile-name"),
      launcherProfileMeta: document.getElementById("launcher-profile-meta"),
      newGame: document.getElementById("new-game"),
      pause: document.getElementById("pause-screen"),
      continue: document.getElementById("continue-game"),
      online: document.getElementById("online-game"),
      onlineSetup: document.getElementById("online-setup"),
      onlineIdentity: document.getElementById("online-identity"),
      onlineRoom: document.getElementById("online-room"),
      networkStatus: document.getElementById("network-status"),
      peerSection: document.getElementById("peer-list-section"),
      peerList: document.getElementById("peer-list"),
      profilePanel: document.getElementById("profile-panel"),
      profileName: document.getElementById("profile-name"),
      profileId: document.getElementById("profile-id"),
      profileCoins: document.getElementById("profile-coins"),
      profileTabs: document.getElementById("profile-tabs"),
      profileTabButtons: document.querySelectorAll("#profile-tabs [data-tab]"),
      profileContentProfile: document.getElementById("profile-tab-profile"),
      profileContentLog: document.getElementById("profile-tab-log"),
      profileContentStats: document.getElementById("profile-tab-stats"),
      profileLogList: document.getElementById("profile-log-list"),
      profileStatsList: document.getElementById("profile-stats-list"),
      inventoryPanel: document.getElementById("inventory-panel"),
      inventoryCoins: document.getElementById("inventory-coins"),
      inventoryGrid: document.getElementById("inventory-grid"),
      inventoryCategory: document.getElementById("inventory-category"),
      equipmentName: document.getElementById("equipment-player-name"),
      equipmentSlots: document.getElementById("equipment-slots"),
      inventoryCastRange: document.getElementById("inventory-cast-range"),
      rodLine: document.getElementById("rod-line"),
      baitLine: document.getElementById("bait-line"),
      identityModal: document.getElementById("identity-modal"),
      identityName: document.getElementById("identity-name"),
      identityValidation: document.getElementById("identity-validation"),
      identitySave: document.getElementById("identity-save"),
      buildPanel: document.getElementById("build-panel"),
      buildChip: document.getElementById("build-chip"),
      hint: document.getElementById("hint-bar"),
      textureInput: document.getElementById("texture-input"),
      textureList: document.getElementById("texture-list"),
      manifestFile: document.getElementById("manifest-file"),
      manifestText: document.getElementById("manifest-text"),
      hud: document.getElementById("hud"),
      arrow: document.getElementById("compass-arrow"),
      pos: document.getElementById("pos-line"),
      depth: document.getElementById("depth-line"),
      camera: document.getElementById("camera-line"),
      viewChip: document.getElementById("view-chip"),
      fps: document.getElementById("fps"),
      pauseMain: document.getElementById("pause-main"),
      pauseSettings: document.getElementById("pause-settings"),
      toast: document.getElementById("toast")
    };
    this.ensureInventoryPanel();
    this.bind();
    this.renderSettings(document.getElementById("title-settings"));
    this.renderSettings(document.getElementById("menu-settings"));
    this.el.online.classList.toggle("hidden", !game.mpEnabled);
    this.updateViewChip(game);
    this.updateProfile();
    this.refreshContinue();
  }

  ensureInventoryPanel() {
    const layout = this.el.inventoryPanel.querySelector(".inventory-layout");
    const equipment = layout?.querySelector(".equipment-panel");
    const browser = layout?.querySelector(".inventory-browser");
    if (!layout || !equipment || !browser || layout.dataset.ready === "true") return;
    layout.dataset.ready = "true";
    equipment.classList.add("character-panel");
    const figure = equipment.querySelector(".equipment-figure");
    const slots = this.el.equipmentSlots;
    const rig = equipment.querySelector(".inventory-rig");
    const clothingTitle = textElement("h4", "inventory-subtitle", "Clothing");
    const clothing = textElement("div", "clothing-slots", "");
    clothing.id = "clothing-slots";
    for (const slot of CLOTHING_SLOTS) {
      const button = textElement("button", "clothing-slot secondary", "");
      button.type = "button";
      button.dataset.clothingSlot = slot.id;
      button.append(textElement("span", "slot-kind", slot.label), textElement("strong", "", "Empty"));
      clothing.append(button);
    }
    const gearTitle = textElement("h4", "inventory-subtitle", "Current Gear");
    figure.after(clothingTitle, clothing, gearTitle);
    const loadouts = textElement("section", "loadout-panel", "");
    loadouts.setAttribute("aria-label", "Custom equipment sets");
    loadouts.innerHTML = `
      <h3>Sets</h3>
      <label class="compact-field" for="loadout-name"><span>Name</span><input id="loadout-name" type="text" maxlength="24" autocomplete="off"></label>
      <button id="loadout-save" type="button">Save Current</button>
      <div id="loadout-list" class="loadout-list" aria-live="polite"></div>
    `;
    layout.replaceChildren(equipment, loadouts, browser);
    equipment.append(slots, rig);
    this.el.clothingSlots = clothing;
    this.el.loadoutName = loadouts.querySelector("#loadout-name");
    this.el.loadoutSave = loadouts.querySelector("#loadout-save");
    this.el.loadoutList = loadouts.querySelector("#loadout-list");
  }

  bind() {
    this.el.registrationName.addEventListener("input", () => this.validateNameField(
      this.el.registrationName,
      this.el.registrationValidation,
      this.el.register
    ));
    this.el.registrationName.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !this.el.register.disabled) this.register();
    });
    this.el.register.addEventListener("click", () => this.register());
    this.el.newGame.addEventListener("click", () => this.game.newGame());
    this.el.continue.addEventListener("click", () => this.game.continueGame());
    this.el.online.addEventListener("click", () => this.el.onlineSetup.classList.remove("hidden"));
    document.getElementById("online-cancel").addEventListener("click", () => this.el.onlineSetup.classList.add("hidden"));
    document.getElementById("online-connect").addEventListener("click", () => this.game.startOnline(this.el.onlineRoom.value));
    document.getElementById("resume-game").addEventListener("click", () => this.game.resume());
    document.getElementById("show-settings").addEventListener("click", () => this.showMenuSettings(true));
    document.getElementById("back-menu").addEventListener("click", () => this.showMenuSettings(false));
    document.getElementById("new-lake").addEventListener("click", () => this.game.newLake());
    document.getElementById("quit-title").addEventListener("click", () => this.game.quitToTitle());
    document.getElementById("title-profile").addEventListener("click", () => this.toggleProfile());
    document.getElementById("pause-profile").addEventListener("click", () => this.toggleProfile());
    document.getElementById("pause-inventory").addEventListener("click", () => {
      this.game.resume();
      this.toggleInventory();
    });
    document.getElementById("profile-close").addEventListener("click", () => this.closeProfile());
    document.getElementById("change-name").addEventListener("click", () => this.openNameModal());
    document.getElementById("sign-out").addEventListener("click", () => this.game.signOut());
    for (const button of this.el.profileTabButtons) {
      button.addEventListener("click", () => this.openProfileTab(button.dataset.tab));
    }
    document.getElementById("inventory-close").addEventListener("click", () => this.closeInventory());
    for (const button of this.el.inventoryCategory.querySelectorAll("[data-category]")) {
      button.addEventListener("click", () => {
        this.currentInventoryCategory = button.dataset.category;
        this.refreshInventory();
      });
    }
    this.bindTabKeys(this.el.profileTabs);
    this.bindTabKeys(this.el.inventoryCategory);
    this.el.clothingSlots?.addEventListener("click", (event) => {
      const slot = event.target.closest("[data-clothing-slot]");
      if (slot) this.showToast("Clothing slots are ready for future clothing items.");
    });
    this.el.loadoutSave?.addEventListener("click", () => this.saveLoadout());
    this.el.loadoutName?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") this.saveLoadout();
    });
    this.el.loadoutList?.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-loadout]");
      if (!button) return;
      if (button.dataset.action === "apply") this.applyLoadout(button.dataset.loadout);
      if (button.dataset.action === "delete") this.deleteLoadout(button.dataset.loadout);
    });
    this.el.inventoryGrid.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-item]");
      if (button) {
        if (!button.disabled) this.inventoryAction(button.dataset.action, button.dataset.item);
        return;
      }
      const card = event.target.closest("article[data-item]");
      if (card?.draggable) this.inventoryAction("equip", card.dataset.item);
    });
    this.el.inventoryGrid.addEventListener("keydown", (event) => {
      const card = event.target;
      if (!card.matches("article[draggable=true]") || !["Enter", " "].includes(event.key)) return;
      event.preventDefault();
      this.inventoryAction("equip", card.dataset.item);
    });
    this.el.inventoryGrid.addEventListener("dragstart", (event) => {
      const card = event.target.closest("article[data-item]");
      const item = card && findItem(card.dataset.item);
      if (!item || !card.draggable || !event.dataTransfer) return event.preventDefault();
      this.draggedGearId = item.id;
      event.dataTransfer.setData("application/x-snej-gear", item.id);
      event.dataTransfer.effectAllowed = "move";
      this.el.equipmentSlots.querySelector(`[data-slot="${item.kind}"]`).classList.add("drop-ready");
    });
    this.el.inventoryPanel.addEventListener("dragend", () => this.clearGearDrag());
    for (const slot of this.el.equipmentSlots.querySelectorAll("[data-slot]")) {
      slot.addEventListener("click", () => {
        this.currentInventoryCategory = slot.dataset.slot;
        this.refreshInventory();
        this.el.inventoryCategory.querySelector('[aria-selected="true"]').focus();
      });
      slot.addEventListener("dragover", (event) => {
        const item = findItem(this.draggedGearId);
        if (!this.canDropGear(item, slot.dataset.slot)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        slot.classList.add("drop-target");
      });
      slot.addEventListener("dragleave", (event) => {
        if (!slot.contains(event.relatedTarget)) slot.classList.remove("drop-target");
      });
      slot.addEventListener("drop", (event) => {
        event.preventDefault();
        const id = event.dataTransfer?.getData("application/x-snej-gear");
        const item = findItem(id);
        if (id === this.draggedGearId && this.canDropGear(item, slot.dataset.slot)) {
          this.inventoryAction("equip", id);
          slot.focus();
        }
        this.clearGearDrag();
      });
    }
    this.el.inventoryPanel.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.closeInventory();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = [...this.el.inventoryPanel.querySelectorAll('button:not(:disabled), input:not(:disabled), [tabindex="0"]')]
        .filter((element) => element.tabIndex >= 0 && element.getClientRects().length);
      const next = event.shiftKey ? controls.at(-1) : controls[0];
      if (document.activeElement === (event.shiftKey ? controls[0] : controls.at(-1))) {
        event.preventDefault();
        next?.focus();
      }
    });
    this.el.identityName.addEventListener("input", () => this.validateNameField(
      this.el.identityName,
      this.el.identityValidation,
      this.el.identitySave
    ));
    this.el.identityName.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !this.el.identitySave.disabled) this.saveName();
      if (event.key === "Escape") this.closeNameModal();
    });
    this.el.identitySave.addEventListener("click", () => this.saveName());
    document.getElementById("identity-cancel").addEventListener("click", () => this.closeNameModal());
    document.getElementById("texture-upload").addEventListener("click", () => this.el.textureInput.click());
    this.el.textureInput.addEventListener("change", () => this.uploadTextures(this.el.textureInput.files));
    document.getElementById("manifest-export").addEventListener("click", () => this.exportManifest());
    document.getElementById("manifest-file-button").addEventListener("click", () => this.el.manifestFile.click());
    this.el.manifestFile.addEventListener("change", () => this.importManifestFile());
    document.getElementById("manifest-paste-import").addEventListener("click", () => this.importManifest(this.el.manifestText.value));
    document.getElementById("build-save").addEventListener("click", () => this.saveBuild());
    document.getElementById("build-discard").addEventListener("click", () => this.discardBuild());
    document.getElementById("build-close").addEventListener("click", () => this.discardBuild());
    for (const input of document.querySelectorAll('input[name="surface"]')) {
      input.addEventListener("change", () => this.game.placementSystem.setSurface(input.value));
    }
    for (const input of document.querySelectorAll('input[name="build-tool"]')) {
      input.addEventListener("change", () => this.game.placementSystem.setTool(input.value));
    }
  }

  register() {
    const result = this.game.registerPlayer(this.el.registrationName.value);
    if (!result.ok) this.showToast(result.message);
  }

  validateNameField(input, message, button) {
    const validation = this.game.auth.validateName(input.value);
    message.textContent = validation.message;
    message.classList.toggle("valid", validation.valid);
    button.disabled = !validation.valid;
    return validation;
  }

  renderSettings(root) {
    root.innerHTML = "";
    const defs = [
      { key: "volume", label: "Volume", type: "range", min: 0, max: 1, step: 0.01 },
      { key: "bgm", label: "Ambient", type: "range", min: 0, max: 1, step: 0.01 },
      { key: "sens", label: "Mouse Sensitivity", type: "range", min: 0.5, max: 2, step: 0.01 },
      { key: "quality", label: "Quality", type: "select", options: [["low", "Low"], ["mid", "Mid"], ["high", "High"]] },
      { key: "shadow", label: "Shadows", type: "checkbox" },
      { key: "lang", label: "Language", type: "select", options: [["en", "English"]] }
    ];
    for (const def of defs) {
      const label = document.createElement("label");
      label.className = "field";
      const span = document.createElement("span");
      span.textContent = def.label;
      let input;
      if (def.type === "select") {
        input = document.createElement("select");
        for (const [value, text] of def.options) {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = text;
          input.appendChild(option);
        }
      } else {
        input = document.createElement("input");
        input.type = def.type;
        if (def.type === "range") {
          input.min = def.min;
          input.max = def.max;
          input.step = def.step;
        }
      }
      input.dataset.setting = def.key;
      this.setInputValue(input, this.game.settings[def.key]);
      input.addEventListener("input", () => {
        this.game.setSetting(def.key, this.getInputValue(input));
        this.syncSettings();
      });
      label.append(span, input);
      root.appendChild(label);
    }
  }

  setInputValue(input, value) {
    if (input.type === "checkbox") input.checked = Boolean(value);
    else input.value = String(value);
  }

  getInputValue(input) {
    if (input.type === "checkbox") return input.checked;
    if (input.type === "range") return Number(input.value);
    return input.value;
  }

  syncSettings() {
    for (const input of document.querySelectorAll("[data-setting]")) {
      this.setInputValue(input, this.game.settings[input.dataset.setting]);
    }
  }

  refreshContinue() {
    this.el.newGame.classList.toggle("hidden", this.game.hasProgress);
    this.el.continue.classList.toggle("hidden", !this.game.hasProgress);
  }

  showRegistration(show) {
    this.el.registration.classList.toggle("hidden", !show);
    if (show) {
      this.el.title.classList.add("hidden");
      this.el.hud.classList.add("hidden");
      this.el.hint.classList.add("hidden");
      requestAnimationFrame(() => this.el.registrationName.focus());
    }
  }

  showTitle(show) {
    this.el.title.classList.toggle("hidden", !show);
    if (show) {
      this.el.onlineSetup.classList.add("hidden");
      this.updateProfile();
    }
    this.el.hud.classList.toggle("hidden", show || !this.hudVisible);
    this.el.hint.classList.toggle("hidden", show);
    this.refreshContinue();
  }

  showPause(show) {
    this.el.pause.classList.toggle("hidden", !show);
    this.el.hint.classList.toggle("hidden", show || this.buildOpen || this.profileOpen || this.inventoryOpen || this.game.mode === "title");
    if (show) this.showMenuSettings(false);
  }

  showMenuSettings(show) {
    this.el.pauseMain.classList.toggle("hidden", show);
    this.el.pauseSettings.classList.toggle("hidden", !show);
  }

  toggleHUD() {
    if (this.game.mode !== "playing") return;
    this.hudVisible = !this.hudVisible;
    this.el.hud.classList.toggle("hidden", !this.hudVisible || this.profileOpen || this.buildOpen || this.inventoryOpen);
  }

  toggleProfile() {
    if (!this.game.identity || this.modalOpen) return;
    if (this.profileOpen) this.closeProfile();
    else this.openProfile();
  }

  async openProfile() {
    if (this.inventoryOpen) this.closeInventory();
    if (this.buildOpen) await this.discardBuild();
    this.profileOpen = true;
    document.body.classList.add("profile-open");
    this.game.keys.clear();
    this.game.cast.cancelCharge();
    this.game.castMeter.classList.add("hidden");
    this.updateProfile();
    this.el.profilePanel.classList.remove("hidden");
    this.el.hud.classList.add("hidden");
    this.el.hint.classList.add("hidden");
    this.el.profileTabButtons[0].focus();
    if (document.pointerLockElement) document.exitPointerLock();
  }

  closeProfile() {
    this.profileOpen = false;
    document.body.classList.remove("profile-open");
    this.el.profilePanel.classList.add("hidden");
    if (this.game.mode === "playing") {
      this.el.hud.classList.toggle("hidden", !this.hudVisible);
      this.el.hint.classList.remove("hidden");
    }
  }

  updateProfile() {
    const identity = this.game.identity;
    if (!identity) return;
    this.el.profileName.textContent = identity.name;
    this.el.profileId.textContent = `#${identity.id}`;
    const rank = this.game.currentRank;
    this.el.launcherProfileInitial.textContent = identity.name.charAt(0).toUpperCase();
    this.el.launcherProfileName.textContent = identity.name;
    this.el.launcherProfileMeta.textContent = `#${identity.id} \u00b7 ${rank}`;
    this.el.onlineIdentity.textContent = `${identity.name} [#${identity.id}] [${rank}]`;
    const allowed = this.game.auth.can(rank, "buildMode");
    this.el.buildChip.textContent = allowed ? "[B] Build" : "[B] Build (locked)";
    this.el.buildChip.classList.toggle("allowed", allowed);
    this.el.buildChip.classList.toggle("locked", !allowed);
    this.openProfileTab(this.profileTab);
    this.refreshProfile();
  }

  openNameModal() {
    this.modalOpen = true;
    this.el.identityName.value = this.game.identity.name;
    this.el.identityModal.classList.remove("hidden");
    this.validateNameField(this.el.identityName, this.el.identityValidation, this.el.identitySave);
    this.el.identityName.select();
  }

  closeNameModal() {
    this.modalOpen = false;
    this.el.identityModal.classList.add("hidden");
    if (this.profileOpen) document.getElementById("change-name").focus();
    else this.game.canvas.focus();
  }

  saveName() {
    const result = this.game.changePlayerName(this.el.identityName.value);
    if (!result.ok) {
      this.showToast(result.message);
      return;
    }
    this.closeNameModal();
    this.updateProfile();
    this.showToast("Name updated.");
  }

  async toggleBuildPanel() {
    if (this.buildOpen) await this.discardBuild();
    else await this.openBuild();
  }

  async openBuild() {
    if (this.game.mode !== "playing" || this.modalOpen) return;
    if (this.inventoryOpen) this.closeInventory();
    if (this.profileOpen) this.closeProfile();
    this.buildOpen = true;
    this.game.keys.clear();
    this.game.placementSystem.beginSession();
    this.el.buildPanel.classList.remove("hidden");
    this.el.hud.classList.add("hidden");
    this.el.hint.classList.add("hidden");
    if (document.pointerLockElement) document.exitPointerLock();
    await this.refreshTextures();
  }

  closeBuild() {
    this.buildOpen = false;
    this.game.placementSystem.handlePointerUp();
    this.el.buildPanel.classList.add("hidden");
    if (this.game.mode === "playing") {
      this.el.hud.classList.toggle("hidden", !this.hudVisible);
      this.el.hint.classList.remove("hidden");
    }
  }

  async saveBuild() {
    this.game.placementSystem.commit();
    this.game.save();
    this.game.broadcastPlacements();
    this.closeBuild();
    this.showToast("Placements saved.");
  }

  async discardBuild() {
    if (!this.buildOpen) return;
    await this.game.placementSystem.discard();
    this.closeBuild();
    this.showToast("Build changes discarded.");
  }

  async uploadTextures(fileList) {
    for (const file of [...fileList]) {
      try {
        const record = await this.game.textureManager.add(file);
        this.game.placementSystem.setTexture(record.id);
      } catch (error) {
        this.showToast(error.message || "Texture upload failed.");
      }
    }
    this.el.textureInput.value = "";
    await this.refreshTextures();
  }

  async exportManifest() {
    try {
      const manifest = await this.game.textureManager.exportManifest(this.game.identity.name, this.game.identity.id);
      const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `snejfishing-textures-${this.game.identity.id}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      this.showToast("Texture metadata exported.");
    } catch (error) {
      this.showToast(error.message || "Could not export texture metadata.");
    }
  }

  async importManifestFile() {
    const file = this.el.manifestFile.files?.[0];
    this.el.manifestFile.value = "";
    if (!file) return;
    await this.importManifest(await file.text());
  }

  async importManifest(text) {
    try {
      const result = await this.game.textureManager.importManifest(text);
      await this.refreshTextures();
      this.showToast(`Manifest imported: ${result.added} added, ${result.skipped} skipped.`);
    } catch (error) {
      this.showToast(error.message || "Could not import this manifest.");
    }
  }

  async refreshTextures() {
    let records = [];
    try {
      records = await this.game.textureManager.list();
    } catch {
      this.showToast("Texture storage is unavailable in this browser.");
    }
    this.el.textureList.replaceChildren();
    if (records.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-library";
      empty.textContent = "No local textures yet.";
      this.el.textureList.appendChild(empty);
      return;
    }
    if (!this.game.placementSystem.textureId) this.game.placementSystem.setTexture(records[0].id);
    for (const record of records) this.el.textureList.appendChild(this.makeTextureCard(record));
  }

  makeTextureCard(record) {
    const card = document.createElement("div");
    card.className = "texture-card";
    card.classList.toggle("selected", record.id === this.game.placementSystem.textureId);
    const select = document.createElement("button");
    select.className = "texture-select";
    select.title = `Select ${record.name}`;
    const image = document.createElement("img");
    image.src = this.game.textureManager.urlFor(record);
    image.alt = record.name;
    select.appendChild(image);
    select.addEventListener("click", () => {
      this.game.placementSystem.setTexture(record.id);
      this.refreshTextures();
    });
    const name = document.createElement("button");
    name.className = "texture-name";
    name.textContent = record.name;
    name.title = "Rename texture";
    name.addEventListener("click", () => this.beginTextureRename(card, record, name));
    const dimensions = document.createElement("span");
    dimensions.className = "texture-dimensions";
    dimensions.textContent = `${record.width} x ${record.height}`;
    const remove = document.createElement("button");
    remove.className = "texture-delete";
    remove.textContent = "Delete";
    remove.title = `Delete ${record.name}`;
    remove.addEventListener("click", () => this.game.deleteTexture(record.id));
    card.append(select, name, dimensions, remove);
    if (record.missingBlob || !record.blob) {
      const missing = document.createElement("span");
      missing.className = "missing-media";
      missing.textContent = "Metadata";
      card.appendChild(missing);
    }
    return card;
  }

  beginTextureRename(card, record, nameButton) {
    const input = document.createElement("input");
    input.className = "texture-rename-input";
    input.value = record.name;
    nameButton.replaceWith(input);
    input.select();
    let finished = false;
    const cancel = () => {
      if (finished) return;
      finished = true;
      input.replaceWith(nameButton);
    };
    const save = async () => {
      if (finished) return;
      finished = true;
      try {
        await this.game.textureManager.rename(record.id, input.value);
        await this.refreshTextures();
      } catch (error) {
        input.replaceWith(nameButton);
        this.showToast(error.message || "Could not rename the texture.");
      }
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") save();
      if (event.key === "Escape") cancel();
    });
    input.addEventListener("blur", cancel);
  }

  updateViewChip(game) {
    const label = game.cameraMode === "first-person" ? "First Person" : "Third Person";
    this.el.viewChip.textContent = `[V] View: ${label}`;
  }

  setNetworkStatus(text) {
    this.el.networkStatus.textContent = text;
  }

  updatePeerList(peers) {
    this.el.peerSection.classList.toggle("hidden", !this.game.multiplayer?.connected);
    this.el.peerList.replaceChildren();
    for (const peer of peers) {
      const row = document.createElement("div");
      row.className = "peer-row";
      const label = document.createElement("span");
      label.textContent = `[#${peer.id}] ${peer.name}`;
      const badge = document.createElement("span");
      badge.className = `rank-badge rank-${peer.rank}`;
      badge.textContent = `[${peer.rank}]`;
      row.append(label, badge);
      this.el.peerList.appendChild(row);
    }
  }

  showToast(text) {
    clearTimeout(this.toastTimer);
    this.el.toast.textContent = text;
    this.el.toast.classList.remove("hidden");
    this.toastTimer = setTimeout(() => this.el.toast.classList.add("hidden"), 3600);
  }

  updateHUD(game, dt) {
    this.frames += 1;
    this.fpsTimer += dt;
    if (this.fpsTimer >= 0.5) {
      this.fps = Math.round(this.frames / this.fpsTimer);
      this.frames = 0;
      this.fpsTimer = 0;
    }
    const position = game.pos;
    const depth = game.terrain ? game.terrain.depthAt(position.x, position.z) : 0;
    this.el.arrow.setAttribute("transform", `rotate(${(-game.yaw * 180) / Math.PI} 24 24)`);
    this.el.pos.textContent = `x ${position.x.toFixed(1)}, z ${position.z.toFixed(1)}`;
    this.el.depth.textContent = depth < 0.1 ? "On land" : `Depth ${depth.toFixed(1)} m`;
    this.el.camera.textContent = game.cameraMode === "first-person" ? "First Person" : "Third Person";
    this.el.fps.textContent = `${this.fps} FPS`;
  }

  bindTabKeys(root) {
    root.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      const buttons = [...root.querySelectorAll('[role="tab"]')];
      const index = buttons.indexOf(document.activeElement);
      if (index < 0) return;
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next].click();
      buttons[next].focus();
    });
  }

  async toggleInventory() {
    if (!this.game.identity || this.modalOpen || this.game.mode !== "playing") return;
    if (this.inventoryOpen) return this.closeInventory();
    if (this.profileOpen) this.closeProfile();
    if (this.buildOpen) await this.discardBuild();
    this.inventoryFocus = document.activeElement;
    this.inventoryOpen = true;
    this.currentInventoryCategory = "rod";
    this.game.keys.clear();
    this.game.mouse.dx = this.game.mouse.dy = 0;
    this.game.cast.cancelCharge();
    this.game.castMeter.classList.add("hidden");
    this.el.toast.classList.add("hidden");
    document.body.classList.add("inventory-open");
    this.el.inventoryPanel.classList.remove("hidden");
    this.el.hud.classList.add("hidden");
    this.el.hint.classList.add("hidden");
    this.refreshInventory();
    this.el.inventoryCategory.querySelector('[aria-selected="true"]').focus();
    if (document.pointerLockElement) document.exitPointerLock();
  }

  closeInventory() {
    this.clearGearDrag();
    this.inventoryOpen = false;
    document.body.classList.remove("inventory-open");
    this.el.inventoryPanel.classList.add("hidden");
    if (this.game.mode === "playing") {
      this.el.hud.classList.toggle("hidden", !this.hudVisible);
      this.el.hint.classList.remove("hidden");
    }
    (this.inventoryFocus?.isConnected && this.inventoryFocus.tabIndex >= 0 && this.inventoryFocus.getClientRects().length
      ? this.inventoryFocus : this.game.canvas).focus();
  }

  refreshRodLine() {
    const inv = this.game.inventory;
    if (!inv) return;
    const rod = inv.equippedRod();
    this.el.rodLine.textContent = `Rod ${rod.length} m / Range ${rod.range} m`;
    const bait = inv.equippedBait();
    this.el.baitLine.textContent = bait && inv.countOf(bait.id) > 0
      ? `Bait: ${bait.name} x${inv.countOf(bait.id)}` : "No bait";
  }

  canDropGear(item, kind) {
    return this.inventoryOpen && item?.kind === kind && kind !== "lure" && item.unlocked !== false
      && this.game.inventory.owns(item.id) && !["charge", "flight"].includes(this.game.cast.state.fs);
  }

  clearGearDrag() {
    this.draggedGearId = null;
    for (const slot of this.el.equipmentSlots.querySelectorAll("[data-slot]")) slot.classList.remove("drop-ready", "drop-target");
  }

  inventoryAction(action, id) {
    const result = action === "buy" ? this.game.inventory.buy(id) : this.game.equipGear(id);
    if (result.ok) {
      this.refreshInventory();
      this.refreshProfile();
      this.game.save();
    }
    this.showToast(result.message);
    const replacement = [...this.el.inventoryGrid.querySelectorAll("button[data-item]")]
      .find((next) => next.dataset.item === id && !next.disabled);
    (replacement || this.el.inventoryCategory.querySelector('[aria-selected="true"]')).focus();
    return result;
  }

  saveLoadout() {
    const result = this.game.inventory.saveLoadout(this.el.loadoutName?.value);
    if (result.ok) {
      if (this.el.loadoutName) this.el.loadoutName.value = "";
      this.refreshInventory();
      this.game.save();
    }
    this.showToast(result.message);
    return result;
  }

  applyLoadout(id) {
    const result = this.game.inventory.applyLoadout(id);
    if (result.ok) {
      this.game.applyRod(this.game.inventory.equippedRod());
      this.refreshInventory();
      this.refreshProfile();
      this.game.save();
    }
    this.showToast(result.message);
    return result;
  }

  deleteLoadout(id) {
    const result = this.game.inventory.deleteLoadout(id);
    if (result.ok) {
      this.refreshInventory();
      this.game.save();
    }
    this.showToast(result.message);
    return result;
  }

  refreshClothingSlots() {
    if (!this.el.clothingSlots) return;
    const clothing = this.game.inventory.state.clothing || {};
    for (const slot of this.el.clothingSlots.querySelectorAll("[data-clothing-slot]")) {
      const info = CLOTHING_SLOTS.find((item) => item.id === slot.dataset.clothingSlot);
      const value = clothing[slot.dataset.clothingSlot];
      const label = value || "Empty";
      slot.querySelector("strong").textContent = label;
      slot.setAttribute("aria-label", `${info?.label || "Clothing"}: ${label}`);
    }
  }

  refreshLoadouts() {
    if (!this.el.loadoutList) return;
    const loadouts = this.game.inventory.state.loadouts || [];
    this.el.loadoutList.replaceChildren();
    if (!loadouts.length) {
      this.el.loadoutList.append(textElement("p", "empty", "No saved sets."));
      return;
    }
    for (const loadout of loadouts) {
      const card = textElement("article", "loadout-card", "");
      const title = textElement("h4", "", loadout.name);
      const items = ["rod", "line", "hook", "bait"].map((kind) => findItem(loadout.equipped?.[kind])?.name || "None");
      const summary = textElement("p", "desc", items.join(" / "));
      const actions = textElement("div", "inventory-actions", "");
      const apply = textElement("button", "", "Apply");
      apply.type = "button";
      apply.dataset.action = "apply";
      apply.dataset.loadout = loadout.id;
      const remove = textElement("button", "secondary", "Delete");
      remove.type = "button";
      remove.dataset.action = "delete";
      remove.dataset.loadout = loadout.id;
      actions.append(apply, remove);
      card.append(title, summary, actions);
      this.el.loadoutList.append(card);
    }
  }

  refreshInventory() {
    const inv = this.game.inventory;
    if (!inv) return;
    this.refreshRodLine();
    this.el.inventoryCoins.textContent = String(inv.coins());
    if (!this.inventoryOpen) return;
    const kind = this.currentInventoryCategory;
    this.el.equipmentName.textContent = this.game.identity.name;
    this.el.inventoryCastRange.textContent = `${Number(this.game.cast.castRange.toFixed(2))} m`;
    this.refreshClothingSlots();
    this.refreshLoadouts();
    for (const slot of this.el.equipmentSlots.querySelectorAll("[data-slot]")) {
      const item = findItem(inv.state.equipped[slot.dataset.slot]);
      const label = item ? `${item.name}${item.stackable ? ` x${inv.countOf(item.id)}` : ""}` : "None";
      slot.querySelector("strong").textContent = label;
      slot.classList.toggle("active", slot.dataset.slot === kind);
      slot.setAttribute("aria-label", `${slot.querySelector(".slot-kind").textContent}: ${label}`);
    }
    for (const button of this.el.inventoryCategory.querySelectorAll("[data-category]")) {
      const active = button.dataset.category === kind;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    }
    this.el.inventoryGrid.setAttribute("aria-labelledby", `inventory-category-${kind}`);
    this.el.inventoryGrid.replaceChildren();
    for (const item of CATALOG[kind]) {
      const owned = inv.owns(item.id), equipped = inv.state.equipped[kind] === item.id;
      const locked = item.unlocked === false;
      const badge = equipped ? "Equipped" : owned ? "Owned" : locked ? "Locked" : "Buy";
      const card = textElement("article", `inventory-card${equipped ? " equipped" : ""}${locked ? " locked" : ""}`, "");
      card.setAttribute("role", "listitem");
      card.dataset.item = item.id;
      card.draggable = owned && !equipped && !locked && item.kind !== "lure"
        && !["charge", "flight"].includes(this.game.cast.state.fs);
      if (card.draggable) card.tabIndex = 0;
      const heading = textElement("div", "row", "");
      heading.append(textElement("h3", "name", item.name), textElement("span", `badge ${badge.toLowerCase()}`, badge));
      const detail = textElement("div", "row", "");
      detail.append(textElement("span", "price", owned && !item.stackable ? "Owned" : `${item.price} ${item.price === 1 ? "coin" : "coins"}`));
      if (item.stackable) detail.append(textElement("span", "count", `x${inv.countOf(item.id)}`));
      const actions = textElement("div", "inventory-actions", "");
      const addAction = (action, label, disabled) => {
        const button = textElement("button", action === "equip" ? "secondary" : "", label);
        button.type = "button";
        button.dataset.action = action;
        button.dataset.item = item.id;
        button.disabled = disabled;
        button.setAttribute("aria-label", `${label} ${item.name}`);
        actions.append(button);
      };
      if (owned || equipped) addAction("equip", equipped ? "Equipped" : item.kind === "lure" ? "Owned" : "Equip",
        equipped || locked || !owned || item.kind === "lure" || this.game.cast.state.fs === "flight");
      if (!owned || item.stackable) addAction("buy", `Buy ${item.price}`, locked || inv.coins() < item.price);
      card.append(heading, textElement("p", "desc", item.description.slice(0, 80)), detail, actions);
      this.el.inventoryGrid.append(card);
    }
  }

  openProfileTab(name) {
    if (!["profile", "log", "stats"].includes(name)) name = "profile";
    this.profileTab = name;
    for (const button of this.el.profileTabButtons) {
      const active = button.dataset.tab === name;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    }
    this.el.profileContentProfile.classList.toggle("hidden", name !== "profile");
    this.el.profileContentLog.classList.toggle("hidden", name !== "log");
    this.el.profileContentStats.classList.toggle("hidden", name !== "stats");
    if (name === "log") this.refreshProfileLog();
    if (name === "stats") this.refreshProfileStats();
  }

  refreshProfile() {
    if (!this.game.inventory || !this.game.stats) return;
    this.el.profileCoins.textContent = String(this.game.inventory.coins());
    this.refreshProfileLog();
    this.refreshProfileStats();
    this.refreshRodLine();
  }

  refreshProfileLog() {
    this.el.profileLogList.replaceChildren();
    const entries = this.game.catchLog?.entries || [];
    if (!entries.length) this.el.profileLogList.append(textElement("p", "empty", "No catches yet."));
    for (const entry of entries) {
      const row = textElement("div", "entry", "");
      row.append(textElement("strong", "", entry.species),
        textElement("span", "", `${entry.length.toFixed(1)} cm / ${entry.weight.toFixed(2)} kg`),
        textElement("small", "meta", entry.location || "Unknown location"));
      this.el.profileLogList.append(row);
    }
  }

  refreshProfileStats() {
    const stats = this.game.stats?.state;
    if (!stats) return;
    const seen = new Date(stats.lastSeenAt);
    const rows = [
      ["Casts", stats.castCount], ["Successful casts", stats.successfulCasts], ["Fish caught", stats.fishCaught],
      ["Best length", `${stats.bestLengthCm} cm`], ["Total weight", `${stats.totalWeightKg.toFixed(2)} kg`],
      ["Unique species", stats.uniqueSpecies], ["Playtime", formatPlaytime(stats.playtimeSec)],
      ["Last seen", stats.lastSeenAt > 0 && Number.isFinite(seen.getTime()) ? seen.toISOString() : "Never"]
    ];
    const body = document.createElement("tbody");
    for (const [label, value] of rows) {
      const row = document.createElement("tr"), key = textElement("th", "", label);
      key.scope = "row";
      row.append(key, textElement("td", "", String(value)));
      body.append(row);
    }
    this.el.profileStatsList.replaceChildren(body);
  }
}
