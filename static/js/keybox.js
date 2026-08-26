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
    isInitialized = true;
    console.log('Keybox Checker Redesign initialized.');
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
                <span class="pool-status-pill valid"><i class="fa-solid fa-circle-check"></i> VALID</span>
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
    a.download = 'keybox.xml';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Downloading keybox.xml');
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

  // Toast wrapper from app.js if exists, fallback to window.alert
  function showToast(msg, type = 'success') {
    if (window.showToast) {
      window.showToast(msg, type);
    } else {
      console.log(`[Toast ${type}]: ${msg}`);
    }
  }

})();
