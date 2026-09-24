/**
 * Keybox Attestation Checker & Pool Manager - Frontend Controller
 * Complete client-side logic for verification, sources scraping, and active pool management.
 */

(function () {
  'use strict';

  // DOM Elements Cache & In-Memory State
  const DOM = {};
  let loadedXmlContent = '';
  let activeMethod = 'upload'; // 'upload' | 'paste'
  let cachedKeyboxes = [];
  let sourcesList = [];
  let activeDownloadMode = 'random'; // 'random' | 'selected'
  let activeSelectedSerial = null;
  let downloadConfigLoaded = false;

  // Initialize on DOMContentLoaded
  document.addEventListener('DOMContentLoaded', async () => {
    initDOM();
    initTheme();
    setupEventListeners();
    loadDashboardStats();
    loadSourcesConfig();

    // Load download configuration first, then active pool
    await loadDownloadConfig();
    await loadKeyboxPool();

    // Auto refresh stats and pool every 60 seconds (keeps purge timers live)
    setInterval(() => {
      loadDashboardStats();
      loadKeyboxPool();
    }, 60 * 1000);
  });

  function initDOM() {
    // Verifier elements
    DOM.dropzone = document.getElementById('keybox-dropzone');
    DOM.fileInput = document.getElementById('keybox-file-input');
    DOM.xmlPaste = document.getElementById('keybox-xml-paste');
    DOM.btnReset = document.getElementById('btn-reset-keybox');
    DOM.btnVerify = document.getElementById('btn-verify-keybox');
    DOM.methodBtns = document.querySelectorAll('.input-method-selector [data-method]');
    DOM.methodUploadContainer = document.getElementById('method-upload-container');
    DOM.methodPasteContainer = document.getElementById('method-paste-container');
    DOM.selectedFileInfo = document.getElementById('selected-file-info');
    DOM.selectedFileName = document.getElementById('selected-file-name');
    DOM.editorStatus = document.getElementById('xml-editor-status');

    // Pool elements
    DOM.poolGridContainer = document.getElementById('pool-grid-container');
    DOM.valPoolCount = document.getElementById('val-pool-count');
    DOM.btnRefreshPool = document.getElementById('btn-refresh-pool');
    DOM.poolLastCheckedText = document.getElementById('pool-last-checked-text');

    // Header Stat Badges
    DOM.hdrStatStrong = document.getElementById('hdr-stat-strong');
    DOM.hdrStatSoftban = document.getElementById('hdr-stat-softban');
    DOM.hdrStatRevoked = document.getElementById('hdr-stat-revoked');
    DOM.hdrStatTotal = document.getElementById('hdr-stat-total');
    DOM.hdrStatSources = document.getElementById('hdr-stat-sources');

    // Modals
    DOM.resultModal = document.getElementById('keybox-result-modal');
    DOM.resultContainer = document.getElementById('keybox-result-container');

    // Sources Scraper elements
    DOM.sourcesScraperModal = document.getElementById('sources-scraper-modal');
    DOM.btnOpenSourcesModal = document.getElementById('btn-open-sources-modal');
    DOM.btnCloseSourcesModal = document.getElementById('btn-close-sources-modal');
    DOM.launcherSourcesBadge = document.getElementById('launcher-sources-badge');
    DOM.sourcesAddUrlInput = document.getElementById('sources-add-url-input');
    DOM.sourcesAddNameInput = document.getElementById('sources-add-name-input');
    DOM.btnAddSourceAction = document.getElementById('btn-add-source-action');
    DOM.btnRunSourcesScraper = document.getElementById('btn-run-sources-scraper');
    DOM.sourcesTableBody = document.getElementById('sources-table-body');
    DOM.btnClearSourcesLogs = document.getElementById('btn-clear-sources-logs');
    DOM.sourcesLogList = document.getElementById('sources-log-list');
    DOM.sourcesLogConsole = document.getElementById('sources-log-console');
    DOM.toastContainer = document.getElementById('toast-container');

    // Workflow Elements
    DOM.btnCopyCurl = document.getElementById('btn-copy-curl');
    DOM.apiDownloadFullUrl = document.getElementById('api-download-full-url');
    if (DOM.apiDownloadFullUrl) {
      DOM.apiDownloadFullUrl.textContent = `${window.location.origin}/api/download`;
    }

    // Download Panel Elements
    DOM.btnCopyDownloadUrl = document.getElementById('btn-copy-download-url');
    DOM.btnDirectDownloadAction = document.getElementById('btn-direct-download-action');
    DOM.downloadModeBtns = document.querySelectorAll('[data-download-mode]');
    DOM.gridTargetRandomView = document.getElementById('grid-target-random-view');
    DOM.gridTargetSelectedView = document.getElementById('grid-target-selected-view');
    DOM.selectDownloadKeybox = document.getElementById('select-download-keybox');
    DOM.downloadModeBadgeText = document.getElementById('download-mode-badge-text');
    DOM.downloadHeroDesc = document.getElementById('download-hero-desc');
    DOM.specLblTarget = document.getElementById('spec-lbl-target');
    DOM.specValTarget = document.getElementById('spec-val-target');
  }

  // ===== Theme Management =====
  function initTheme() {
    const saved = localStorage.getItem('keybox-theme') || 'system';
    applyTheme(saved);

    document.querySelectorAll('.theme-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        applyTheme(btn.getAttribute('data-theme'));
      });
    });

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if ((localStorage.getItem('keybox-theme') || 'system') === 'system') {
        applyTheme('system');
      }
    });
  }

  function applyTheme(theme) {
    const root = document.documentElement;
    localStorage.setItem('keybox-theme', theme);
    root.classList.remove('light-theme', 'dark-theme');

    if (theme === 'light') {
      root.classList.add('light-theme');
    } else if (theme === 'dark') {
      root.classList.add('dark-theme');
    } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
      root.classList.add('light-theme');
    }

    document.querySelectorAll('.theme-toggle-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-theme') === theme);
    });
  }

  // ===== Event Listeners =====
  function setupEventListeners() {
    // Method selector
    DOM.methodBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        switchMethod(btn.getAttribute('data-method'));
      });
    });

    // Dropzone & File Input
    DOM.dropzone.addEventListener('click', () => DOM.fileInput.click());
    DOM.fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) handleFileSelect(e.target.files[0]);
    });

    DOM.dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      DOM.dropzone.classList.add('dragover');
    });

    ['dragleave', 'dragend'].forEach(eventName => {
      DOM.dropzone.addEventListener(eventName, () => {
        DOM.dropzone.classList.remove('dragover');
      });
    });

    DOM.dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      DOM.dropzone.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) handleFileSelect(e.dataTransfer.files[0]);
    });

    // Verification actions
    DOM.btnReset.addEventListener('click', resetPortal);
    DOM.btnVerify.addEventListener('click', verifyKeybox);
    DOM.btnRefreshPool.addEventListener('click', recheckKeyboxPool);

    // Sources Modal Controls
    if (DOM.btnOpenSourcesModal && DOM.sourcesScraperModal) {
      DOM.btnOpenSourcesModal.addEventListener('click', () => {
        DOM.sourcesScraperModal.classList.add('active');
        loadSourcesConfig();
      });
    }

    if (DOM.btnCloseSourcesModal && DOM.sourcesScraperModal) {
      DOM.btnCloseSourcesModal.addEventListener('click', () => {
        DOM.sourcesScraperModal.classList.remove('active');
      });
    }

    if (DOM.sourcesScraperModal) {
      DOM.sourcesScraperModal.addEventListener('click', (e) => {
        if (e.target === DOM.sourcesScraperModal) {
          DOM.sourcesScraperModal.classList.remove('active');
        }
      });
    }

    // Add & Scan Action
    if (DOM.btnAddSourceAction && DOM.sourcesAddUrlInput) {
      const submitSource = () => {
        addSourceUrl(
          DOM.sourcesAddUrlInput.value,
          DOM.sourcesAddNameInput ? DOM.sourcesAddNameInput.value : ''
        );
      };

      DOM.btnAddSourceAction.addEventListener('click', submitSource);
      DOM.sourcesAddUrlInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          submitSource();
        }
      });

      if (DOM.sourcesAddNameInput) {
        DOM.sourcesAddNameInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submitSource();
          }
        });
      }
    }

    if (DOM.btnRunSourcesScraper) {
      DOM.btnRunSourcesScraper.addEventListener('click', runSourcesScraper);
    }

    if (DOM.btnClearSourcesLogs && DOM.sourcesLogList) {
      DOM.btnClearSourcesLogs.addEventListener('click', () => {
        DOM.sourcesLogList.innerHTML = '<div class="log-entry info"><span class="log-tag info">INFO</span> Log cleared.</div>';
      });
    }

    // Event Delegation for Pool Cards (Download, Delete, Copy)
    if (DOM.poolGridContainer) {
      DOM.poolGridContainer.addEventListener('click', (e) => {
        const copyXmlBtn = e.target.closest('[data-action="copy-xml"]');
        if (copyXmlBtn) {
          const serial = copyXmlBtn.getAttribute('data-serial');
          if (serial) copyKeyboxXml(serial, copyXmlBtn);
          return;
        }

        const downloadBtn = e.target.closest('[data-action="download-xml"]');
        if (downloadBtn) {
          const serial = downloadBtn.getAttribute('data-serial');
          if (serial) downloadKeyboxXml(serial);
          return;
        }

        const deleteBtn = e.target.closest('[data-action="delete-keybox"]');
        if (deleteBtn) {
          const serial = deleteBtn.getAttribute('data-serial');
          if (serial && confirm(`Delete keybox (${serial}) from database?`)) {
            deleteStoredKeybox(serial);
          }
        }
      });
    }

    // Workflow cURL command copy button
    if (DOM.btnCopyCurl) {
      DOM.btnCopyCurl.addEventListener('click', () => {
        const url = `${window.location.origin}/api/download`;
        const cmd = `curl -L -o keybox.xml ${url}`;
        navigator.clipboard.writeText(cmd).then(() => {
          DOM.btnCopyCurl.classList.add('copied');
          const textSpan = DOM.btnCopyCurl.querySelector('.copy-text');
          if (textSpan) textSpan.textContent = 'Copied!';
          showToast('cURL command copied to clipboard!');
          setTimeout(() => {
            DOM.btnCopyCurl.classList.remove('copied');
            if (textSpan) textSpan.textContent = 'Copy';
          }, 2000);
        }).catch(() => {
          showToast('Failed to copy to clipboard.', 'error');
        });
      });
    }

    // Download Panel Copy URL
    if (DOM.btnCopyDownloadUrl) {
      DOM.btnCopyDownloadUrl.addEventListener('click', () => {
        const url = `${window.location.origin}/api/download`;
        navigator.clipboard.writeText(url).then(() => {
          showToast('Endpoint URL copied to clipboard: /api/download');
        }).catch(() => {
          showToast('Failed to copy to clipboard.', 'error');
        });
      });
    }

    // Direct Download action feedback
    if (DOM.btnDirectDownloadAction) {
      DOM.btnDirectDownloadAction.addEventListener('click', () => {
        showToast('Initiating keybox.xml download from pool...', 'info');
      });
    }

    // Download Mode Selector
    if (DOM.downloadModeBtns) {
      DOM.downloadModeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          const mode = btn.getAttribute('data-download-mode');
          switchDownloadMode(mode);
        });
      });
    }

    // Selected Keybox Dropdown Change
    if (DOM.selectDownloadKeybox) {
      DOM.selectDownloadKeybox.addEventListener('change', () => {
        const serial = DOM.selectDownloadKeybox.value;
        if (serial) {
          activeSelectedSerial = serial;
          saveDownloadConfig('selected', serial);
          renderDownloadMode();
          showToast(`Active download keybox set to SN: ${serial.slice(0, 14)}...`, 'success');
        }
      });
    }
  }

  // ===== Method Switching =====
  function switchMethod(method) {
    activeMethod = method;
    DOM.methodBtns.forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-method') === method);
    });

    if (method === 'upload') {
      DOM.methodUploadContainer.style.display = 'flex';
      DOM.methodPasteContainer.style.display = 'none';
    } else {
      DOM.methodUploadContainer.style.display = 'none';
      DOM.methodPasteContainer.style.display = 'flex';
      DOM.xmlPaste.focus();
    }
  }

  // ===== Download Mode Management =====
  async function loadDownloadConfig() {
    try {
      const res = await fetch('/api/download/config');
      if (!res.ok) return;
      const data = await res.json();
      activeDownloadMode = data.mode || 'random';
      if (data.selected_serial) {
        activeSelectedSerial = data.selected_serial;
      }
      downloadConfigLoaded = true;
      populateDownloadKeyboxDropdown();
      renderDownloadMode();
    } catch (e) {
      console.error('Error loading download config:', e);
      downloadConfigLoaded = true;
    }
  }

  async function saveDownloadConfig(mode, serial) {
    try {
      activeDownloadMode = mode;
      if (serial) {
        activeSelectedSerial = serial;
      }
      renderDownloadMode();
      await fetch('/api/download/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, selected_serial: serial })
      });
    } catch (e) {
      console.error('Error saving download config:', e);
    }
  }

  function switchDownloadMode(mode) {
    if (mode === activeDownloadMode) return;
    activeDownloadMode = mode;
    if (mode === 'selected') {
      if (!activeSelectedSerial && cachedKeyboxes.length > 0) {
        const firstValid = cachedKeyboxes.find(kb => kb.status === 'STRONG' || kb.status === 'SOFTBAN') || cachedKeyboxes[0];
        activeSelectedSerial = firstValid ? firstValid.serial_number : null;
      }
      saveDownloadConfig('selected', activeSelectedSerial);
      showToast('Switched to Selected Keybox mode', 'info');
    } else {
      saveDownloadConfig('random', activeSelectedSerial);
      showToast('Switched to Random Keybox mode', 'info');
    }
    populateDownloadKeyboxDropdown();
    renderDownloadMode();
  }

  function populateDownloadKeyboxDropdown() {
    if (!DOM.selectDownloadKeybox) return;
    if (!cachedKeyboxes || cachedKeyboxes.length === 0) {
      DOM.selectDownloadKeybox.innerHTML = '<option value="" disabled selected>No keyboxes in pool</option>';
      return;
    }

    const sorted = [...cachedKeyboxes].sort((a, b) => {
      const order = { 'STRONG': 0, 'VALID': 1, 'SOFTBAN': 2, 'REVOKED': 3, 'INVALID': 4 };
      return (order[a.status] ?? 99) - (order[b.status] ?? 99);
    });

    // Only if config has loaded and we have an active serial that was deleted from pool, fallback
    if (downloadConfigLoaded) {
      const exists = sorted.some(kb => kb.serial_number === activeSelectedSerial);
      if (!exists && activeSelectedSerial) {
        // Selected keybox was deleted from pool, fallback to top candidate
        activeSelectedSerial = sorted[0].serial_number;
        if (activeDownloadMode === 'selected') {
          saveDownloadConfig('selected', activeSelectedSerial);
        }
      } else if (!activeSelectedSerial && sorted.length > 0) {
        activeSelectedSerial = sorted[0].serial_number;
      }
    }

    DOM.selectDownloadKeybox.innerHTML = sorted.map(kb => {
      const sn = kb.serial_number || 'Unknown';
      const status = (kb.status || 'UNKNOWN').toUpperCase();
      const dev = kb.device_id || 'Unknown';
      const root = kb.root_name || kb.root_type || 'Root';
      const isSelected = activeSelectedSerial === sn;
      const statusTag = status === 'STRONG' ? 'STRONG' : (status === 'SOFTBAN' ? 'SOFTBAN' : (status === 'REVOKED' ? 'REVOKED' : 'INVALID'));
      return `<option value="${escapeHtml(sn)}" ${isSelected ? 'selected' : ''}>[${statusTag}] SN: ${escapeHtml(sn)} - ${escapeHtml(dev)} (${escapeHtml(root)})</option>`;
    }).join('');

    if (activeSelectedSerial) {
      DOM.selectDownloadKeybox.value = activeSelectedSerial;
    }
  }

  function renderDownloadMode() {
    if (DOM.downloadModeBtns) {
      DOM.downloadModeBtns.forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-download-mode') === activeDownloadMode);
      });
    }

    if (activeDownloadMode === 'random') {
      if (DOM.gridTargetRandomView) DOM.gridTargetRandomView.style.display = 'block';
      if (DOM.gridTargetSelectedView) DOM.gridTargetSelectedView.style.display = 'none';
      if (DOM.downloadHeroDesc) DOM.downloadHeroDesc.textContent = 'Random valid keybox with Strong / Hardware Google root priority';
      if (DOM.downloadModeBadgeText) DOM.downloadModeBadgeText.textContent = 'Random Priority';
      if (DOM.specLblTarget) DOM.specLblTarget.textContent = 'Integrity Status';
      if (DOM.specValTarget) {
        DOM.specValTarget.className = 'spec-value valid';
        DOM.specValTarget.innerHTML = '<i class="fa-solid fa-shield-check"></i> Strong Priority';
      }
    } else {
      if (DOM.gridTargetRandomView) DOM.gridTargetRandomView.style.display = 'none';
      if (DOM.gridTargetSelectedView) DOM.gridTargetSelectedView.style.display = 'block';

      const selectedKb = cachedKeyboxes.find(k => k.serial_number === activeSelectedSerial);
      if (selectedKb) {
        if (DOM.downloadHeroDesc) DOM.downloadHeroDesc.textContent = `Serving keybox SN: ${selectedKb.serial_number} (${selectedKb.device_id || 'Unknown'})`;
        const snShort = selectedKb.serial_number.length > 12 ? `${selectedKb.serial_number.slice(0, 10)}...` : selectedKb.serial_number;
        if (DOM.downloadModeBadgeText) DOM.downloadModeBadgeText.textContent = `Selected: ${snShort}`;
      } else {
        if (DOM.downloadHeroDesc) DOM.downloadHeroDesc.textContent = 'Select a keybox from pool to serve via /api/download';
        if (DOM.downloadModeBadgeText) DOM.downloadModeBadgeText.textContent = 'Pick a Keybox';
      }
    }
  }

  // ===== File Handling =====
  function handleFileSelect(file) {
    if (!file.name.toLowerCase().endsWith('.xml')) {
      showToast('Please upload a valid .xml file.', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = function (e) {
      loadedXmlContent = e.target.result;
      DOM.selectedFileName.textContent = `${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
      DOM.selectedFileInfo.classList.remove('hidden');
      DOM.xmlPaste.value = loadedXmlContent;
      DOM.editorStatus.textContent = 'XML Loaded';
      showToast(`Loaded ${file.name}`);
    };
    reader.readAsText(file);
  }

  function resetPortal() {
    loadedXmlContent = '';
    DOM.fileInput.value = '';
    DOM.xmlPaste.value = '';
    DOM.selectedFileInfo.classList.add('hidden');
    DOM.editorStatus.textContent = 'Ready';
    showToast('Verifier reset.');
  }

  // ===== Verification API =====
  async function verifyKeybox() {
    const xmlContent = (activeMethod === 'upload' ? loadedXmlContent : DOM.xmlPaste.value).trim();

    if (!xmlContent) {
      showToast('Please upload a file or paste Keybox XML content.', 'warning');
      return;
    }

    DOM.btnVerify.disabled = true;
    DOM.btnVerify.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Verifying...';

    try {
      const response = await fetch('/api/keybox/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ xml_content: xmlContent })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Verification failed');

      renderKeyboxResults(data.result);
      if (DOM.resultModal) DOM.resultModal.classList.add('active');

      if (data.is_duplicate) {
        showToast(`⚠️ Duplicate Keybox: Already present in active pool (${data.status}).`, 'warning');
      } else if (data.success) {
        showToast('Keybox verified & saved to active pool!', 'success');
      } else {
        showToast('Keybox is INVALID or REVOKED!', 'error');
      }

      loadDashboardStats();
      loadKeyboxPool();
    } catch (err) {
      showToast(err.message || 'Error occurred during verification.', 'error');
    } finally {
      DOM.btnVerify.disabled = false;
      DOM.btnVerify.innerHTML = '<i class="fa-solid fa-circle-check"></i> Verify Keybox';
    }
  }

  window.closeKeyboxResultModal = function () {
    if (DOM.resultModal) DOM.resultModal.classList.remove('active');
  };

  // ===== Render Results Modal =====
  function renderKeyboxResults(res) {
    if (!DOM.resultContainer) return;

    const status = (res.status || 'INVALID').toUpperCase();
    let statusClass = 'invalid';
    let statusLabel = 'INVALID / EXPIRED';
    let statusIcon = 'fa-circle-xmark';
    let statusSub = res.integrityVerdict || 'Corrupted XML, expired certificate or broken chain';

    if (status === 'STRONG') {
      statusClass = 'strong';
      statusLabel = 'STRONG INTEGRITY';
      statusIcon = 'fa-shield-check';
      statusSub = res.integrityVerdict || 'Google Hardware / RKP Root CA · Verified & Clean Attestation';
    } else if (status === 'SOFTBAN') {
      statusClass = 'softban';
      statusLabel = 'DEVICE (SOFTBAN)';
      statusIcon = 'fa-triangle-exclamation';
      statusSub = res.softbanReason || res.integrityVerdict || 'Softbanned / Software Root · Evaluated as Device Integrity only';
    } else if (status === 'REVOKED') {
      statusClass = 'revoked';
      statusLabel = 'REVOKED (BLACKLISTED)';
      statusIcon = 'fa-ban';
      statusSub = res.revokeReason || 'Revoked in Google Attestation CRL status list';
    }

    const duplicateWarningHtml = res.isDuplicate ? `
      <div class="result-duplicate-warning" style="background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.45); border-radius: var(--radius-sm); padding: 10px 14px; margin-bottom: 12px; display: flex; align-items: center; gap: 10px; color: #fbbf24;">
        <i class="fa-solid fa-triangle-exclamation" style="font-size: 1.15rem; flex-shrink: 0;"></i>
        <div style="font-size: 0.82rem; font-weight: 600; line-height: 1.4;">
          ${escapeHtml(res.duplicateWarning || 'Duplicate Warning: This keybox is already present in your active database pool. Status has been updated.')}
        </div>
      </div>
    ` : '';

    const isGoogleRoot = res.isGoogleRoot === true || res.rootType === 'hardware' || res.rootType === 'rkp';
    const rootKindTag = (res.rootType === 'rkp') 
      ? '<span class="status-pill strong" style="font-size: 0.7rem; padding: 2px 7px; margin-left: 6px;"><i class="fa-solid fa-cloud-arrow-down"></i> Google RKP</span>' 
      : (res.rootType === 'hardware') 
        ? '<span class="status-pill strong" style="font-size: 0.7rem; padding: 2px 7px; margin-left: 6px;"><i class="fa-solid fa-microchip"></i> Google TEE</span>' 
        : (res.rootType === 'software') 
          ? '<span class="status-pill softban" style="font-size: 0.7rem; padding: 2px 7px; margin-left: 6px;"><i class="fa-solid fa-code"></i> AOSP Root</span>' 
          : '<span class="status-pill invalid" style="font-size: 0.7rem; padding: 2px 7px; margin-left: 6px;"><i class="fa-solid fa-triangle-exclamation"></i> Non-Google Root</span>';

    const googleTrustHtml = isGoogleRoot
      ? '<span style="color: var(--success); font-weight: 700;"><i class="fa-solid fa-circle-check"></i> Google Attestation Root (Trusted by Play Integrity)</span>'
      : (res.rootType === 'software')
        ? '<span style="color: var(--warning); font-weight: 700;"><i class="fa-solid fa-triangle-exclamation"></i> AOSP Test Root (Basic Device Integrity Only)</span>'
        : '<span style="color: var(--danger); font-weight: 700;"><i class="fa-solid fa-circle-xmark"></i> Untrusted Root Authority (Play Integrity will not trust non-Google root)</span>';

    const daysLeftHtml = (res.daysLeft !== undefined && res.daysLeft !== null) 
      ? `<span style="color: ${res.isExpiringSoon ? 'var(--warning)' : 'var(--success)'}; font-weight: 700;">${res.daysLeft} days remaining</span> ${res.isExpiringSoon ? '<span class="status-pill softban" style="font-size: 0.68rem; padding: 1px 6px; margin-left: 4px;">Expiring Soon</span>' : ''}` 
      : 'N/A';

    const privKeyHtml = res.privateKeyMatch === true
      ? '<span style="color: var(--success); font-weight: 700;"><i class="fa-solid fa-check"></i> MATCHED (SPKI Verified)</span>'
      : res.privateKeyMatch === false
        ? '<span style="color: var(--danger); font-weight: 700;"><i class="fa-solid fa-xmark"></i> MISMATCHED</span>'
        : '<span style="color: var(--text-dim);">N/A (No Private Key)</span>';

    const chainIntegrityHtml = res.chainValid
      ? `<span style="color: var(--success); font-weight: 700;"><i class="fa-solid fa-link"></i> VERIFIED (${res.certCount || (res.certInfos ? res.certInfos.length : 0)} certs)</span>`
      : `<span style="color: var(--danger); font-weight: 700;"><i class="fa-solid fa-link-slash"></i> BROKEN (${res.brokenLinksCount || 1} broken signature)</span>`;

    const certsHtml = (res.certInfos || []).map(c => `
      <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid var(--border-color); border-radius: var(--radius-sm); padding: 10px; margin-top: 8px; font-size: 0.78rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
          <span style="font-weight: 700; color: var(--text-main);">Cert Level ${c.level} (SN: <code style="color: var(--accent);">${escapeHtml(c.serialNumber)}</code>)</span>
          <span class="status-pill ${c.isValid ? 'strong' : 'invalid'}" style="font-size: 0.68rem; padding: 2px 6px;">${c.isValid ? 'VALID' : 'EXPIRED'}</span>
        </div>
        <div style="color: var(--text-muted); margin-top: 2px;">Subject: <span style="font-family: var(--font-mono); color: var(--text-main); font-size: 0.74rem;">${escapeHtml(c.subject)}</span></div>
        <div style="color: var(--text-muted); margin-top: 2px;">Issuer: <span style="font-family: var(--font-mono); color: var(--text-muted); font-size: 0.74rem;">${escapeHtml(c.issuer)}</span></div>
        <div style="color: var(--text-muted); margin-top: 2px;">Validity: <span style="color: ${c.isValid ? 'var(--success)' : 'var(--danger)'};">${escapeHtml(formatDateTime12Hour(c.notBefore))} to ${escapeHtml(formatDateTime12Hour(c.notAfter))}</span></div>
      </div>
    `).join('');

    DOM.resultContainer.innerHTML = `
      ${duplicateWarningHtml}
      <div class="result-status-banner ${statusClass}">
        <i class="fa-solid ${statusIcon}" style="font-size: 26px;"></i>
        <div>
          <div style="font-weight: 700; font-size: 1.05rem; letter-spacing: 0.5px;">${statusLabel}</div>
          <div style="font-size: 0.8rem; opacity: 0.85; margin-top: 3px;">${escapeHtml(statusSub)}</div>
        </div>
      </div>

      <table class="result-meta-table">
        <tbody>
          <tr><td>Integrity Verdict</td><td><span class="status-pill ${statusClass}">${status}</span></td></tr>
          <tr><td>Root Authority</td><td><strong>${escapeHtml(res.rootName || res.rootType || 'Attestation Root')}</strong> ${rootKindTag}</td></tr>
          <tr><td>Google Root Trust</td><td>${googleTrustHtml}</td></tr>
          <tr><td>Earliest Expiry</td><td>${escapeHtml(formatDateTime12Hour(res.expiresAt) || 'N/A')} (${daysLeftHtml})</td></tr>
          <tr><td>Device ID</td><td>${escapeHtml(res.deviceId || 'Unknown')}</td></tr>
          <tr><td>Serial Number (Leaf)</td><td><code style="color: var(--accent); font-family: var(--font-mono);">${escapeHtml(res.serialNumber || 'N/A')}</code></td></tr>
          <tr><td>Algorithm</td><td>${escapeHtml(res.algorithm || 'RSA/ECDSA')}</td></tr>
          <tr><td>Private Key Match</td><td>${privKeyHtml}</td></tr>
          <tr><td>Chain Signatures</td><td>${chainIntegrityHtml}</td></tr>
          <tr><td>Google CRL Status</td><td><span style="color: ${res.revoked ? 'var(--danger)' : 'var(--success)'}; font-weight: 700;">${res.revoked ? 'REVOKED (' + escapeHtml(res.revokeReason || 'CRL entry') + ')' : 'UNREVOKED (Clean)'}</span></td></tr>
          <tr><td>Specter Catalog / Softban</td><td><span style="color: ${res.isSoftbanned ? 'var(--warning)' : 'var(--success)'}; font-weight: 700;">${res.isSoftbanned ? 'FLAGGED (Device Integrity Only)' : 'CLEAN (Unflagged)'}</span></td></tr>
          <tr><td>Check Time (UTC)</td><td>${escapeHtml(formatDateTime12Hour(res.checkTime) || '')}</td></tr>
        </tbody>
      </table>

      <h4 style="font-size: 0.85rem; font-weight: 700; color: var(--text-main); margin-top: 14px;">Certificate Chain Details (${res.certCount || (res.certInfos ? res.certInfos.length : 0)} certs)</h4>
      ${certsHtml}
    `;
  }

  // ===== Date & Time Formatting (12-Hour AM/PM System) =====
  function formatDateTime12Hour(dateInput, includeSeconds = true) {
    if (!dateInput) return '—';
    try {
      const raw = String(dateInput).trim();
      if (!raw || raw === '—' || raw === 'N/A') return raw || '—';

      const match = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?(?:\s*(UTC))?/i);
      if (match) {
        const [_, y, mo, d, h, min, s, utcSuffix] = match;
        const moPadded = String(mo).padStart(2, '0');
        const dPadded = String(d).padStart(2, '0');
        if (h !== undefined && min !== undefined) {
          let hour = parseInt(h, 10);
          const ampm = hour >= 12 ? 'PM' : 'AM';
          hour = hour % 12 || 12;
          const hStr = String(hour).padStart(2, '0');
          const secStr = s !== undefined ? String(s).padStart(2, '0') : '00';
          const timePart = includeSeconds ? `${hStr}:${min}:${secStr} ${ampm}` : `${hStr}:${min} ${ampm}`;
          const tzPart = utcSuffix ? ' UTC' : '';
          return `${y}-${moPadded}-${dPadded} ${timePart}${tzPart}`;
        }
        return `${y}-${moPadded}-${dPadded}`;
      }

      const d = new Date(raw);
      if (!isNaN(d.getTime())) {
        const y = d.getFullYear();
        const mo = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        let hour = d.getHours();
        const ampm = hour >= 12 ? 'PM' : 'AM';
        hour = hour % 12 || 12;
        const hStr = String(hour).padStart(2, '0');
        const min = String(d.getMinutes()).padStart(2, '0');
        const sec = String(d.getSeconds()).padStart(2, '0');
        const timePart = includeSeconds ? `${hStr}:${min}:${sec} ${ampm}` : `${hStr}:${min} ${ampm}`;
        return `${y}-${mo}-${day} ${timePart}`;
      }
      return raw;
    } catch (e) {
      return String(dateInput);
    }
  }

  // ===== 24-Hour Purge Countdown Helper =====
  function getPurgeCountdownInfo(detectedAtIso, createdAtIso) {
    const timestamp = detectedAtIso || createdAtIso;
    if (!timestamp) return { text: 'Purge in ~24h', urgent: false };
    try {
      const detectedTime = new Date(timestamp).getTime();
      const purgeTime = detectedTime + (24 * 60 * 60 * 1000);
      const diffMs = purgeTime - Date.now();

      if (diffMs <= 0) return { text: 'Purging soon', urgent: true };
      const hours = Math.floor(diffMs / (3600 * 1000));
      const mins = Math.floor((diffMs % (3600 * 1000)) / (60 * 1000));
      return { text: `Purge in ~${hours}h ${mins}m`, urgent: hours < 1 };
    } catch (e) {
      return { text: 'Purge in ~24h', urgent: false };
    }
  }

  // ===== Active Pool Rendering =====
  async function loadKeyboxPool() {
    if (!DOM.poolGridContainer) return;

    try {
      const response = await fetch('/api/keyboxes');
      if (!response.ok) throw new Error('Failed to load keybox pool');
      const keyboxes = await response.json();
      cachedKeyboxes = keyboxes || [];

      if (DOM.valPoolCount) DOM.valPoolCount.textContent = cachedKeyboxes.length;

      if (cachedKeyboxes.length === 0) {
        populateDownloadKeyboxDropdown();
        renderDownloadMode();
        DOM.poolGridContainer.innerHTML = `
          <div class="pool-empty-state">
            <i class="fa-solid fa-box-open"></i>
            <h3>No Stored Keyboxes</h3>
            <p>Upload a keybox or run the Sources scraper to populate the pool.</p>
          </div>
        `;
        return;
      }

      populateDownloadKeyboxDropdown();
      renderDownloadMode();

      DOM.poolGridContainer.innerHTML = cachedKeyboxes.map(kb => {
        const rawStatus = (kb.status || 'UNKNOWN').toUpperCase();
        let statusClass = 'invalid';
        let statusIcon = 'fa-circle-xmark';
        let statusText = rawStatus;

        if (rawStatus === 'STRONG' || rawStatus === 'VALID') {
          statusClass = 'strong';
          statusIcon = 'fa-shield-check';
          statusText = 'STRONG';
        } else if (rawStatus === 'SOFTBAN') {
          statusClass = 'softban';
          statusIcon = 'fa-triangle-exclamation';
          statusText = 'SOFTBAN';
        } else if (rawStatus === 'REVOKED') {
          statusClass = 'revoked';
          statusIcon = 'fa-ban';
          statusText = 'REVOKED';
        }

        const isExpiring = (rawStatus === 'REVOKED' || rawStatus === 'INVALID');
        const countdownInfo = isExpiring ? getPurgeCountdownInfo(kb.detected_revoked_at, kb.created_at) : null;
        const countdownPillHtml = countdownInfo ? `
          <span class="purge-countdown-pill ${countdownInfo.urgent ? 'urgent' : ''}" title="Auto-purged 24 hours after detection (Detected: ${escapeHtml(formatDateTime12Hour(kb.detected_revoked_at || kb.created_at))})">
            <i class="fa-solid fa-clock"></i>
            ${countdownInfo.text}
          </span>
        ` : '';

        let daysPillHtml = '';
        if (!isExpiring && kb.days_left !== undefined && kb.days_left !== null) {
          const days = parseInt(kb.days_left, 10);
          const isUrgent = days <= 14;
          daysPillHtml = `
            <span class="purge-countdown-pill ${isUrgent ? 'urgent' : ''}" style="background: ${isUrgent ? 'rgba(245, 158, 11, 0.15)' : 'rgba(16, 185, 129, 0.15)'}; border-color: ${isUrgent ? 'rgba(245, 158, 11, 0.35)' : 'rgba(16, 185, 129, 0.35)'}; color: ${isUrgent ? 'var(--warning)' : 'var(--success)'};" title="Certificate Validity: ${days} days remaining">
              <i class="fa-solid fa-hourglass-half"></i>
              ${days}d left
            </span>
          `;
        }

        const xmlContent = kb.xml_content || '';
        let sizeText = '';
        if (xmlContent) {
          const byteLen = new TextEncoder().encode(xmlContent).length;
          sizeText = byteLen < 1024 ? `${byteLen} B` : `${(byteLen / 1024).toFixed(1)} KB`;
        }
        const sizeBadge = sizeText ? ` <span class="btn-size-tag">(${escapeHtml(sizeText)})</span>` : '';
        const displayRoot = kb.root_name || kb.root_type || 'Root';
        const rawSourceName = (kb.source || 'Web Verification').trim();
        const isWeb = rawSourceName.toLowerCase().includes('web') || rawSourceName.toLowerCase().includes('upload');
        const isSpecter = rawSourceName.toLowerCase().includes('specter') || rawSourceName.toLowerCase().includes('catalog');
        const sourceIcon = isWeb ? 'fa-arrow-up-from-bracket' : (isSpecter ? 'fa-layer-group' : 'fa-globe');
        const displaySource = rawSourceName;

        return `
          <div class="keybox-pool-card glass-panel">
            <div class="card-top-row">
              <span class="status-pill ${statusClass}" title="${escapeHtml(statusText)} Attestation Status">
                <i class="fa-solid ${statusIcon}"></i>
                ${escapeHtml(statusText)}
              </span>
              ${countdownPillHtml}
              ${daysPillHtml}
              <span class="card-date">${escapeHtml(formatDateTime12Hour(kb.created_at))}</span>
            </div>

            <div class="card-meta-grid">
              <div class="meta-item">
                <span class="meta-label">Device ID</span>
                <span class="meta-value">${escapeHtml(kb.device_id || 'Unknown')}</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">Root Authority</span>
                <span class="meta-value" title="${escapeHtml(displayRoot)}">${escapeHtml(displayRoot)}</span>
              </div>
              <div class="meta-item" style="grid-column: span 2;">
                <span class="meta-label">Serial Number</span>
                <span class="meta-value" style="color: var(--accent); font-family: var(--font-mono); font-size: 0.75rem;" title="${escapeHtml(kb.serial_number || 'N/A')}">${escapeHtml(kb.serial_number || 'N/A')}</span>
              </div>
              <div class="meta-item" style="grid-column: span 2;">
                <span class="meta-label">Source</span>
                <span class="meta-value" title="${escapeHtml(kb.source_url ? `${displaySource} (${kb.source_url})` : displaySource)}" style="display: flex; align-items: center; gap: 5px;">
                  <i class="fa-solid ${sourceIcon}" style="font-size: 0.7rem; color: var(--accent); flex-shrink: 0;"></i>
                  <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(displaySource)}</span>
                </span>
              </div>
            </div>

            <div class="card-actions-row">
              <button class="card-action-btn copy-btn" title="Copy Keybox XML" data-action="copy-xml" data-serial="${escapeHtml(kb.serial_number)}">
                <i class="fa-solid fa-copy"></i> Copy XML
              </button>
              <button class="card-action-btn download-btn" title="Download keybox.xml${sizeText ? ` (${sizeText})` : ''}" data-action="download-xml" data-serial="${escapeHtml(kb.serial_number)}">
                <i class="fa-solid fa-download"></i> keybox.xml${sizeBadge}
              </button>
              <button class="card-action-btn delete-btn" title="Delete from pool" data-action="delete-keybox" data-serial="${escapeHtml(kb.serial_number)}">
                <i class="fa-solid fa-trash"></i>
              </button>
            </div>
          </div>
        `;
      }).join('');
    } catch (e) {
      console.error('Failed to load keybox pool:', e);
    }
  }

  // ===== Dashboard Stats & Pool Re-verification =====
  async function loadDashboardStats() {
    try {
      const res = await fetch('/api/stats');
      if (!res.ok) return;
      const stats = await res.json();

      if (DOM.hdrStatStrong) DOM.hdrStatStrong.textContent = stats.strong_keyboxes || 0;
      if (DOM.hdrStatSoftban) DOM.hdrStatSoftban.textContent = stats.softban_keyboxes || 0;
      if (DOM.hdrStatRevoked) DOM.hdrStatRevoked.textContent = stats.revoked_keyboxes || 0;
      if (DOM.hdrStatTotal) DOM.hdrStatTotal.textContent = stats.total_pool || 0;
      if (DOM.hdrStatSources) DOM.hdrStatSources.textContent = stats.sources_monitored || 0;
      if (DOM.launcherSourcesBadge) DOM.launcherSourcesBadge.textContent = stats.sources_monitored || 0;

      if (stats.last_pool_check) {
        updatePoolLastCheckedDisplay(stats.last_pool_check);
      }
    } catch (e) {
      console.error('Stats error:', e);
    }
  }

  function updatePoolLastCheckedDisplay(isoString) {
    if (!DOM.poolLastCheckedText) return;
    if (!isoString) {
      DOM.poolLastCheckedText.textContent = 'Checked: Ready';
      return;
    }
    DOM.poolLastCheckedText.textContent = `Checked: ${formatDateTime12Hour(isoString)}`;
  }

  async function recheckKeyboxPool() {
    if (!DOM.btnRefreshPool) return;
    const btn = DOM.btnRefreshPool;
    btn.classList.add('loading');
    btn.disabled = true;

    try {
      showToast('Re-checking all stored keyboxes against Google CRL...', 'info');
      const res = await fetch('/api/keyboxes/recheck', { method: 'POST' });
      if (!res.ok) throw new Error(`Server returned HTTP ${res.status}`);
      const data = await res.json();

      if (data.last_checked_at) {
        updatePoolLastCheckedDisplay(data.last_checked_at);
      }

      await loadDashboardStats();
      await loadKeyboxPool();

      const summary = `Re-checked ${data.checked_count || 0} keybox(es): ${data.strong_count || 0} Strong, ${data.softban_count || 0} SoftBan, ${data.revoked_count || 0} Revoked.`;
      showToast(summary, 'success');
    } catch (err) {
      console.error('Error during pool recheck:', err);
      showToast(`Failed to re-check pool: ${err.message}`, 'error');
      await loadDashboardStats();
      await loadKeyboxPool();
    } finally {
      btn.classList.remove('loading');
      btn.disabled = false;
    }
  }

  // ===== Copy, Download & Delete Actions =====
  async function copyKeyboxXml(serialNumber, buttonEl) {
    try {
      let kb = cachedKeyboxes.find(k => k.serial_number === serialNumber);
      if (!kb || !kb.xml_content) {
        const response = await fetch('/api/keyboxes');
        if (!response.ok) throw new Error('Failed to fetch keybox details.');
        cachedKeyboxes = await response.json();
        kb = cachedKeyboxes.find(k => k.serial_number === serialNumber);
      }

      if (!kb || !kb.xml_content) throw new Error('Keybox XML content not found.');

      await navigator.clipboard.writeText(kb.xml_content);
      showToast(`Keybox XML (${serialNumber.substring(0, 8)}...) copied!`, 'success');

      if (buttonEl) {
        buttonEl.classList.add('copied');
        const originalHtml = buttonEl.innerHTML;
        buttonEl.innerHTML = '<i class="fa-solid fa-check"></i> Copied!';
        setTimeout(() => {
          buttonEl.classList.remove('copied');
          buttonEl.innerHTML = originalHtml;
        }, 2000);
      }
    } catch (e) {
      showToast(e.message || 'Failed to copy XML to clipboard.', 'error');
    }
  }

  async function downloadKeyboxXml(serialNumber) {
    try {
      let kb = cachedKeyboxes.find(k => k.serial_number === serialNumber);
      if (!kb || !kb.xml_content) {
        const response = await fetch('/api/keyboxes');
        cachedKeyboxes = await response.json();
        kb = cachedKeyboxes.find(k => k.serial_number === serialNumber);
      }

      if (!kb || !kb.xml_content) throw new Error('XML content not found.');

      const blob = new Blob([kb.xml_content], { type: 'application/xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `keybox_${serialNumber}.xml`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast(`Downloading keybox_${serialNumber}.xml`);
    } catch (e) {
      showToast(e.message || 'Download failed.', 'error');
    }
  }

  async function deleteStoredKeybox(serialNumber) {
    try {
      const response = await fetch(`/api/keyboxes/${encodeURIComponent(serialNumber)}`, {
        method: 'DELETE'
      });
      if (!response.ok) throw new Error('Failed to delete keybox');
      showToast('Keybox deleted from database.', 'success');
      loadDashboardStats();
      loadKeyboxPool();
    } catch (e) {
      showToast(e.message || 'Error deleting keybox.', 'error');
    }
  }

  // ===== Community Sources Management =====
  async function loadSourcesConfig() {
    try {
      const res = await fetch('/api/keybox/sources/config');
      if (!res.ok) return;
      const cfg = await res.json();
      sourcesList = cfg.sources || [];
      renderSourcesList();
    } catch (e) {
      console.error('Sources config load error:', e);
    }
  }

  function renderSourcesList() {
    if (!DOM.sourcesTableBody) return;

    if (sourcesList.length === 0) {
      DOM.sourcesTableBody.innerHTML = `
        <tr>
          <td colspan="6" style="padding: 36px; text-align: center; color: #64748b;">
            <i class="fa-solid fa-globe" style="font-size: 24px; margin-bottom: 8px; opacity: 0.5;"></i>
            <p style="margin: 0; font-size: 0.86rem;">No community sources found. Enter a raw URL link above and click "Add & scan".</p>
          </td>
        </tr>
      `;
      return;
    }

    DOM.sourcesTableBody.innerHTML = sourcesList.map((src, idx) => {
      const url = typeof src === 'object' ? (src.url || src.link || '') : src;
      const name = typeof src === 'object' ? (src.name || src.title || url) : url;
      const type = typeof src === 'object' ? (src.type || (url.includes('specter') || url.includes('catalog') ? 'specter' : 'raw_url')) : 'raw_url';
      const scanStatus = typeof src === 'object' ? (src.scan_status || 'Ready') : 'Ready';
      const lastScraped = typeof src === 'object' ? src.last_scraped_at : null;
      const dateText = formatDateTime12Hour(lastScraped);

      let statusClass = 'ready';
      if (scanStatus.toLowerCase().startsWith('ok')) {
        statusClass = 'ok';
      } else if (scanStatus.toLowerCase().includes('fail') || scanStatus.toLowerCase().includes('error')) {
        statusClass = 'failed';
      }

      return `
        <tr>
          <td>
            <div class="sources-pic-source-name" title="${escapeHtml(name)}">
              ${escapeHtml(name)}
            </div>
          </td>
          <td>
            <span class="sources-pic-type-tag">${escapeHtml(type)}</span>
          </td>
          <td>
            <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="sources-pic-url-link" title="${escapeHtml(url)}">
              ${escapeHtml(url)}
            </a>
          </td>
          <td>
            <span class="sources-pic-status ${statusClass}">${escapeHtml(scanStatus)}</span>
          </td>
          <td>
            <span class="sources-pic-date">${escapeHtml(dateText)}</span>
          </td>
          <td style="text-align: center;">
            <div style="display: flex; gap: 5px; justify-content: center; align-items: center;">
              <button class="sources-row-action-btn scan" data-idx="${idx}" title="Scan this source now">
                <i class="fa-solid fa-play"></i>
              </button>
              <button class="sources-row-action-btn delete" data-idx="${idx}" title="Delete source">
                <i class="fa-solid fa-trash"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    DOM.sourcesTableBody.querySelectorAll('.sources-row-action-btn.delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const idx = parseInt(btn.getAttribute('data-idx'), 10);
        const removed = sourcesList.splice(idx, 1);
        renderSourcesList();
        await saveSourcesConfig();
        if (removed && removed[0]) {
          showToast(`Removed source "${removed[0].name || 'Source'}"`);
        }
      });
    });

    DOM.sourcesTableBody.querySelectorAll('.sources-row-action-btn.scan').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-idx'), 10);
        const targetSrc = sourcesList[idx];
        if (targetSrc) scrapeSingleSource(targetSrc, btn);
      });
    });
  }

  async function addSourceUrl(rawUrl, rawName) {
    let url = (rawUrl || '').trim();
    if (!url) {
      showToast('Please enter a valid raw source URL.', 'warning');
      return;
    }

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }

    let name = (rawName || '').trim();
    if (!name) {
      try {
        const parsed = new URL(url);
        name = parsed.pathname.split('/').filter(Boolean).pop() || parsed.hostname;
      } catch (e) {
        name = url.substring(0, 25);
      }
    }

    const type = (url.toLowerCase().includes('specter') || url.toLowerCase().includes('catalog') || url.toLowerCase().includes('dpejoh')) ? 'specter' : 'raw_url';

    if (sourcesList.some(s => (typeof s === 'object' ? s.url : s).toLowerCase() === url.toLowerCase())) {
      showToast('This source URL is already added.', 'warning');
      return;
    }

    const newSource = { name, url, type, interval: 1.0, scan_status: 'Scanning...', last_scraped_at: new Date().toISOString() };
    sourcesList.unshift(newSource);
    if (DOM.sourcesAddUrlInput) DOM.sourcesAddUrlInput.value = '';
    if (DOM.sourcesAddNameInput) DOM.sourcesAddNameInput.value = '';
    renderSourcesList();
    showToast(`Added source "${name}". Scanning now...`, 'info');

    await scrapeSingleSource(newSource);
  }

  async function saveSourcesConfig() {
    try {
      const res = await fetch('/api/keybox/sources/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sources: sourcesList })
      });
      if (!res.ok) throw new Error('Failed to save sources configuration');
      loadDashboardStats();
    } catch (e) {
      console.error('Error saving sources config:', e);
    }
  }

  async function scrapeSingleSource(srcItem, btnElement) {
    if (!srcItem) return;
    const url = typeof srcItem === 'object' ? srcItem.url : srcItem;
    const name = typeof srcItem === 'object' ? (srcItem.name || url) : url;

    const originalHtml = btnElement ? btnElement.innerHTML : '';
    if (btnElement) {
      btnElement.disabled = true;
      btnElement.innerHTML = '<i class="fa-solid fa-spinner fa-spin" style="font-size: 10px;"></i>';
    }

    appendSourcesLog('info', `Scanning source "${name}" (${url})...`);

    try {
      const res = await fetch('/api/keybox/sources/scrape-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, name })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Scraping failed');

      const results = data.results || {};
      (results.details || []).forEach(d => {
        appendSourcesLog(d.type || 'info', d.text);
      });

      const savedCount = results.saved_to_db || 0;
      const foundCount = results.scraped_files || 0;
      appendSourcesLog('valid', `Done "${name}"! Candidates: ${foundCount}, Saved: ${savedCount}`);
      showToast(`Scan complete: "${name}" (${savedCount} saved to pool)`, 'success');

      await loadSourcesConfig();
      loadDashboardStats();
      loadKeyboxPool();
    } catch (e) {
      appendSourcesLog('error', `Error scanning "${name}": ${e.message}`);
      showToast(e.message || 'Error scanning source.', 'error');
    } finally {
      if (btnElement) {
        btnElement.disabled = false;
        btnElement.innerHTML = originalHtml;
      }
    }
  }

  async function runSourcesScraper() {
    if (sourcesList.length === 0) {
      showToast('Please add at least one source link.', 'warning');
      return;
    }

    DOM.btnRunSourcesScraper.disabled = true;
    DOM.btnRunSourcesScraper.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Scanning...';
    appendSourcesLog('info', `Starting scan for ${sourcesList.length} community source(s)...`);

    try {
      const res = await fetch('/api/keybox/sources/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sources: sourcesList })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Scraping failed');

      const results = data.results || {};
      (results.details || []).forEach(d => {
        appendSourcesLog(d.type || 'info', d.text);
      });

      appendSourcesLog('valid', `All sources scanned! Candidates: ${results.scraped_files || 0}, Saved: ${results.saved_to_db || 0}`);
      showToast(`Scan finished! Saved ${results.saved_to_db || 0} keyboxes to pool.`, 'success');

      await loadSourcesConfig();
      loadDashboardStats();
      loadKeyboxPool();
    } catch (e) {
      appendSourcesLog('error', `Scan Error: ${e.message}`);
      showToast(e.message || 'Error scanning community sources.', 'error');
    } finally {
      DOM.btnRunSourcesScraper.disabled = false;
      DOM.btnRunSourcesScraper.innerHTML = '<i class="fa-solid fa-rotate"></i> Scan sources now';
    }
  }

  function appendSourcesLog(type, text) {
    if (!DOM.sourcesLogList) return;
    const now = new Date();
    let hour = now.getHours();
    const ampm = hour >= 12 ? 'PM' : 'AM';
    hour = hour % 12 || 12;
    const hStr = String(hour).padStart(2, '0');
    const mStr = String(now.getMinutes()).padStart(2, '0');
    const sStr = String(now.getSeconds()).padStart(2, '0');
    const timeStr = `${hStr}:${mStr}:${sStr} ${ampm}`;

    const item = document.createElement('div');
    item.className = `log-entry ${type}`;
    item.innerHTML = `<span class="log-time" style="color: var(--text-dim); font-size: 0.72rem; margin-right: 6px; font-family: var(--font-mono);">${timeStr}</span><span class="log-tag ${type}">${type.toUpperCase()}</span> <span>${escapeHtml(text)}</span>`;
    DOM.sourcesLogList.appendChild(item);
    if (DOM.sourcesLogConsole) {
      DOM.sourcesLogConsole.scrollTop = DOM.sourcesLogConsole.scrollHeight;
    }
  }

  // ===== Toast Notifications =====
  function showToast(message, type = 'success') {
    if (!DOM.toastContainer) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    let icon = 'fa-circle-check';
    if (type === 'error') icon = 'fa-circle-exclamation';
    if (type === 'warning') icon = 'fa-triangle-exclamation';
    if (type === 'info') icon = 'fa-circle-info';

    toast.innerHTML = `
      <i class="fa-solid ${icon} toast-icon"></i>
      <div class="toast-message">${escapeHtml(message)}</div>
      <button class="toast-close" type="button">&times;</button>
    `;

    toast.querySelector('.toast-close').addEventListener('click', () => toast.remove());
    DOM.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(20px)';
      setTimeout(() => toast.remove(), 300);
    }, 4500);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

})();
