export class SnejUI {
  constructor(game) {
    this.game = game;
    this.hudVisible = true;
    this.buildOpen = false;
    this.profileOpen = false;
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
    this.bind();
    this.renderSettings(document.getElementById("title-settings"));
    this.renderSettings(document.getElementById("menu-settings"));
    this.el.online.classList.toggle("hidden", !game.mpEnabled);
    this.updateViewChip(game);
    this.updateProfile();
    this.refreshContinue();
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
    document.getElementById("profile-close").addEventListener("click", () => this.closeProfile());
    document.getElementById("change-name").addEventListener("click", () => this.openNameModal());
    document.getElementById("sign-out").addEventListener("click", () => this.game.signOut());
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
    this.el.hint.classList.toggle("hidden", show || this.buildOpen || this.profileOpen || this.game.mode === "title");
    if (show) this.showMenuSettings(false);
  }

  showMenuSettings(show) {
    this.el.pauseMain.classList.toggle("hidden", show);
    this.el.pauseSettings.classList.toggle("hidden", !show);
  }

  toggleHUD() {
    if (this.game.mode !== "playing") return;
    this.hudVisible = !this.hudVisible;
    this.el.hud.classList.toggle("hidden", !this.hudVisible || this.profileOpen || this.buildOpen);
  }

  toggleProfile() {
    if (!this.game.identity) return;
    if (this.profileOpen) this.closeProfile();
    else this.openProfile();
  }

  openProfile() {
    if (this.buildOpen) this.discardBuild();
    this.profileOpen = true;
    this.game.keys.clear();
    this.updateProfile();
    this.el.profilePanel.classList.remove("hidden");
    this.el.hud.classList.add("hidden");
    this.el.hint.classList.add("hidden");
    if (document.pointerLockElement) document.exitPointerLock();
  }

  closeProfile() {
    this.profileOpen = false;
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
    if (this.game.mode !== "playing") return;
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
}
