// Shorts Captions — pure client-side app.
// All processing runs in the browser. No server calls.

(function () {
  "use strict";

  // ══════════════════════════════════════════════════════════════════════
  // SRT Engine — JS port of shorts_captions.py
  // ══════════════════════════════════════════════════════════════════════

  function parseBlocks(text) {
    text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    var blocks = [];
    var current = [];
    var lines = text.split("\n");
    for (var i = 0; i < lines.length; i++) {
      var trimmed = lines[i].trim();
      if (trimmed) {
        current.push(trimmed);
      } else if (current.length) {
        blocks.push(current);
        current = [];
      }
    }
    if (current.length) blocks.push(current);
    return blocks;
  }

  var TC_RE = /(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/;

  function parseSrt(text) {
    text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    var entries = [];
    var chunks = text.trim().split(/\n\n+/);
    for (var i = 0; i < chunks.length; i++) {
      var lines = chunks[i].trim().split("\n");
      if (lines.length < 2) continue;
      var idx = parseInt(lines[0].trim(), 10);
      if (isNaN(idx)) continue;
      var m = TC_RE.exec(lines[1].trim());
      if (!m) continue;
      entries.push({ idx: idx, start: m[1], end: m[2], text: lines.slice(2).join("\n") });
    }
    return entries;
  }

  function tcToMs(tc) {
    var parts = tc.split(":");
    var h = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10);
    var rest = parts[2].split(",");
    var s = parseInt(rest[0], 10);
    var ms = parseInt(rest[1], 10);
    return h * 3600000 + m * 60000 + s * 1000 + ms;
  }

  function msToTc(ms) {
    var h = Math.floor(ms / 3600000);
    ms %= 3600000;
    var m = Math.floor(ms / 60000);
    ms %= 60000;
    var s = Math.floor(ms / 1000);
    ms %= 1000;
    return pad2(h) + ":" + pad2(m) + ":" + pad2(s) + "," + pad3(ms);
  }

  function pad2(n) { return n < 10 ? "0" + n : "" + n; }
  function pad3(n) { return n < 10 ? "00" + n : n < 100 ? "0" + n : "" + n; }

  function formatForPremiere(srtText) {
    var crlf = srtText.replace(/\n/g, "\r\n");
    var bom = "﻿";
    return bom + crlf;
  }

  function estimateTiming(blocks, cps, startAt, minDur, maxDur) {
    if (!blocks.length) throw new Error("No text blocks found in uploaded file");
    cps = cps || 5.0;
    startAt = (startAt != null) ? startAt : 3.0;
    minDur = minDur || 1.2;
    maxDur = maxDur || 7.0;

    var parts = [];
    var t = startAt;
    for (var i = 0; i < blocks.length; i++) {
      var chars = 0;
      for (var j = 0; j < blocks[i].length; j++) chars += blocks[i][j].length;
      var dur = Math.max(minDur, Math.min(maxDur, chars / cps));
      var startTc = msToTc(Math.round(t * 1000));
      var endTc = msToTc(Math.round((t + dur) * 1000));
      var body = blocks[i].join("\n");
      parts.push((i + 1) + "\n" + startTc + " --> " + endTc + "\n" + body);
      t += dur;
    }
    return parts.join("\n\n") + "\n";
  }

  function resync(blocks, srtEntries) {
    if (!blocks.length) throw new Error("No text blocks found in uploaded text file");
    if (!srtEntries.length) throw new Error("No valid entries found in uploaded SRT file");

    // Only discard legacy boundary guards when their body is empty.
    // Real one-frame subtitles must retain their timecodes and text mapping.
    function isLegacyGuard(entry) {
      return typeof entry.text === "string" && !entry.text.trim() &&
        tcToMs(entry.end) - tcToMs(entry.start) === 40;
    }
    if (srtEntries.length >= 2 && isLegacyGuard(srtEntries[0])) {
      srtEntries = srtEntries.slice(1);
    }
    if (srtEntries.length >= 2 && isLegacyGuard(srtEntries[srtEntries.length - 1])) {
      srtEntries = srtEntries.slice(0, -1);
    }

    if (blocks.length !== srtEntries.length) {
      throw new Error(
        "Block count mismatch: .txt has " + blocks.length + " block(s), " +
        ".srt has " + srtEntries.length + " entry/entries. " +
        "Fix the source files before re-uploading."
      );
    }

    var parts = [];
    for (var i = 0; i < srtEntries.length; i++) {
      var e = srtEntries[i];
      var body = blocks[i].join("\n");
      parts.push((i + 1) + "\n" + e.start + " --> " + e.end + "\n" + body);
    }
    return parts.join("\n\n") + "\n";
  }

  // ══════════════════════════════════════════════════════════════════════
  // Text Decoding
  // ══════════════════════════════════════════════════════════════════════

  function decodeFile(arrayBuffer) {
    var bytes = new Uint8Array(arrayBuffer);
    // Strip UTF-8 BOM
    if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
      bytes = bytes.slice(3);
    }
    // Try UTF-8 first
    try {
      var decoder = new TextDecoder("utf-8", { fatal: true });
      return decoder.decode(bytes);
    } catch (e) {}
    // Fallback: GB18030
    try {
      var decoderGb = new TextDecoder("gb18030", { fatal: true });
      return decoderGb.decode(bytes);
    } catch (e) {}
    // Last resort
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }

  // ══════════════════════════════════════════════════════════════════════
  // File Download
  // ══════════════════════════════════════════════════════════════════════

  function downloadSrt(filename, content) {
    var formatted = formatForPremiere(content);
    var blob = new Blob([formatted], { type: "application/x-subrip;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  // ══════════════════════════════════════════════════════════════════════
  // History (localStorage)
  // ══════════════════════════════════════════════════════════════════════

  var HISTORY_KEY = "shortsCaptionsHistory";

  function loadHistory() {
    try {
      var raw = localStorage.getItem(HISTORY_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function saveHistory(entries) {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(entries));
    } catch (e) {}
  }

  function addHistoryEntry(name, feature, srtFilename, srtContent) {
    var entries = loadHistory();
    entries.unshift({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: name,
      feature: feature,
      srtFilename: srtFilename,
      srtContent: srtContent,
      createdAt: new Date().toISOString().replace("T", " ").slice(0, 19),
    });
    saveHistory(entries);
  }

  function deleteHistoryEntries(ids) {
    var idSet = {};
    for (var i = 0; i < ids.length; i++) idSet[ids[i]] = true;
    var entries = loadHistory().filter(function (e) { return !idSet[e.id]; });
    saveHistory(entries);
  }

  // ══════════════════════════════════════════════════════════════════════
  // View Switching
  // ══════════════════════════════════════════════════════════════════════

  function switchView(viewName) {
    var shorts = document.getElementById("view-shorts");
    var history = document.getElementById("view-history");
    var links = document.querySelectorAll(".nav-link[data-view]");

    if (viewName === "history") {
      shorts.hidden = true;
      history.hidden = false;
      renderHistory();
    } else {
      shorts.hidden = false;
      history.hidden = true;
    }

    links.forEach(function (link) {
      link.classList.toggle("is-active", link.getAttribute("data-view") === viewName);
    });
  }

  function initViewSwitching() {
    document.querySelectorAll(".nav-link[data-view]").forEach(function (link) {
      link.addEventListener("click", function (e) {
        e.preventDefault();
        switchView(link.getAttribute("data-view"));
      });
    });
    // Handle direct #history URL
    if (location.hash === "#history") switchView("history");
  }

  // ══════════════════════════════════════════════════════════════════════
  // History Rendering
  // ══════════════════════════════════════════════════════════════════════

  function renderHistory() {
    var container = document.getElementById("history-content");
    var entries = loadHistory();

    if (!entries.length) {
      container.innerHTML =
        '<div class="history-empty">' +
          '<div class="history-empty-circle"><svg viewBox="0 0 24 24"><path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="9"/></svg></div>' +
          '<div class="history-empty-title">No shorts yet</div>' +
          '<div class="history-empty-sub">Generated SRT files appear here</div>' +
        '</div>';
      return;
    }

    var html =
      '<div class="history-row shorts-history-row">' +
        '<span class="field-label" style="margin:0"><input class="checkbox" type="checkbox" id="select-all" aria-label="Select all"></span>' +
        '<span class="field-label" style="margin:0">Name</span>' +
        '<span class="field-label" style="margin:0">Type</span>' +
        '<span class="field-label" style="margin:0">Created</span>' +
        '<span class="field-label" style="margin:0"></span>' +
      '</div>' +
      '<div class="history-list">';

    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      html +=
        '<div class="history-row shorts-history-row">' +
          '<input class="checkbox history-cb" type="checkbox" value="' + e.id + '" aria-label="Select ' + escHtml(e.name) + '">' +
          '<span class="history-name">' + escHtml(e.name) + '</span>' +
          '<span class="history-status"><span class="history-status-dot" style="background:var(--accent)"></span>' + escHtml(e.feature) + '</span>' +
          '<span class="history-time">' + escHtml(e.createdAt) + '</span>' +
          '<button class="btn btn-sm" data-download="' + i + '">Download</button>' +
        '</div>';
    }

    html += '</div>' +
      '<div class="btn-row">' +
        '<button type="button" class="btn" id="delete-selected" disabled>Delete selected</button>' +
      '</div>';

    container.innerHTML = html;

    // Wire up select-all
    var selectAll = document.getElementById("select-all");
    var boxes = container.querySelectorAll(".history-cb");
    var deleteBtn = document.getElementById("delete-selected");

    function refresh() {
      var any = Array.prototype.some.call(boxes, function (b) { return b.checked; });
      deleteBtn.disabled = !any;
    }

    selectAll.addEventListener("change", function () {
      boxes.forEach(function (b) { b.checked = selectAll.checked; });
      refresh();
    });
    boxes.forEach(function (b) { b.addEventListener("change", refresh); });

    // Wire up download buttons
    container.querySelectorAll("[data-download]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var idx = parseInt(btn.getAttribute("data-download"), 10);
        var entry = entries[idx];
        if (entry) downloadSrt(entry.srtFilename, entry.srtContent);
      });
    });

    // Wire up delete
    deleteBtn.addEventListener("click", function () {
      var selected = Array.prototype.filter
        .call(boxes, function (b) { return b.checked; })
        .map(function (b) { return b.value; });
      if (!selected.length) return;
      var msg = selected.length === 1
        ? "Delete 1 selected entry? This cannot be undone."
        : "Delete " + selected.length + " selected entries? This cannot be undone.";
      if (!confirm(msg)) return;
      deleteHistoryEntries(selected);
      renderHistory();
    });
  }

  function escHtml(s) {
    var d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  // ══════════════════════════════════════════════════════════════════════
  // Theme Toggle
  // ══════════════════════════════════════════════════════════════════════

  var THEME_KEY = "shortsCaptionsTheme";

  function getEffectiveTheme() {
    var explicit = document.documentElement.getAttribute("data-theme");
    if (explicit) return explicit;
    return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function applyToggleUI() {
    var eff = getEffectiveTheme();
    document.querySelectorAll(".theme-toggle-btn").forEach(function (b) {
      b.classList.toggle("active", b.dataset.mode === eff);
    });
  }

  function initThemeToggle() {
    document.querySelectorAll(".theme-toggle-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        document.documentElement.setAttribute("data-theme", btn.dataset.mode);
        try { localStorage.setItem(THEME_KEY, btn.dataset.mode); } catch (e) {}
        applyToggleUI();
      });
    });
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyToggleUI);
    applyToggleUI();
  }

  // ══════════════════════════════════════════════════════════════════════
  // Upload Dropzones
  // ══════════════════════════════════════════════════════════════════════

  function initDropzones() {
    document.querySelectorAll(".upload-zone").forEach(function (zone) {
      var input = zone.querySelector('input[type="file"]');
      var accept = (input.getAttribute("accept") || "").toLowerCase();

      zone.addEventListener("click", function (e) {
        if (e.target.closest(".upload-remove")) return;
        input.click();
      });
      zone.addEventListener("dragover", function (e) {
        e.preventDefault();
        zone.classList.add("is-dragover");
      });
      zone.addEventListener("dragleave", function () {
        zone.classList.remove("is-dragover");
      });
      zone.addEventListener("drop", function (e) {
        e.preventDefault();
        zone.classList.remove("is-dragover");
        if (e.dataTransfer.files.length) {
          input.files = e.dataTransfer.files;
          handleFile(zone, input, accept, e.dataTransfer.files[0]);
        }
      });
      input.addEventListener("change", function () {
        if (input.files.length) handleFile(zone, input, accept, input.files[0]);
      });
    });
  }

  function extOf(filename) {
    var m = /\.[^.]+$/.exec(filename || "");
    return m ? m[0].toLowerCase() : "";
  }

  function handleFile(zone, input, accept, file) {
    var nameEl = zone.querySelector(".upload-filename");
    var warnEl = zone.querySelector(".upload-warning");
    warnEl.textContent = "";

    if (accept && extOf(file.name) !== accept) {
      nameEl.textContent = "";
      warnEl.textContent = "Wrong file type - expected " + accept + ".";
      input.value = "";
      zone.classList.remove("has-file");
      validateForms();
      return;
    }

    nameEl.textContent = file.name;
    zone.classList.add("has-file");

    var removeBtn = zone.querySelector(".upload-remove");
    if (!removeBtn) {
      removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "upload-remove";
      removeBtn.textContent = "✕";
      removeBtn.setAttribute("aria-label", "Remove file");
      removeBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        zone.classList.remove("has-file");
        input.value = "";
        nameEl.textContent = "";
        warnEl.textContent = "";
        removeBtn.remove();
        validateForms();
      });
      zone.appendChild(removeBtn);
    }

    validateForms();
  }

  // ══════════════════════════════════════════════════════════════════════
  // Form Validation & Submission
  // ══════════════════════════════════════════════════════════════════════

  function validateForms() {
    var ef = document.getElementById("estimate-form");
    var rf = document.getElementById("resync-form");

    if (ef) {
      var eBtn = ef.querySelector(".generate-btn");
      var eTxt = ef.querySelector('input[name="txt"]');
      eBtn.disabled = !(eTxt && eTxt.files.length);
    }
    if (rf) {
      var rButtons = rf.querySelectorAll(".generate-btn");
      var rTxt = rf.querySelector('input[name="txt"]');
      var rSrt = rf.querySelector('input[name="srt"]');
      rButtons.forEach(function (button) {
        button.disabled = !(rTxt && rTxt.files.length && rSrt && rSrt.files.length);
      });
    }
  }

  function showError(msg) {
    var box = document.getElementById("error-box");
    var msgEl = document.getElementById("error-msg");
    msgEl.textContent = msg;
    box.hidden = false;
  }

  function clearError() {
    document.getElementById("error-box").hidden = true;
  }

  function showToast(html) {
    var el = document.createElement("div");
    el.className = "toast";
    el.innerHTML = html;
    document.body.appendChild(el);
    setTimeout(function () { el.classList.add("is-hidden"); }, 4000);
    setTimeout(function () { el.remove(); }, 4500);
  }

  function readFileAs(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsArrayBuffer(file);
    });
  }

  function stemOf(filename) {
    return filename.replace(/\.[^.]+$/, "");
  }

  function initForms() {
    var ef = document.getElementById("estimate-form");
    var rf = document.getElementById("resync-form");

    ef.addEventListener("submit", function (e) {
      e.preventDefault();
      clearError();
      var txtInput = ef.querySelector('input[name="txt"]');
      var cps = parseFloat(ef.querySelector('input[name="cps"]').value) || 5.0;
      var startAt = parseFloat(ef.querySelector('input[name="start_at"]').value);
      if (isNaN(startAt)) startAt = 3.0;

      readFileAs(txtInput.files[0]).then(function (buf) {
        var text = decodeFile(buf);
        var blocks = parseBlocks(text);
        var srtStr = estimateTiming(blocks, cps, startAt);
        var stem = stemOf(txtInput.files[0].name);
        var filename = stem + ".srt";
        downloadSrt(filename, srtStr);
        addHistoryEntry(stem, "estimate", filename, srtStr);
        showToast(
          'SRT downloaded<span class="toast-sep">&middot;</span>' +
          '<a data-goto-history>view in History</a>'
        );
        var link = document.querySelector("[data-goto-history]");
        if (link) link.addEventListener("click", function () { switchView("history"); });
      }).catch(function (err) {
        showError(err.message || "An error occurred.");
      });
    });

    rf.addEventListener("submit", function (e) {
      e.preventDefault();
      clearError();
      var txtInput = rf.querySelector('input[name="txt"]');
      var srtInput = rf.querySelector('input[name="srt"]');

      Promise.all([
        readFileAs(txtInput.files[0]),
        readFileAs(srtInput.files[0]),
      ]).then(function (bufs) {
        var blocks = parseBlocks(decodeFile(bufs[0]));
        var srtEntries = parseSrt(decodeFile(bufs[1]));
        var srtStr = resync(blocks, srtEntries);
        var stem = stemOf(txtInput.files[0].name);
        var filename = stem + " synced.srt";
        downloadSrt(filename, srtStr);
        addHistoryEntry(stem, "resync", filename, srtStr);
        showToast(
          'SRT downloaded<span class="toast-sep">&middot;</span>' +
          '<a data-goto-history>view in History</a>'
        );
        var link = document.querySelector("[data-goto-history]");
        if (link) link.addEventListener("click", function () { switchView("history"); });
      }).catch(function (err) {
        showError(err.message || "An error occurred.");
      });
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // Init
  // ══════════════════════════════════════════════════════════════════════

  document.addEventListener("DOMContentLoaded", function () {
    initThemeToggle();
    initDropzones();
    validateForms();
    initForms();
    initViewSwitching();
  });
})();
