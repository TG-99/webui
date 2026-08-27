/**
 * Keybox Checker & Pool Manager - Frontend Controller
 * Handles XML validation, drag-and-drop file reading, attestation rendering,
 * and keybox database pool CRUD actions.
 */

(function () {
  let isInitialized = false;
  let loadedXmlContent = '';
  let activeMethod = 'upload'; // 'upload' or 'paste'

  // Elements cache
  const DOM = {};

  function initDOM() {
    DOM.dropzone = document.getElementById('keybox-dropzone');
    DOM.fileInput = document.getElementById('keybox-file-input');
    DOM.xmlPaste = document.getElementById('keybox-xml-paste');
    DOM.btnReset = document.getElementById('btn-reset-keybox');
    DOM.btnVerify = document.getElementById('btn-verify-keybox');
    DOM.resultContainer = document.getElementById('keybox-result-container');
    DOM.btnRefreshPool = document.getElementById('btn-refresh-pool');
    DOM.poolGridContainer = document.getElementById('pool-grid-container');
    DOM.valPoolCount = document.getElementById('val-pool-count');

    // Redesign elements
    DOM.methodBtns = document.querySelectorAll('.method-btn');
    DOM.methodContainers = document.querySelectorAll('.method-container');
    DOM.selectedFileInfo = document.getElementById('selected-file-info');
    DOM.selectedFileName = document.getElementById('selected-file-name');
    DOM.editorStatus = document.getElementById('xml-editor-status');
    DOM.resultModal = document.getElementById('keybox-result-modal');

    // Scraper elements
    DOM.btnOpenScraperModal = document.getElementById('btn-open-scraper-modal');
    DOM.btnCloseScraperModal = document.getElementById('btn-close-scraper-modal');
    DOM.telegramScraperModal = document.getElementById('telegram-scraper-modal');
    DOM.launcherChannelsBadge = document.getElementById('launcher-channels-badge');
    DOM.scraperAddChannelInput = document.getElementById('scraper-add-channel-input');
    DOM.btnAddScraperChannel = document.getElementById('btn-add-scraper-channel');
    DOM.btnSaveScraperConfig = document.getElementById('btn-save-scraper-config');
    DOM.btnRunKeyboxScraper = document.getElementById('btn-run-keybox-scraper');
    DOM.statChannelsCount = document.getElementById('stat-channels-count');
    DOM.statScrapedFiles = document.getElementById('stat-scraped-files');
    DOM.statValidKeyboxes = document.getElementById('stat-valid-keyboxes');
    DOM.statSavedKeyboxes = document.getElementById('stat-saved-keyboxes');
    DOM.statRevokedInvalid = document.getElementById('stat-revoked-invalid');
    DOM.scraperChannelsGrid = document.getElementById('scraper-channels-grid');
    DOM.channelListCount = document.getElementById('channel-list-count');
    DOM.btnClearScraperLogs = document.getElementById('btn-clear-scraper-logs');
    DOM.scraperLogList = document.getElementById('scraper-log-list');
    DOM.scraperLogConsole = document.getElementById('scraper-log-console');
  }

  // Close results modal
  window.closeKeyboxResultModal = function () {
    if (DOM.resultModal) {
      DOM.resultModal.classList.remove('active');
    }
  };

  // Lazy initializer exposed to global window
  window.initKeyboxChecker = function () {
    if (isInitialized) return;
    initDOM();
    setupEventListeners();
    loadKeyboxPool();
    loadScraperConfig();
    
    // Auto-refresh scraper config & pool every 2 hours (7200000 ms)
    setInterval(() => {
      loadScraperConfig();
      loadKeyboxPool();
    }, 2 * 60 * 60 * 1000);

    isInitialized = true;
    console.log('Keybox Checker Redesign initialized with 2-hour auto-refresh.');
  };

  function setupEventListeners() {
    // 1. Input Method Selector Switcher
    DOM.methodBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const method = btn.getAttribute('data-method');
        switchMethod(method);
      });
    });

    // 2. Drag and drop file listeners
    const dropzone = DOM.dropzone;
    const fileInput = DOM.fileInput;

    dropzone.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        handleFileSelect(e.target.files[0]);
      }
    });

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });

    ['dragleave', 'dragend'].forEach(eventName => {
      dropzone.addEventListener(eventName, () => {
        dropzone.classList.remove('dragover');
      });
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) {
        handleFileSelect(e.dataTransfer.files[0]);
      }
    });

    // 3. Action buttons
    DOM.btnReset.addEventListener('click', resetPortal);
    DOM.btnVerify.addEventListener('click', verifyKeybox);
    DOM.btnRefreshPool.addEventListener('click', loadKeyboxPool);

    if (DOM.btnAddScraperChannel && DOM.scraperAddChannelInput) {
      DOM.btnAddScraperChannel.addEventListener('click', () => {
        addScraperChannel(DOM.scraperAddChannelInput.value);
      });
      DOM.scraperAddChannelInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          addScraperChannel(DOM.scraperAddChannelInput.value);
        }
      });
    }

    document.querySelectorAll('.quick-chip-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const ch = btn.getAttribute('data-channel');
        if (ch) addScraperChannel(ch);
      });
    });

    if (DOM.btnClearScraperLogs && DOM.scraperLogList) {
      DOM.btnClearScraperLogs.addEventListener('click', () => {
        DOM.scraperLogList.innerHTML = '<div class="log-entry info"><span class="log-tag info">INFO</span> Log cleared.</div>';
      });
    }

    if (DOM.btnOpenScraperModal && DOM.telegramScraperModal) {
      DOM.btnOpenScraperModal.addEventListener('click', () => {
        DOM.telegramScraperModal.classList.add('active');
      });
    }

    if (DOM.btnCloseScraperModal && DOM.telegramScraperModal) {
      DOM.btnCloseScraperModal.addEventListener('click', () => {
        DOM.telegramScraperModal.classList.remove('active');
      });
    }

    if (DOM.telegramScraperModal) {
      DOM.telegramScraperModal.addEventListener('click', (e) => {
        if (e.target === DOM.telegramScraperModal) {
          DOM.telegramScraperModal.classList.remove('active');
        }
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (DOM.telegramScraperModal && DOM.telegramScraperModal.classList.contains('active')) {
          DOM.telegramScraperModal.classList.remove('active');
        }
      }
    });

    if (DOM.btnSaveScraperConfig) {
      DOM.btnSaveScraperConfig.addEventListener('click', () => saveScraperConfig(false));
    }
    if (DOM.btnRunKeyboxScraper) {
      DOM.btnRunKeyboxScraper.addEventListener('click', runKeyboxScraper);
    }

    // Watch paste textarea
    DOM.xmlPaste.addEventListener('input', () => {
      loadedXmlContent = DOM.xmlPaste.value;
      if (loadedXmlContent.trim()) {
        DOM.editorStatus.textContent = 'Modified';
        DOM.editorStatus.style.color = 'var(--warning)';
      } else {
        DOM.editorStatus.textContent = 'Ready';
        DOM.editorStatus.style.color = 'var(--text-muted)';
      }
    });

    // Close results modal on backdrop click
    DOM.resultModal.addEventListener('click', (e) => {
      if (e.target === DOM.resultModal) {
        window.closeKeyboxResultModal();
      }
    });
    // 4. Delegation for keybox card actions (Copy, Download, Delete)
    if (DOM.poolGridContainer) {
      DOM.poolGridContainer.addEventListener('click', (e) => {
        const copyEl = e.target.closest('[data-action="copy-serial"]');
        if (copyEl) {
          const serial = copyEl.getAttribute('data-serial');
          if (serial) {
            navigator.clipboard.writeText(serial).then(() => showToast('Serial copied!'));
          }
          return;
        }

        const downloadBtn = e.target.closest('[data-action="download-xml"]');
        if (downloadBtn) {
          const serial = downloadBtn.getAttribute('data-serial');
          if (serial) window.downloadKeyboxXml(serial);
          return;
        }

        const deleteBtn = e.target.closest('[data-action="delete-keybox"]');
        if (deleteBtn) {
          const serial = deleteBtn.getAttribute('data-serial');
          if (serial) window.deleteStoredKeybox(serial);
          return;
        }
      });
    }
  }

  // Switch between Upload and Paste
  function switchMethod(method) {
    activeMethod = method;

    // Toggle switcher buttons
    DOM.methodBtns.forEach(btn => {
      if (btn.getAttribute('data-method') === method) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // Toggle panels
    DOM.methodContainers.forEach(container => {
      const containerId = container.id;
      if (containerId.includes(method)) {
        container.style.display = 'block';
        container.classList.add('active');
      } else {
        container.style.display = 'none';
        container.classList.remove('active');
      }
    });
  }

  // Read XML file
  function handleFileSelect(file) {
    if (!file.name.toLowerCase().endsWith('.xml')) {
      showToast('Please upload an XML keybox file.', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = function (e) {
      const content = e.target.result;
      loadedXmlContent = content;

      // Populate file info label in dropzone
      DOM.selectedFileName.textContent = `${file.name} (${formatBytes(file.size)})`;
      DOM.selectedFileInfo.classList.remove('hidden');

      // Update text field if they switch to editor tab later
      DOM.xmlPaste.value = content;
      DOM.editorStatus.textContent = 'File Loaded';
      DOM.editorStatus.style.color = 'var(--success)';

      showToast(`Loaded file: ${file.name}`);
      
      // Pulse dropzone area on success
      DOM.dropzone.classList.add('dragover');
      setTimeout(() => DOM.dropzone.classList.remove('dragover'), 400);
    };
    reader.readAsText(file);
  }

  // Reset verification UI
  function resetPortal() {
    DOM.xmlPaste.value = '';
    DOM.fileInput.value = '';
    loadedXmlContent = '';
    DOM.selectedFileInfo.classList.add('hidden');
    DOM.selectedFileName.textContent = '';
    DOM.editorStatus.textContent = 'Ready';
    DOM.editorStatus.style.color = 'var(--text-muted)';
    window.closeKeyboxResultModal();
    DOM.resultContainer.innerHTML = '';
    showToast('UI reset successful.');
  }

  // Call API to verify Keybox XML
  async function verifyKeybox() {
    const xml = loadedXmlContent.trim();
    if (!xml) {
      showToast('Please upload a file or paste Keybox XML content.', 'warning');
      return;
    }

    DOM.btnVerify.disabled = true;
    DOM.btnVerify.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Verifying...';

    try {
      const response = await fetch('/api/keybox/check', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ xml_content: xml })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to verify keybox');
      }

      const data = await response.json();
      renderCheckResult(data);
      DOM.resultModal.classList.add('active');

      if (data.success) {
        if (data.saved) {
          showToast('Keybox verified and SAVED to database!', 'success');
        } else {
          showToast('Keybox is valid (already stored).', 'success');
        }
        loadKeyboxPool(); // Refresh database list
      } else {
        showToast('Keybox is INVALID or REVOKED!', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Error occurred during verification.', 'error');
    } finally {
      DOM.btnVerify.disabled = false;
      DOM.btnVerify.innerHTML = '<i class="fa-solid fa-circle-check"></i> Verify Keybox';
    }
  }

  // Render check results in HTML
  function renderCheckResult(data) {
    const res = data.result;
    const container = DOM.resultContainer;
    container.classList.remove('hidden');
    
    // Status banner classification
    let statusClass = 'valid';
    let statusText = 'VALID ATTESATION';
    let statusIcon = 'fa-circle-check';

    if (res.revoked) {
      statusClass = 'revoked';
      statusText = 'REVOKED KEYBOX (BLACKLISTED)';
      statusIcon = 'fa-circle-xmark';
    } else {
      const isOk = res.certValid && res.chainValid && (res.privateKeyMatch !== false);
      if (!isOk) {
        statusClass = 'invalid';
        statusText = 'INVALID ATTESATION KEY';
        statusIcon = 'fa-triangle-exclamation';
      } else if (res.rootType === 'unknown' || res.rootType.startsWith('aosp')) {
        statusClass = 'warning';
        statusText = 'VALID CHAIN (AOSP ROOT / TEST CERT)';
        statusIcon = 'fa-triangle-exclamation';
      }
    }

    // Translate Root labels
    const rootLabels = {
      google: 'Google Attestation Root (Hardware)',
      aosp_ec: 'AOSP EC Root (Software)',
      aosp_rsa: 'AOSP RSA Root (Software)',
      knox: 'Samsung Knox Root',
      unknown: 'Unknown/Custom Root CA'
    };

    const rootName = rootLabels[res.rootType] || 'Unknown';

    let html = `
      <div class="result-status-banner ${statusClass}">
        <i class="fa-solid ${statusIcon}"></i>
        <span>${statusText}</span>
      </div>

      <div class="result-details-grid">
        <div class="result-detail-item">
          <div class="label">Device ID</div>
          <div class="value">${escapeHtml(res.deviceId)}</div>
        </div>
        <div class="result-detail-item">
          <div class="label">Algorithm</div>
          <div class="value">${escapeHtml(res.algorithm)}</div>
        </div>
        <div class="result-detail-item">
          <div class="label">Serial Number</div>
          <div class="value code">${escapeHtml(res.serialNumber)}</div>
        </div>
        <div class="result-detail-item">
          <div class="label">Root CA</div>
          <div class="value">${rootName}</div>
        </div>
        <div class="result-detail-item">
          <div class="label">Uptime Status</div>
          <div class="value">${res.certValid ? '✅ Active (Within validity)' : '❌ Inactive (Expired/Invalid)'}</div>
        </div>
        <div class="result-detail-item">
          <div class="label">Google Revocation</div>
          <div class="value">${res.revoked ? `❌ Blacklisted (${escapeHtml(res.revokeReason)})` : '✅ Safe (Not Revoked)'}</div>
        </div>
        <div class="result-detail-item">
          <div class="label">Private Key Match</div>
          <div class="value">${res.privateKeyMatch === true ? '✅ Match' : res.privateKeyMatch === false ? '❌ Mismatch / Invalid' : '⚠️ Missing Private Key'}</div>
        </div>
        <div class="result-detail-item">
          <div class="label">Verification Time</div>
          <div class="value">${res.checkTime} UTC</div>
        </div>
      </div>

      <div class="panel-header" style="margin-top: 20px; margin-bottom: 10px; padding-bottom: 8px;">
        <h3 style="font-size: 14px; text-transform: uppercase; color: var(--text-muted); font-weight: 700; letter-spacing: 0.05em;">Certificate Chain Info</h3>
      </div>
      <div class="cert-chain-timeline">
    `;

    // Render timeline nodes
    res.certInfos.forEach((info) => {
      const levelLabel = info.level === 0 ? 'Leaf' : info.level === res.certCount - 1 ? 'Root' : `Intermediate ${info.level}`;
      const levelClass = info.level === 0 ? 'leaf' : info.level === res.certCount - 1 ? 'root' : 'intermediate';
      const validityClass = info.isValid ? 'valid' : 'invalid';

      html += `
        <div class="cert-chain-card ${validityClass}">
          <div class="cert-chain-header">
            <h4>Level ${info.level} - ${rootLabels[info.subject] || escapeHtml(info.subject.split('CN=')[1] || info.subject.split(',')[0] || info.subject)}</h4>
            <span class="cert-chain-badge ${levelClass}">${levelLabel}</span>
          </div>
          <div class="cert-chain-body">
            <div class="serial"><span>Serial:</span> <code>${info.serialNumber}</code></div>
            <div><span>Issuer:</span> ${escapeHtml(info.issuer.split('CN=')[1] || info.issuer.split(',')[0] || info.issuer)}</div>
            <div><span>Validity:</span> ${info.notBefore} to ${info.notAfter} (${info.isValid ? 'Active' : 'Expired/Invalid'})</div>
          </div>
        </div>
      `;
    });

    html += `</div>`;
    container.innerHTML = html;
  }

  // Load stored Keyboxes from Database using DocumentFragment batching
  async function loadKeyboxPool() {
    if (!DOM.poolGridContainer) return;

    DOM.btnRefreshPool.disabled = true;
    DOM.btnRefreshPool.querySelector('i').classList.add('fa-spin');

    try {
      const response = await fetch('/api/keyboxes');
      if (!response.ok) throw new Error('Failed to load keybox pool');

      const data = await response.json();
      DOM.valPoolCount.textContent = data.length;

      DOM.poolGridContainer.innerHTML = '';

      if (data.length === 0) {
        DOM.poolGridContainer.innerHTML = `
          <div class="empty-pool-container">
            <i class="fa-solid fa-folder-open empty-pool-icon"></i>
            <h3>No stored keyboxes</h3>
            <p>Verify a valid keybox to automatically add it to the active synchronization pool.</p>
          </div>
        `;
        return;
      }

      const fragment = document.createDocumentFragment();

      data.forEach((kb) => {
        const card = document.createElement('div');
        card.className = 'keybox-pool-card glass-panel';
        card.id = `kb-card-${kb.serial_number}`;

        // Format root badge class and label
        let rootClass = 'unknown';
        let rootLabel = 'Unknown CA';
        if (kb.root_type === 'google') {
          rootClass = 'google';
          rootLabel = 'Google Root';
        } else if (kb.root_type.startsWith('aosp')) {
          rootClass = 'aosp';
          rootLabel = 'AOSP Root';
        } else if (kb.root_type === 'knox') {
          rootClass = 'knox';
          rootLabel = 'Samsung Knox';
        }

        // Format dates
        const lastCheckedDate = new Date(kb.last_checked_at || kb.created_at).toLocaleString();
        
        let statusBadge = `<span class="pool-status-pill valid"><i class="fa-solid fa-circle-check"></i> VALID</span>`;
        if (kb.status === 'REVOKED') {
          statusBadge = `<span class="pool-status-pill revoked" style="background: rgba(255, 71, 87, 0.15); color: #ff4757; padding: 2px 8px; border-radius: 12px; font-size: 0.75rem; border: 1px solid rgba(255, 71, 87, 0.3); font-weight: 600;"><i class="fa-solid fa-circle-xmark"></i> REVOKED</span>`;
        } else if (kb.status === 'INVALID') {
          statusBadge = `<span class="pool-status-pill invalid" style="background: rgba(255, 165, 0, 0.15); color: #ffa500; padding: 2px 8px; border-radius: 12px; font-size: 0.75rem; border: 1px solid rgba(255, 165, 0, 0.3); font-weight: 600;"><i class="fa-solid fa-triangle-exclamation"></i> INVALID</span>`;
        }
        
        card.innerHTML = `
          <div class="card-top">
            <div class="card-icon-wrap">
              <i class="fa-solid fa-key"></i>
            </div>
            <div class="card-meta-info">
              <h4 class="card-device-id" title="Click to copy full serial" data-action="copy-serial" data-serial="${escapeHtml(kb.serial_number)}">${escapeHtml(kb.serial_number)}</h4>
              <div class="card-badges-wrap" style="display: flex; gap: 6px; align-items: center; margin-top: 2px;">
                <span class="pool-badge ${rootClass}">${rootLabel}</span>
                <span class="pool-badge algorithm">${escapeHtml(kb.algorithm.toUpperCase())}</span>
                ${statusBadge}
              </div>
            </div>
          </div>
          <div class="card-bottom" style="margin-top: 4px;">
            <span class="card-added-time" title="Last checked date & time"><i class="fa-regular fa-clock"></i> Last checked: ${lastCheckedDate}</span>
            <div class="card-action-btns">
              <button class="card-action-btn download-btn" title="Download keybox.xml" data-action="download-xml" data-serial="${escapeHtml(kb.serial_number)}">
                <i class="fa-solid fa-arrow-down-to-bracket"></i> keybox.xml
              </button>
              <button class="card-action-btn delete-btn" title="Delete from database" data-action="delete-keybox" data-serial="${escapeHtml(kb.serial_number)}">
                <i class="fa-solid fa-trash-can"></i>
              </button>
            </div>
          </div>
        `;

        // Attach xml data on card
        card.setAttribute('data-xml', kb.xml_content);
        fragment.appendChild(card);
      });

      DOM.poolGridContainer.appendChild(fragment);
    } catch (err) {
      console.error(err);
      showToast('Error syncing keybox pool.', 'error');
    } finally {
      DOM.btnRefreshPool.disabled = false;
      DOM.btnRefreshPool.querySelector('i').classList.remove('fa-spin');
    }
  }

  // Download keybox.xml from local table state
  window.downloadKeyboxXml = function (serialNumber) {
    const card = document.getElementById(`kb-card-${serialNumber}`);
    if (!card) return;

    const xml = card.getAttribute('data-xml');
    if (!xml) return;

    const blob = new Blob([xml], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `keybox_${serialNumber}.xml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`Downloading keybox_${serialNumber}.xml`);
  };

  // Delete keybox from database
  window.deleteStoredKeybox = async function (serialNumber) {
    if (!confirm('Are you absolutely sure you want to delete this keybox from the database? This cannot be undone.')) {
      return;
    }

    try {
      const response = await fetch(`/api/keyboxes/${serialNumber}`, {
        method: 'DELETE'
      });

      if (!response.ok) throw new Error('Deletion request failed');

      showToast('Keybox deleted from database.', 'success');
      loadKeyboxPool(); // Reload pool
    } catch (err) {
      console.error(err);
      showToast('Error deleting keybox.', 'error');
    }
  };

  // Format bytes helper
  function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  // HTML sanitization helper
  function escapeHtml(text) {
    if (!text) return '';
    return text
      .toString()
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ============================================================
  // Telegram Keybox Scraper Multi-Channel & Live Counter Controller
  // ============================================================
  let scraperChannels = []; // Array of { handle: string, stats: { scraped_files: 0, valid_found: 0, saved_to_db: 0, revoked_or_invalid: 0 }, status: 'idle' }

  function normalizeChannelName(raw) {
    let clean = (raw || '').trim();
    if (!clean) return '';
    if (clean.startsWith('https://t.me/')) clean = clean.replace('https://t.me/', '');
    if (clean.startsWith('t.me/')) clean = clean.replace('t.me/', '');
    if (!clean.startsWith('@') && !clean.startsWith('+')) clean = '@' + clean;
    return clean;
  }

  function renderScraperChannels() {
    const grid = DOM.scraperChannelsGrid || document.getElementById('scraper-channels-grid');
    const countEl = DOM.channelListCount || document.getElementById('channel-list-count');
    const statChannelsCount = DOM.statChannelsCount || document.getElementById('stat-channels-count');

    if (countEl) countEl.textContent = scraperChannels.length;
    if (statChannelsCount) statChannelsCount.textContent = scraperChannels.length;
    if (DOM.launcherChannelsBadge) DOM.launcherChannelsBadge.textContent = scraperChannels.length;

    if (!grid) return;

    if (scraperChannels.length === 0) {
      grid.innerHTML = `
        <div class="channel-empty-state">
          <i class="fa-solid fa-tower-cell" style="font-size: 1.8rem; margin-bottom: 8px; opacity: 0.4;"></i>
          <div style="font-weight: 600;">No Telegram channels added yet</div>
          <div style="font-size: 0.78rem; opacity: 0.7; margin-top: 4px;">Enter a handle above (e.g. <code>@blacktapecollection</code>) or click a quick preset button to add channels.</div>
        </div>
      `;
      return;
    }

    grid.innerHTML = scraperChannels.map((item, index) => {
      const handle = item.handle;
      const stats = item.stats || { scraped_files: 0, valid_found: 0, saved_to_db: 0, revoked_or_invalid: 0 };
      const status = item.status || 'idle';
      const statusBadgeMap = {
        idle: '<span class="channel-status-badge">Idle</span>',
        scraping: '<span class="channel-status-badge scraping"><i class="fa-solid fa-spinner fa-spin"></i> Scraping</span>',
        completed: '<span class="channel-status-badge completed">Ready</span>',
        error: '<span class="channel-status-badge error">Error</span>'
      };

      const tmeUrl = handle.startsWith('@') ? `https://t.me/${handle.substring(1)}` : '#';

      return `
        <div class="channel-card ${status === 'scraping' ? 'is-scraping' : ''}" data-index="${index}" data-handle="${escapeHtml(handle)}">
          <div class="channel-card-header">
            <div class="channel-handle-wrap">
              <div class="channel-icon">
                <i class="fa-brands fa-telegram"></i>
              </div>
              <div>
                <a href="${tmeUrl}" target="_blank" rel="noopener noreferrer" class="channel-handle">${escapeHtml(handle)}</a>
              </div>
            </div>
            <div class="channel-actions">
              ${statusBadgeMap[status] || statusBadgeMap.idle}
              <button class="btn-icon-scrape" type="button" title="Scrape this channel" onclick="window.scrapeSingleChannel('${escapeHtml(handle)}')">
                <i class="fa-solid fa-bolt"></i>
              </button>
              <button class="btn-icon-subtle" type="button" title="Remove channel" onclick="window.removeScraperChannel(${index})">
                <i class="fa-solid fa-trash-can"></i>
              </button>
            </div>
          </div>
          
          <div class="channel-counters-grid">
            <div class="counter-box">
              <span class="counter-val">${stats.scraped_files || 0}</span>
              <span class="counter-lbl">XMLs</span>
            </div>
            <div class="counter-box">
              <span class="counter-val valid">${stats.valid_found || 0}</span>
              <span class="counter-lbl">Valid</span>
            </div>
            <div class="counter-box">
              <span class="counter-val saved">${stats.saved_to_db || 0}</span>
              <span class="counter-lbl">Saved</span>
            </div>
            <div class="counter-box">
              <span class="counter-val revoked">${stats.revoked_or_invalid || 0}</span>
              <span class="counter-lbl">Revoked</span>
            </div>
          </div>

          <div class="channel-limit-bar">
            <div style="display: flex; align-items: center; gap: 4px;">
              <i class="fa-solid fa-list-ol" style="color: #0088cc;"></i>
              <span>Limit:</span>
              <input type="number" class="channel-limit-input" data-index="${index}" value="${item.limit || 50}" min="1" max="5000" step="10"
                onchange="window.updateChannelLimit(${index}, this.value)"
                onkeyup="window.updateChannelLimit(${index}, this.value)" />
              <span style="opacity: 0.7; font-size: 0.7rem;">msgs</span>
            </div>

            <div style="display: flex; align-items: center; gap: 4px; border-left: 1px solid rgba(255,255,255,0.1); padding-left: 8px;">
              <i class="fa-solid fa-clock" style="color: #0088cc;"></i>
              <span>Interval:</span>
              <input type="number" class="channel-limit-input" data-index="${index}" value="${item.interval || 2}" min="0.5" max="168" step="0.5"
                onchange="window.updateChannelInterval(${index}, this.value)"
                onkeyup="window.updateChannelInterval(${index}, this.value)" style="width: 50px;" />
              <span style="opacity: 0.7; font-size: 0.7rem;">hrs</span>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  window.updateChannelLimit = function(index, val) {
    const lim = parseInt(val, 10);
    if (index >= 0 && index < scraperChannels.length && !isNaN(lim) && lim > 0) {
      scraperChannels[index].limit = lim;
      saveScraperConfig(true);
    }
  };

  window.updateChannelInterval = function(index, val) {
    const inv = parseFloat(val);
    if (index >= 0 && index < scraperChannels.length && !isNaN(inv) && inv > 0) {
      scraperChannels[index].interval = inv;
      saveScraperConfig(true);
    }
  };

  function addScraperChannel(handleRaw) {
    if (!handleRaw) return;
    const rawList = handleRaw.split(',').map(s => s.trim()).filter(Boolean);
    let added = 0;
    for (const raw of rawList) {
      let clean = raw;
      let limit = 50;
      if (raw.includes(':') && !raw.startsWith('http')) {
        const parts = raw.split(':');
        clean = parts[0];
        if (!isNaN(parseInt(parts[1]))) limit = parseInt(parts[1]);
      }
      clean = normalizeChannelName(clean);
      if (!clean) continue;
      if (!scraperChannels.some(ch => ch.handle.toLowerCase() === clean.toLowerCase())) {
        scraperChannels.push({
          handle: clean,
          limit: limit,
          interval: 2,
          stats: { scraped_files: 0, valid_found: 0, saved_to_db: 0, revoked_or_invalid: 0 },
          status: 'idle'
        });
        added++;
      }
    }
    if (added > 0) {
      renderScraperChannels();
      if (DOM.scraperAddChannelInput) DOM.scraperAddChannelInput.value = '';
      saveScraperConfig(true);
      showToast(`Added ${added} Telegram channel(s).`, 'info');
    } else {
      showToast('Channel already exists or invalid handle.', 'warning');
    }
  }

  function renderScraperLogs(details) {
    if (!DOM.scraperLogList || !Array.isArray(details) || details.length === 0) return;

    const html = details.map(item => {
      let type = 'info';
      let text = '';
      if (typeof item === 'object' && item !== null) {
        type = item.type || 'info';
        text = item.text || '';
      } else {
        text = String(item || '');
        if (text.includes('VALID')) type = 'valid';
        else if (text.includes('REVOKED') || text.includes('Revoked')) type = 'revoked';
        else if (text.includes('INVALID') || text.includes('Invalid')) type = 'invalid';
        else if (text.includes('Error') || text.includes('error') || text.includes('failed')) type = 'error';
      }

      const tagLabel = type.toUpperCase();
      return `<div class="log-entry ${type}"><span class="log-tag ${type}">${tagLabel}</span>${escapeHtml(text)}</div>`;
    }).join('');

    DOM.scraperLogList.innerHTML = html;
    if (DOM.scraperLogConsole) {
      DOM.scraperLogConsole.scrollTop = DOM.scraperLogConsole.scrollHeight;
    }
  }

  window.removeScraperChannel = function(index) {
    if (index >= 0 && index < scraperChannels.length) {
      const removed = scraperChannels.splice(index, 1);
      renderScraperChannels();
      saveScraperConfig(true);
      showToast(`Removed ${removed[0]?.handle || 'channel'}.`, 'info');
    }
  };

  window.scrapeSingleChannel = async function(handle) {
    const item = scraperChannels.find(c => c.handle.toLowerCase() === handle.toLowerCase());
    if (item) item.status = 'scraping';
    renderScraperChannels();

    const chanLimit = item ? (item.limit || 50) : 50;

    try {
      showToast(`Scraping ${handle} (limit: ${chanLimit})...`, 'info');
      const res = await fetch('/api/keybox/scraper/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channels: [{ handle: handle, limit: chanLimit }],
          limit_per_channel: chanLimit
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.detail || 'Scraping failed');

      if (data.results && data.results.by_channel && data.results.by_channel[handle]) {
        if (item) {
          item.stats = data.results.by_channel[handle];
          item.status = item.stats.status === 'error' ? 'error' : 'completed';
        }
      } else if (item) {
        item.status = 'completed';
      }

      updateSummaryStats(data.results);
      renderScraperChannels();
      loadKeyboxPool();

      if (data.results && data.results.details) {
        renderScraperLogs(data.results.details);
      }

      const saved = (data.results && data.results.saved_to_db) || 0;
      const valid = (data.results && data.results.valid_found) || 0;
      if (saved > 0) {
        showToast(`${handle}: Found & saved ${saved} NEW keybox(es)!`, 'success');
      } else if (valid > 0) {
        showToast(`${handle}: Found ${valid} valid keybox(es).`, 'info');
      } else {
        showToast(`${handle}: No valid keyboxes found.`, 'warning');
      }
    } catch (e) {
      if (item) item.status = 'error';
      renderScraperChannels();
      showToast(`Scrape failed for ${handle}: ${e.message}`, 'error');
    }
  };

  async function loadScraperConfig() {
    try {
      const res = await fetch('/api/keybox/scraper/config');
      if (!res.ok) return;
      const data = await res.json();

      const channelsList = data.channels || [{ handle: '@blacktapecollection', limit: 50 }];
      const channelStats = data.channel_stats || (data.last_results && data.last_results.by_channel) || {};

      scraperChannels = channelsList.map(ch => {
        let handle = typeof ch === 'object' && ch.handle ? ch.handle : (typeof ch === 'string' ? ch : '');
        let limit = typeof ch === 'object' && ch.limit ? parseInt(ch.limit) : 50;
        let interval = typeof ch === 'object' && ch.interval ? parseFloat(ch.interval) : 2;
        const clean = normalizeChannelName(handle);
        const st = channelStats[clean] || channelStats[handle] || { scraped_files: 0, valid_found: 0, saved_to_db: 0, revoked_or_invalid: 0 };
        return {
          handle: clean,
          limit: limit || 50,
          interval: interval || 2,
          stats: st,
          status: 'idle'
        };
      });

      renderScraperChannels();

      if (data.last_results) {
        updateSummaryStats(data.last_results);
        if (data.last_results.details) {
          renderScraperLogs(data.last_results.details);
        }
      }
    } catch (e) {
      console.warn('Could not load scraper config:', e);
    }
  }

  async function saveScraperConfig(silent = false) {
    const channels = scraperChannels.map(c => ({
      handle: c.handle,
      limit: c.limit || 50,
      interval: c.interval || 2
    }));
    try {
      const res = await fetch('/api/keybox/scraper/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channels })
      });
      if (!res.ok) throw new Error('Failed to save config');
      if (!silent) showToast(`Saved ${channels.length} Telegram channel(s) configuration.`, 'success');
    } catch (e) {
      if (!silent) showToast('Failed to save channel config.', 'error');
    }
  }

  async function runKeyboxScraper() {
    if (scraperChannels.length === 0) {
      showToast('Please add at least one Telegram channel to scrape.', 'warning');
      return;
    }

    if (DOM.btnRunKeyboxScraper) {
      DOM.btnRunKeyboxScraper.disabled = true;
      DOM.btnRunKeyboxScraper.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Scraping All...';
    }

    scraperChannels.forEach(item => item.status = 'scraping');
    renderScraperChannels();

    const channels = scraperChannels.map(c => ({
      handle: c.handle,
      limit: c.limit || 50,
      interval: c.interval || 2
    }));

    try {
      showToast(`Starting Telegram Keybox Scraper for ${channels.length} channel(s)...`, 'info');
      const res = await fetch('/api/keybox/scraper/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channels })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.detail || 'Scraping failed');
      }

      const results = data.results || {};
      const byChannel = results.by_channel || {};

      scraperChannels.forEach(item => {
        const handle = item.handle;
        if (byChannel[handle]) {
          item.stats = byChannel[handle];
          item.status = item.stats.status === 'error' ? 'error' : 'completed';
        } else {
          item.status = 'completed';
        }
      });

      updateSummaryStats(results);
      renderScraperChannels();
      loadKeyboxPool();

      if (results.details) {
        renderScraperLogs(results.details);
      }

      const saved = results.saved_to_db || 0;
      const valid = results.valid_found || 0;
      if (saved > 0) {
        showToast(`Scrape Complete! Added ${saved} NEW valid keyboxes to DB pool.`, 'success');
      } else if (valid > 0) {
        showToast(`Scrape Complete! Found ${valid} valid keyboxes (already in pool).`, 'success');
      } else {
        showToast(`Scrape Complete! No valid keyboxes found in scanned messages.`, 'warning');
      }

    } catch (e) {
      console.error(e);
      scraperChannels.forEach(item => item.status = 'error');
      renderScraperChannels();
      showToast(`Scraper error: ${e.message}`, 'error');
    } finally {
      if (DOM.btnRunKeyboxScraper) {
        DOM.btnRunKeyboxScraper.disabled = false;
        DOM.btnRunKeyboxScraper.innerHTML = '<i class="fa-solid fa-bolt"></i> Scrape All Channels';
      }
    }
  }

  function updateSummaryStats(results) {
    if (!results) return;
    if (DOM.statScrapedFiles) DOM.statScrapedFiles.textContent = results.scraped_files || 0;
    if (DOM.statValidKeyboxes) DOM.statValidKeyboxes.textContent = results.valid_found || 0;
    if (DOM.statSavedKeyboxes) DOM.statSavedKeyboxes.textContent = results.saved_to_db || 0;
    if (DOM.statRevokedInvalid) DOM.statRevokedInvalid.textContent = results.revoked_or_invalid || 0;
  }

})();
