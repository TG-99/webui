/**
 * Keep-Alive Manager - Frontend Core Logic
 * Handles REST APIs, custom SVG sparklines, toast notifications, and UI state.
 */

// Global State
let appTargets = [];
let appStats = {};
let currentFilter = 'all';
let editMode = false;
let pollingInterval = null;

// Cached DOM references (populated on DOMContentLoaded)
const DOM = {};

// ===== Global Theme Management =====
function initGlobalTheme() {
  const saved = localStorage.getItem('alive-theme') || 'system';
  applyGlobalTheme(saved);

  // Bind click events to theme toggle buttons
  document.querySelectorAll('.theme-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const theme = btn.getAttribute('data-theme');
      applyGlobalTheme(theme);
    });
  });

  // Listen for OS preference changes when in system mode
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if ((localStorage.getItem('alive-theme') || 'system') === 'system') {
      applyGlobalTheme('system');
    }
  });
}

function applyGlobalTheme(theme) {
  const root = document.documentElement;
  localStorage.setItem('alive-theme', theme);

  // Clear previous theme classes
  root.classList.remove('light-theme', 'dark-theme');

  if (theme === 'light') {
    root.classList.add('light-theme');
  } else if (theme === 'dark') {
    root.classList.add('dark-theme');
  }
  // 'system' = no class, CSS @media handles it

  // Update active button state on global header switchers
  document.querySelectorAll('.theme-toggle-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-theme') === theme);
  });
}

// Expose globally
window.applyGlobalTheme = applyGlobalTheme;

// Initialize when DOM content is loaded
document.addEventListener('DOMContentLoaded', () => {
  // Cache frequently accessed DOM elements
  DOM.toastContainer = document.getElementById('toast-container');
  DOM.targetsGrid = document.getElementById('targets-grid');
  DOM.emptyState = document.getElementById('empty-state');
  DOM.valTotal = document.getElementById('val-total');
  DOM.valActive = document.getElementById('val-active');
  DOM.valAvgTime = document.getElementById('val-avg-time');
  DOM.valUptime = document.getElementById('val-uptime');
  DOM.targetModal = document.getElementById('target-modal');
  DOM.modalTitle = document.getElementById('modal-title');
  DOM.targetForm = document.getElementById('target-form');
  DOM.editId = document.getElementById('edit-id');
  DOM.targetName = document.getElementById('target-name');
  DOM.targetUrl = document.getElementById('target-url');
  DOM.targetInterval = document.getElementById('target-interval');
  DOM.intervalBubble = document.getElementById('interval-bubble');
  DOM.targetOrder = document.getElementById('target-order');

  // Initialize theme system
  initGlobalTheme();

  // Initial fetch of dashboard details
  loadDashboardData();

  // Set up auto-refresh polling every 30 seconds
  pollingInterval = setInterval(loadDashboardData, 30000);

  // Tab switching handler
  const tabs = document.querySelectorAll('.tab-btn');
  const aliveTabContent = document.getElementById('alive-tab-content');
  const dbTabContent = document.getElementById('db-tab-content');
  const keyboxTabContent = document.getElementById('keybox-tab-content');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetTab = tab.getAttribute('data-tab');
      
      // Persist active tab selection to localStorage
      localStorage.setItem('activeTab', targetTab);
      
      // Update active classes on tab buttons
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      if (targetTab === 'alive') {
        aliveTabContent.style.display = 'block';
        dbTabContent.style.display = 'none';
        keyboxTabContent.style.display = 'none';
        
        // Resume keep-alive polling if stopped
        if (!pollingInterval) {
          loadDashboardData();
          pollingInterval = setInterval(loadDashboardData, 30000);
        }
      } else if (targetTab === 'db') {
        aliveTabContent.style.display = 'none';
        dbTabContent.style.display = 'block';
        keyboxTabContent.style.display = 'none';
        
        // Pause keep-alive polling to save resources
        if (pollingInterval) {
          clearInterval(pollingInterval);
          pollingInterval = null;
        }

        // Lazy initialize the DB Explorer IIFE if not already initialized
        if (window.initDbExplorer) {
          window.initDbExplorer();
        }
      } else if (targetTab === 'keybox') {
        aliveTabContent.style.display = 'none';
        dbTabContent.style.display = 'none';
        keyboxTabContent.style.display = 'block';

        // Pause keep-alive polling to save resources
        if (pollingInterval) {
          clearInterval(pollingInterval);
          pollingInterval = null;
        }

        // Lazy initialize the Keybox Checker if not already initialized
        if (window.initKeyboxChecker) {
          window.initKeyboxChecker();
        }
      }
    });
  });

  // Load persisted active tab on page refresh
  const activeTab = localStorage.getItem('activeTab') || 'alive';
  if (activeTab !== 'alive') {
    const tabToClick = document.querySelector(`.tab-btn[data-tab="${activeTab}"]`);
    if (tabToClick) tabToClick.click();
  }
});

// Toast notification function
function showToast(message, type = 'success') {
  const container = DOM.toastContainer;
  if (!container) return;

  // Create toast element
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  let iconClass = 'fa-circle-check';
  if (type === 'error') iconClass = 'fa-circle-exclamation';
  if (type === 'warning') iconClass = 'fa-triangle-exclamation';

  toast.innerHTML = `
        <i class="fa-solid ${iconClass} toast-icon"></i>
        <div class="toast-message">${message}</div>
        <button class="toast-close" onclick="dismissToast(this)">&times;</button>
    `;

  container.appendChild(toast);

  // Auto remove after 4.5 seconds
  setTimeout(() => {
    toast.classList.add('slideOut');
    toast.addEventListener('animationend', () => {
      toast.remove();
    });
  }, 4500);
}

function dismissToast(button) {
  const toast = button.closest('.toast');
  toast.classList.add('slideOut');
  toast.addEventListener('animationend', () => {
    toast.remove();
  });
}

// Fetch stats & targets from APIs
async function loadDashboardData() {
  try {
    await Promise.all([
      fetchTargets(),
      fetchStats()
    ]);

    renderStats();
    renderTargetsGrid();
  } catch (err) {
    console.error('Error loading dashboard:', err);
    showToast('Error syncing dashboard metrics.', 'error');
  }
}

async function fetchTargets() {
  const response = await fetch('/api/targets');
  if (!response.ok) throw new Error('Failed to load targets');
  appTargets = await response.json();
}

async function fetchStats() {
  const response = await fetch('/api/stats');
  if (!response.ok) throw new Error('Failed to load system stats');
  appStats = await response.json();
}

// Render Global Stats
function renderStats() {
  DOM.valTotal.textContent = appStats.total_targets || 0;
  DOM.valActive.textContent = appStats.active_targets || 0;
  DOM.valAvgTime.innerHTML = `${appStats.avg_response_time_ms || 0} <span class="unit">ms</span>`;
  DOM.valUptime.innerHTML = `${appStats.uptime_percentage !== undefined ? appStats.uptime_percentage : 100}<span class="unit">%</span>`;
}

// Render monitored applications grid using DocumentFragment for batch DOM insertion
function renderTargetsGrid() {
  const grid = DOM.targetsGrid;
  const emptyState = DOM.emptyState;

  // Filter targets based on selection
  const filtered = appTargets.filter(target => {
    if (currentFilter === 'active') return target.active === 1;
    if (currentFilter === 'inactive') return target.active === 0;
    return true;
  });

  // Clear previous cards (except empty state)
  const cards = grid.querySelectorAll('.target-card');
  cards.forEach(card => card.remove());

  if (appTargets.length === 0) {
    emptyState.style.display = 'flex';
    return;
  } else {
    emptyState.style.display = 'none';
  }

  if (filtered.length === 0) {
    grid.insertAdjacentHTML('beforeend', `
            <div class="empty-state-container glass-panel target-card" style="grid-column: 1 / -1; padding: 3rem;">
                <i class="fa-solid fa-filter empty-signal" style="font-size: 1.8rem; margin-bottom: 0.5rem;"></i>
                <h3>No apps match filter</h3>
                <p>Try changing the filter options above to view paused or active targets.</p>
            </div>
        `);
    return;
  }

  // Build all cards in a DocumentFragment to minimize reflows
  const fragment = document.createDocumentFragment();
  const sparklineIds = [];
  filtered.forEach(target => {
    fragment.appendChild(createTargetCardElement(target, filtered));
    sparklineIds.push(target.id);
  });
  grid.appendChild(fragment);

  // Fetch sparkline data after DOM is stable
  sparklineIds.forEach(id => fetchLogsAndRenderSparkline(id));
}

// Construct target card element DOM
function createTargetCardElement(target, filtered) {
  const card = document.createElement('div');
  card.id = `target-${target.id}`;

  const filteredIndex = filtered.findIndex(t => t.id === target.id);
  const isFirst = filteredIndex === 0;
  const isLast = filteredIndex === filtered.length - 1;
  const targetIndex = appTargets.findIndex(t => t.id === target.id) + 1;

  // Set theme CSS custom properties based on status
  let themeColor = 'var(--primary)';
  let themeGlow = 'rgba(0, 122, 255, 0.2)';
  let statusClass = 'pending';
  let statusText = 'Pending';

  if (target.active === 0) {
    card.className = 'target-card glass-panel paused';
    statusClass = 'paused-badge';
    statusText = 'Paused';
    themeColor = 'hsl(220, 15%, 50%)';
    themeGlow = 'rgba(255, 255, 255, 0.05)';
  } else {
    card.className = 'target-card glass-panel';
    if (target.status === 'UP') {
      statusClass = 'up';
      statusText = 'UP';
      themeColor = 'var(--success)';
      themeGlow = 'rgba(16, 185, 129, 0.25)';
    } else if (target.status === 'DOWN') {
      statusClass = 'down';
      statusText = 'DOWN';
      themeColor = 'var(--danger)';
      themeGlow = 'rgba(239, 68, 68, 0.25)';
    }
  }

  card.style.setProperty('--card-theme-color', themeColor);
  card.style.setProperty('--card-theme-glow', themeGlow);

  // Formatting times
  const lastPing = target.last_pinged_at ? formatTime(target.last_pinged_at) : 'Never';
  const nextPing = calculateNextPing(target.last_pinged_at, target.interval, target.active);

  card.innerHTML = `
        <div class="card-header">
            <div class="target-title-wrap">
                <h3 title="${target.name}">
                    <span class="card-order-badge">#${targetIndex}</span>${target.name}
                </h3>
                <a href="${target.url}" target="_blank" rel="noopener noreferrer" class="target-url-link" title="Open App in New Tab">
                    ${cleanURLDisplay(target.url)} <i class="fa-solid fa-arrow-up-right-from-square" style="font-size: 0.65rem;"></i>
                </a>
            </div>
            <span class="card-status-badge ${statusClass}">${statusText}</span>
        </div>
        
        <div class="card-stats-grid">
            <div class="card-stat-item">
                <span class="card-stat-label">Interval</span>
                <span class="card-stat-value">${target.interval}m</span>
            </div>
            <div class="card-stat-item">
                <span class="card-stat-label">Latency</span>
                <span class="card-stat-value">${target.last_response_time !== null ? target.last_response_time + ' ms' : 'N/A'}</span>
            </div>
            <div class="card-stat-item">
                <span class="card-stat-label">Last Checked</span>
                <span class="card-stat-value">${lastPing}</span>
            </div>
            <div class="card-stat-item">
                <span class="card-stat-label">Next Scheduled</span>
                <span class="card-stat-value" id="next-ping-${target.id}">${nextPing}</span>
            </div>
        </div>
        
        <!-- Interactive Custom SVG Sparkline Graph -->
        <div class="sparkline-container" id="sparkline-container-${target.id}">
            <div class="sparkline-title">Ping Performance</div>
            <div class="sparkline-hover-info" id="sparkline-hover-${target.id}"></div>
            <svg class="sparkline-svg" id="sparkline-svg-${target.id}" viewBox="0 0 300 50" preserveAspectRatio="none">
                <!-- SVG elements will be programmatically injected here -->
            </svg>
        </div>
        
        <div class="card-actions-footer">
            <label class="switch-control" title="Toggle Keep-Alive schedule">
                <div class="switch">
                    <input type="checkbox" id="active-toggle-${target.id}" ${target.active === 1 ? 'checked' : ''} onchange="toggleTarget('${target.id}', this.checked)">
                    <span class="slider"></span>
                </div>
                <span>${target.active === 1 ? 'Active' : 'Paused'}</span>
            </label>
            
            <div class="card-control-btns">
                <button class="action-icon-btn reorder-btn" onclick="moveTarget('${target.id}', 'up')" title="Move Up" ${isFirst ? 'disabled' : ''}>
                    <i class="fa-solid fa-chevron-up"></i>
                </button>
                <button class="action-icon-btn reorder-btn" onclick="moveTarget('${target.id}', 'down')" title="Move Down" ${isLast ? 'disabled' : ''}>
                    <i class="fa-solid fa-chevron-down"></i>
                </button>
                <button class="action-icon-btn ping-btn" onclick="triggerManualPing('${target.id}', this)" title="Trigger Instant Ping Check" ${target.active === 0 ? 'disabled' : ''}>
                    <i class="fa-solid fa-bolt"></i>
                </button>
                <button class="action-icon-btn edit-btn" onclick="openEditModal('${target.id}')" title="Edit App Settings">
                    <i class="fa-solid fa-pen-to-square"></i>
                </button>
                <button class="action-icon-btn delete-btn" onclick="deleteTargetLink('${target.id}')" title="Remove App Link">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            </div>
        </div>
    `;

  return card;
}

// Fetch logs and render dynamic sparklines using custom SVG path computation
async function fetchLogsAndRenderSparkline(targetId) {
  const svg = document.getElementById(`sparkline-svg-${targetId}`);
  const hoverInfo = document.getElementById(`sparkline-hover-${targetId}`);

  if (!svg) return;

  try {
    const response = await fetch(`/api/targets/${targetId}/logs?limit=15`);
    if (!response.ok) throw new Error();
    const logs = await response.json();

    if (logs.length === 0) {
      svg.innerHTML = `
                <text x="50%" y="60%" dominant-baseline="middle" text-anchor="middle" fill="rgba(255,255,255,0.15)" font-size="7" font-weight="600">
                    AWAITING TELEMETRY DATA
                </text>
            `;
      return;
    }

    // Render custom sparkline chart
    renderSparklinePath(svg, hoverInfo, logs, targetId);

  } catch (err) {
    console.error(`Failed to load sparkline for target ${targetId}`);
  }
}

function renderSparklinePath(svg, hoverInfo, logs, targetId) {
  const width = 300;
  const height = 50;
  const padding = 6;

  // Collect coordinates
  const times = logs.map(log => log.response_time_ms || 0);
  const maxTime = Math.max(...times, 100); // minimum scale peak at 100ms
  const minTime = Math.min(...times, 0);
  const range = maxTime - minTime || 1;

  const pointsCount = logs.length;
  const stepX = (width - padding * 2) / (pointsCount > 1 ? pointsCount - 1 : 1);

  let pathData = '';
  let fillData = '';
  const points = [];

  logs.forEach((log, index) => {
    const x = padding + index * stepX;
    const timeVal = log.response_time_ms || 0;
    // Inverse Y coordinates because SVG 0 is top
    const y = height - padding - ((timeVal - minTime) / range) * (height - padding * 2);

    points.push({ x, y, val: timeVal, status: log.status, code: log.status_code, time: log.timestamp });

    if (index === 0) {
      pathData += `M ${x} ${y}`;
      fillData += `M ${x} ${height} L ${x} ${y}`;
    } else {
      pathData += ` L ${x} ${y}`;
      fillData += ` L ${x} ${y}`;
    }

    if (index === logs.length - 1) {
      fillData += ` L ${x} ${height} Z`;
    }
  });

  // Unique ID for SVG gradients to prevent conflicts
  const gradId = `spark-grad-${targetId}`;

  // Get stroke color based on status
  const target = appTargets.find(t => t.id === targetId);
  let strokeColor = 'rgba(0, 122, 255, 0.8)';
  let startGrad = 'rgba(0, 122, 255, 0.35)';

  if (target && target.active === 1) {
    if (target.status === 'UP') {
      strokeColor = 'rgba(16, 185, 129, 0.9)';
      startGrad = 'rgba(16, 185, 129, 0.35)';
    } else if (target.status === 'DOWN') {
      strokeColor = 'rgba(239, 68, 68, 0.9)';
      startGrad = 'rgba(239, 68, 68, 0.35)';
    }
  } else {
    strokeColor = 'rgba(255, 255, 255, 0.3)';
    startGrad = 'rgba(255, 255, 255, 0.08)';
  }

  // Generate beautiful curved paths using Bezier controls if we have multiple points
  if (pointsCount > 2) {
    pathData = '';
    fillData = `M ${points[0].x} ${height} L ${points[0].x} ${points[0].y}`;

    for (let i = 0; i < pointsCount; i++) {
      if (i === 0) {
        pathData += `M ${points[i].x} ${points[i].y}`;
      } else {
        const prev = points[i - 1];
        const curr = points[i];
        // control points
        const cpX1 = prev.x + (curr.x - prev.x) / 2;
        const cpY1 = prev.y;
        const cpX2 = prev.x + (curr.x - prev.x) / 2;
        const cpY2 = curr.y;

        pathData += ` C ${cpX1} ${cpY1}, ${cpX2} ${cpY2}, ${curr.x} ${curr.y}`;
        fillData += ` C ${cpX1} ${cpY1}, ${cpX2} ${cpY2}, ${curr.x} ${curr.y}`;
      }
    }
    fillData += ` L ${points[pointsCount - 1].x} ${height} Z`;
  }

  svg.innerHTML = `
        <defs>
            <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="${startGrad}"/>
                <stop offset="100%" stop-color="rgba(0,0,0,0)"/>
            </linearGradient>
        </defs>
        <!-- Shaded Area Under Curve -->
        <path class="sparkline-gradient" d="${fillData}" fill="url(#${gradId})"/>
        <!-- Performance Line -->
        <path class="sparkline-path" d="${pathData}" stroke="${strokeColor}"/>
        
        <!-- Interactive hover anchor overlay -->
        ${points.map((p, idx) => `
            <circle cx="${p.x}" cy="${p.y}" r="3" fill="${p.status === 'UP' ? '#10b981' : '#ef4444'}" opacity="0" class="spark-node"
                style="cursor: pointer;"
                onmouseover="showSparklineTip('${targetId}', '${p.val} ms', '${p.code}', '${idx}', '${formatTime(p.time)}')"
                onmouseout="hideSparklineTip('${targetId}')">
            </circle>
        `).join('')}
    `;

  // Set default initial tip to last metric
  if (points.length > 0) {
    const last = points[points.length - 1];
    hoverInfo.innerHTML = `<span style="color: ${last.status === 'UP' ? 'var(--success)' : 'var(--danger)'}">${last.val} ms (${last.code})</span>`;
  }
}

// Interactive Sparkline Tooltip
window.showSparklineTip = function (targetId, latencyText, statusCode, index, timeText) {
  const hoverInfo = document.getElementById(`sparkline-hover-${targetId}`);
  if (hoverInfo) {
    const target = appTargets.find(t => t.id == targetId);
    const color = responseCodeIsHealthy(parseInt(statusCode)) ? 'var(--success)' : 'var(--danger)';
    const timePart = timeText ? ` at ${timeText}` : '';
    hoverInfo.innerHTML = `Point ${parseInt(index) + 1}${timePart}: <span style="color: ${color}">${latencyText} (${statusCode})</span>`;
  }
}

window.hideSparklineTip = function (targetId) {
  const hoverInfo = document.getElementById(`sparkline-hover-${targetId}`);
  if (hoverInfo) {
    const target = appTargets.find(t => t.id == targetId);
    if (target && target.last_response_time !== null) {
      const isUp = target.status === 'UP';
      const color = isUp ? 'var(--success)' : 'var(--danger)';
      const codeText = target.last_status_code ? ` (${target.last_status_code})` : '';
      hoverInfo.innerHTML = `<span style="color: ${color}">${target.last_response_time} ms${codeText}</span>`;
    } else {
      hoverInfo.innerHTML = '';
    }
  }
}

function responseCodeIsHealthy(code) {
  return code >= 100 && code < 500;
}

// Toggle Target State (Active/Paused)
async function toggleTarget(id, active) {
  try {
    const response = await fetch(`/api/targets/${id}/toggle`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active })
    });

    if (!response.ok) throw new Error('Toggle error');
    const data = await response.json();

    showToast(data.message, 'success');

    // Instantly reload local metrics
    loadDashboardData();
  } catch (err) {
    showToast('Failed to change target status.', 'error');
    // Reset checkbox UI state
    document.getElementById(`active-toggle-${id}`).checked = !active;
  }
}

// Delete target links
async function deleteTargetLink(id) {
  if (!confirm('Are you absolutely sure you want to remove this Keep-Alive application? Historical pings and performance logs will be lost permanently.')) return;

  try {
    const response = await fetch(`/api/targets/${id}`, {
      method: 'DELETE'
    });

    if (!response.ok) throw new Error('Delete failed');
    const data = await response.json();

    showToast(data.message, 'success');

    // Sync and refresh cards
    loadDashboardData();
  } catch (err) {
    showToast('Could not delete target config.', 'error');
  }
}

// Trigger Manual Instant Ping Check
async function triggerManualPing(id, button) {
  const icon = button.querySelector('i');
  button.disabled = true;
  icon.classList.add('spinning');

  showToast('Initializing connection probe...', 'warning');

  try {
    const response = await fetch(`/api/targets/${id}/ping`, {
      method: 'POST'
    });

    if (!response.ok) throw new Error('Ping failed');
    const result = await response.json();

    icon.classList.remove('spinning');
    button.disabled = false;

    if (result.status === 'UP') {
      showToast(`Connection successful! App is ALIVE. Latency: ${result.response_time_ms}ms (HTTP ${result.status_code})`, 'success');
    } else {
      showToast(`Probe completed but app is DOWN: ${result.error_message || 'HTTP ' + result.status_code}`, 'error');
    }

    // Sync fresh metrics
    loadDashboardData();
  } catch (err) {
    icon.classList.remove('spinning');
    button.disabled = false;
    showToast('Manual probe failed due to network error.', 'error');
  }
}

// Filtering Function
window.filterTargets = function (filter) {
  currentFilter = filter;

  // Toggle active tab UI
  document.getElementById('filter-all').classList.remove('active');
  document.getElementById('filter-active').classList.remove('active');
  document.getElementById('filter-inactive').classList.remove('active');

  document.getElementById(`filter-${filter}`).classList.add('active');

  renderTargetsGrid();
}

// Reorder targets manually using Move Up / Move Down controls
async function moveTarget(id, direction) {
  const filtered = appTargets.filter(target => {
    if (currentFilter === 'active') return target.active === 1;
    if (currentFilter === 'inactive') return target.active === 0;
    return true;
  });

  const index = filtered.findIndex(t => t.id === id);
  if (index === -1) return;

  const newIndex = direction === 'up' ? index - 1 : index + 1;
  if (newIndex < 0 || newIndex >= filtered.length) return;

  const itemA = filtered[index];
  const itemB = filtered[newIndex];

  const globalIndexA = appTargets.findIndex(t => t.id === itemA.id);
  const globalIndexB = appTargets.findIndex(t => t.id === itemB.id);

  if (globalIndexA === -1 || globalIndexB === -1) return;

  // Swap in local memory array
  const temp = appTargets[globalIndexA];
  appTargets[globalIndexA] = appTargets[globalIndexB];
  appTargets[globalIndexB] = temp;

  // Instantly update the DOM grid for real-time smoothness
  renderTargetsGrid();

  try {
    const orderedIds = appTargets.map(t => t.id);
    const response = await fetch('/api/targets/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ordered_ids: orderedIds })
    });
    if (!response.ok) throw new Error('Network response not ok');
    const data = await response.json();
    showToast('Application order updated successfully.', 'success');
  } catch (err) {
    console.error('Reorder error:', err);
    showToast('Failed to sync new order with server.', 'error');
    loadDashboardData();
  }
}
window.moveTarget = moveTarget;

// Modal handling
window.openAddModal = function () {
  editMode = false;
  DOM.modalTitle.textContent = 'Register App Link';
  DOM.targetForm.reset();
  DOM.editId.value = '';
  
  if (DOM.targetOrder) {
    DOM.targetOrder.value = appTargets.length + 1;
  }

  // Set preset bubble
  updateIntervalValue(10);
  setPresetInterval(10);

  DOM.targetModal.classList.add('active');
}

window.openEditModal = function (id) {
  const target = appTargets.find(t => t.id === id);
  if (!target) return;

  editMode = true;
  DOM.modalTitle.textContent = 'Modify App Config';
  DOM.editId.value = target.id;
  DOM.targetName.value = target.name;
  DOM.targetUrl.value = target.url;
  
  if (DOM.targetOrder) {
    DOM.targetOrder.value = target.order || (appTargets.findIndex(t => t.id === id) + 1);
  }

  const interval = target.interval || 10;
  updateIntervalValue(interval);
  setPresetInterval(interval);

  DOM.targetModal.classList.add('active');
}

window.closeModal = function () {
  DOM.targetModal.classList.remove('active');
}

// Custom slider numeric bubble positioning
window.updateIntervalValue = function (val) {
  DOM.targetInterval.value = val;
  DOM.intervalBubble.textContent = `${val}m`;
}

window.setPresetInterval = function (val) {
  // Remove active styles from suggestions
  const presets = document.querySelectorAll('.interval-suggestions span');
  presets.forEach(p => p.classList.remove('active-preset'));

  // Update Slider
  updateIntervalValue(val);

  // Try to find matching element to set active styles
  presets.forEach(p => {
    if (p.textContent === `${val}m`) {
      p.classList.add('active-preset');
    }
  });
}

// Handle Form Submission (Add or Update Target)
async function handleFormSubmit(event) {
  event.preventDefault();

  const id = DOM.editId.value;
  const name = DOM.targetName.value;
  const url = DOM.targetUrl.value;
  const interval = parseInt(DOM.targetInterval.value);
  const order = DOM.targetOrder ? parseInt(DOM.targetOrder.value) : undefined;

  const payload = { name, url, interval, order };

  let apiUrl = '/api/targets';
  let method = 'POST';

  if (editMode && id) {
    apiUrl = `/api/targets/${id}`;
    method = 'PUT';
  }

  try {
    const response = await fetch(apiUrl, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.detail || 'API execution error');
    }

    showToast(result.message || 'Operation completed successfully.', 'success');
    closeModal();

    // Sync and refresh dashboard cards
    loadDashboardData();
  } catch (err) {
    showToast(err.message || 'Failed to save configuration settings.', 'error');
  }
}

// Formatting Helper Functions
const TIME_ZONE = 'Asia/Dhaka';
const TIME_OPTIONS = { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: TIME_ZONE };

function formatTime(isoString) {
  if (!isoString) return 'Never';
  const date = new Date(isoString);
  return date.toLocaleTimeString([], TIME_OPTIONS);
}

function calculateNextPing(lastPingedStr, intervalMinutes, active) {
  if (active === 0) return 'Paused';
  if (!lastPingedStr) return 'Due';

  const lastPing = new Date(lastPingedStr);
  const nextPing = new Date(lastPing.getTime() + intervalMinutes * 60000);
  const now = new Date();

  if (nextPing <= now) return 'Due';

  return nextPing.toLocaleTimeString([], TIME_OPTIONS);
}

function cleanURLDisplay(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname + (parsed.pathname !== '/' ? parsed.pathname : '');
  } catch (e) {
    return url;
  }
}


// ==========================================================================
// SCOPED JAVASCRIPT FOR MONGODB EXPLORER (IIFE SCOPE WRAPPER)
// ==========================================================================
(function () {
  // MongoDB CRUD Explorer - Premium Frontend Logic

  // --- APPLICATION STATE ---
  const state = {
    connected: false,
    uri: '',
    databases: [],
    activeDb: '',
    collections: [],
    activeColl: '',
    documents: [],
    totalDocs: 0,
    currentPage: 1,
    pageSize: 10,
    totalPages: 1,
    filterQuery: '{}',
    sortField: '',
    sortOrder: 1,
    theme: 'system', // 'system', 'light', 'dark'

    // Modals state
    activeModal: null,
    activeDeleteTarget: null, // { type: 'document'|'collection', id: string, name: string }
    editingDocumentId: null,  // String id of the document being edited

    // Predefined URL config
    predefinedUri: 'mongodb://localhost:27017'
  };

  // --- DOM ELEMENTS ---
  const el = {
    // Screens
    connectionScreen: document.getElementById('connection-screen'),
    dashboardScreen: document.getElementById('dashboard-screen'),

    // Connection Form
    connectForm: document.getElementById('connect-form'),
    connectionProfile: document.getElementById('connection-profile'),
    connectionUri: document.getElementById('connection-uri'),
    btnClearUri: document.getElementById('btn-clear-uri'),
    btnConnect: document.getElementById('btn-connect'),
    activeHostText: document.getElementById('active-host-text'),
    btnDisconnect: document.getElementById('btn-disconnect'),

    // Sidebar DB/Coll
    dbSelect: document.getElementById('db-select'),
    collectionsList: document.getElementById('collections-list'),
    collectionSearch: document.getElementById('collection-search'),
    btnShowCreateColl: document.getElementById('btn-show-create-coll'),
    btnToggleSidebar: document.getElementById('btn-toggle-sidebar'),
    sidebar: document.querySelector('#dashboard-screen .sidebar'),
    sidebarBackdrop: document.getElementById('sidebar-backdrop'),

    // Breadcrumb
    bcDb: document.getElementById('bc-db'),
    bcColl: document.getElementById('bc-coll'),

    // Main Panel actions
    btnAddDoc: document.getElementById('btn-add-doc'),
    btnDropColl: document.getElementById('btn-drop-coll'),

    // Query Bar
    queryFilterInput: document.getElementById('query-filter-input'),
    querySortField: document.getElementById('query-sort-field'),
    querySortOrder: document.getElementById('query-sort-order'),
    btnRunQuery: document.getElementById('btn-run-query'),
    btnResetQuery: document.getElementById('btn-reset-query'),
    btnToggleQueryHelp: document.getElementById('btn-toggle-query-help'),
    queryHelpContent: document.getElementById('query-help-content'),

    // Documents Section
    documentCountLabel: document.getElementById('document-count-label'),
    documentsGrid: document.getElementById('documents-grid'),
    refreshIndicator: document.getElementById('refresh-indicator'),
    btnRefreshDocs: document.getElementById('btn-refresh-docs'),

    // Pagination
    paginationBar: document.getElementById('pagination-bar'),
    pageSizeSelect: document.getElementById('page-size-select'),
    btnPrevPage: document.getElementById('btn-prev-page'),
    btnNextPage: document.getElementById('btn-next-page'),
    paginationText: document.getElementById('pagination-text'),

    // Toast container
    toastContainer: document.getElementById('db-toast-container'),

    // Modals
    createCollModal: document.getElementById('create-coll-modal'),
    createCollForm: document.getElementById('create-coll-form'),
    newCollName: document.getElementById('new-coll-name'),

    documentModal: document.getElementById('document-modal'),
    documentForm: document.getElementById('document-form'),
    docModalTitle: document.getElementById('doc-modal-title'),
    documentEditor: document.getElementById('document-editor'),
    editorSyntaxStatus: document.getElementById('editor-syntax-status'),
    editorErrorMsg: document.getElementById('editor-error-msg'),

    confirmDangerModal: document.getElementById('confirm-danger-modal'),
    dangerModalTitle: document.getElementById('danger-modal-title'),
    dangerModalMessage: document.getElementById('danger-modal-message'),
    dangerConfirmTypeWrapper: document.getElementById('danger-confirm-type-wrapper'),
    dangerConfirmInput: document.getElementById('danger-confirm-input'),
    dangerConfirmKeyword: document.getElementById('danger-confirm-keyword'),
    btnConfirmDanger: document.getElementById('btn-confirm-danger')
  };

  // --- INITIALIZATION ---
  let initialized = false;
  window.initDbExplorer = function() {
    if (initialized) return;
    initialized = true;
    setupEventListeners();
    fetchConfig();
    checkConnectionStatus();
  };

  // --- API COMMUNICATIONS ---
  async function apiPost(endpoint, body = {}) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || `Server error: ${response.status}`);
      }
      return data;
    } catch (error) {
      console.error(`API Error (${endpoint}):`, error);
      throw error;
    }
  }

  async function apiGet(endpoint) {
    try {
      const response = await fetch(endpoint);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || `Server error: ${response.status}`);
      }
      return data;
    } catch (error) {
      console.error(`API Error (${endpoint}):`, error);
      throw error;
    }
  }

  // --- INTERACTIVE EVENT LISTENERS ---
  function setupEventListeners() {
    // Sidebar responsiveness toggle
    if (el.btnToggleSidebar) {
      el.btnToggleSidebar.addEventListener('click', () => {
        el.sidebar.classList.toggle('open');
        el.sidebarBackdrop.classList.toggle('active');
      });
    }

    if (el.sidebarBackdrop) {
      el.sidebarBackdrop.addEventListener('click', () => {
        el.sidebar.classList.remove('open');
        el.sidebarBackdrop.classList.remove('active');
      });
    }

    // Initialize with readOnly state (since Local Profile is selected by default)
    if (el.connectionUri) {
      el.connectionUri.readOnly = true;
      el.connectionUri.classList.add('locked');
    }

    // Connection Profile Dropdown Selector
    if (el.connectionProfile) {
      el.connectionProfile.addEventListener('change', (e) => {
        const mode = e.target.value;
        if (mode === 'local') {
          el.connectionUri.value = 'mongodb://localhost:27017';
          el.connectionUri.readOnly = true;
          el.connectionUri.classList.add('locked');
        } else if (mode === 'predefined') {
          el.connectionUri.value = state.predefinedUri;
          el.connectionUri.readOnly = true;
          el.connectionUri.classList.add('locked');
        } else {
          el.connectionUri.value = '';
          el.connectionUri.readOnly = false;
          el.connectionUri.classList.remove('locked');
          el.connectionUri.focus();
        }
      });
    }

    // Clear URI input button
    el.btnClearUri.addEventListener('click', () => {
      // Only allow clearing if not locked (in custom profile mode)
      if (!el.connectionUri.readOnly) {
        el.connectionUri.value = '';
        el.connectionUri.focus();
      }
    });

    // Connection Form Submission
    el.connectForm.addEventListener('submit', handleConnect);

    // Disconnect Trigger
    el.btnDisconnect.addEventListener('click', handleDisconnect);

    // Database select picker
    el.dbSelect.addEventListener('change', (e) => {
      handleDatabaseSelect(e.target.value);
    });

    // Collection Filter Search Box
    el.collectionSearch.addEventListener('input', (e) => {
      filterCollectionsList(e.target.value);
    });

    // New Collection Trigger
    el.btnShowCreateColl.addEventListener('click', () => {
      if (!state.activeDb) {
        showToast('Warning', 'Please select a database first.', 'error');
        return;
      }
      openModal(el.createCollModal);
    });

    el.createCollForm.addEventListener('submit', handleCreateCollection);

    // Drop Collection Button
    el.btnDropColl.addEventListener('click', () => {
      if (!state.activeDb || !state.activeColl) return;
      confirmDanger({
        type: 'collection',
        name: state.activeColl,
        message: `Are you absolutely sure you want to drop collection "${state.activeColl}"? This will delete all its documents forever.`,
        keyword: state.activeColl,
        action: executeDropCollection
      });
    });

    // Query Filter Execution
    el.btnRunQuery.addEventListener('click', () => {
      state.currentPage = 1;
      fetchDocuments();
    });

    el.btnResetQuery.addEventListener('click', () => {
      el.queryFilterInput.value = '{}';
      el.querySortField.value = '';
      el.querySortOrder.value = '1';
      state.currentPage = 1;
      fetchDocuments();
    });

    el.btnToggleQueryHelp.addEventListener('click', () => {
      el.queryHelpContent.classList.toggle('hidden');
    });

    // Refresh Documents List & Collection Stats
    el.btnRefreshDocs.addEventListener('click', () => {
      fetchDocuments();
      refreshCollectionStats();
    });

    // Pagination actions
    el.pageSizeSelect.addEventListener('change', (e) => {
      state.pageSize = parseInt(e.target.value, 10);
      state.currentPage = 1;
      fetchDocuments();
    });

    el.btnPrevPage.addEventListener('click', () => {
      if (state.currentPage > 1) {
        state.currentPage--;
        fetchDocuments();
      }
    });

    el.btnNextPage.addEventListener('click', () => {
      if (state.currentPage < state.totalPages) {
        state.currentPage++;
        fetchDocuments();
      }
    });

    // Add Document button
    el.btnAddDoc.addEventListener('click', () => {
      if (!state.activeDb || !state.activeColl) return;
      openDocumentModal(null);
    });

    // Document editor validator
    el.documentEditor.addEventListener('input', validateEditorJson);

    el.documentForm.addEventListener('submit', handleSaveDocument);

    // Close Modals triggers
    document.querySelectorAll('.modal-close-trigger').forEach(trigger => {
      trigger.addEventListener('click', closeModal);
    });

    // Close modal on outside backdrop click
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal();
      });
    });

    // Confirm danger execution
    el.btnConfirmDanger.addEventListener('click', handleConfirmDanger);
  }

  // --- CONNECTION FLOWS ---
  async function fetchConfig() {
    try {
      const config = await apiGet('/api/config');
      state.predefinedUri = config.predefined_uri || 'mongodb://localhost:27017';
      // If the select is predefined, make sure it gets updated
      if (el.connectionProfile && el.connectionProfile.value === 'predefined') {
        el.connectionUri.value = state.predefinedUri;
      }
    } catch (error) {
      console.error('Failed to load server config:', error);
    }
  }

  async function checkConnectionStatus() {
    try {
      const status = await apiGet('/api/connection-status');
      if (status.connected) {
        state.connected = true;
        state.uri = status.uri;

        // Load databases
        const dbData = await apiGet('/api/databases');
        state.databases = dbData.databases;

        populateDatabasesDropdown();
        showScreen(el.dashboardScreen);

        // Update UI texts
        el.activeHostText.textContent = cleanUriForDisplay(state.uri);
        showToast('Connected', 'Resumed active connection.', 'success');
      } else {
        showScreen(el.connectionScreen);
      }
    } catch (error) {
      showScreen(el.connectionScreen);
    }
  }

  async function handleConnect(e) {
    e.preventDefault();
    const uri = el.connectionUri.value.trim();

    if (!uri) return;

    setButtonLoading(el.btnConnect, true, 'Connecting...');

    try {
      const data = await apiPost('/api/connect', { uri });
      state.connected = true;
      state.uri = uri;
      state.databases = data.databases;

      populateDatabasesDropdown();
      showScreen(el.dashboardScreen);

      el.activeHostText.textContent = cleanUriForDisplay(uri);
      showToast('Success', 'Successfully connected to database!', 'success');
    } catch (error) {
      showToast('Connection Failed', error.message, 'error');
    } finally {
      setButtonLoading(el.btnConnect, false, 'Connect to Database');
    }
  }

  async function handleDisconnect() {
    try {
      await apiPost('/api/disconnect');
      state.connected = false;
      state.uri = '';
      state.databases = [];
      state.activeDb = '';
      state.collections = [];
      state.activeColl = '';
      state.documents = [];

      // Reset view variables
      el.dbSelect.innerHTML = '<option value="" disabled selected>Select Database...</option>';
      el.collectionsList.innerHTML = '<div class="empty-state-text">Select a database to view collections</div>';

      // Disable breadcrumbs
      el.bcDb.textContent = '-';
      el.bcColl.textContent = '-';
      el.btnAddDoc.disabled = true;
      el.btnDropColl.disabled = true;

      // Clear docs display
      renderEmptyDocumentsState();
      el.paginationBar.classList.add('hidden');

      showScreen(el.connectionScreen);
      showToast('Disconnected', 'Database connection terminated successfully.', 'info');
    } catch (error) {
      showToast('Disconnect Failed', error.message, 'error');
    }
  }

  // --- DATABASE AND COLLECTION TRAVERSAL ---
  function populateDatabasesDropdown() {
    // Clear select
    el.dbSelect.innerHTML = '<option value="" disabled selected>Select Database...</option>';

    // Sort databases and populate
    state.databases.sort().forEach(dbName => {
      const option = document.createElement('option');
      option.value = dbName;
      option.textContent = dbName;
      el.dbSelect.appendChild(option);
    });
  }

  async function handleDatabaseSelect(dbName) {
    state.activeDb = dbName;
    state.activeColl = '';
    state.collections = [];
    state.documents = [];

    // Update Breadcrumbs
    el.bcDb.textContent = dbName;
    el.bcColl.textContent = '-';
    el.btnAddDoc.disabled = true;
    el.btnDropColl.disabled = true;

    // Empty documents list
    renderEmptyDocumentsState();
    el.paginationBar.classList.add('hidden');

    el.collectionsList.innerHTML = '<div class="empty-state-text">Fetching collections...</div>';

    try {
      const data = await apiGet(`/api/collections?db_name=${encodeURIComponent(dbName)}`);
      state.collections = data.collections;
      renderCollectionsList(state.collections);
    } catch (error) {
      el.collectionsList.innerHTML = '<div class="empty-state-text error">Failed to load collections.</div>';
      showToast('Error', `Failed to list collections: ${error.message}`, 'error');
    }
  }

  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function renderCollectionsList(collections) {
    if (collections.length === 0) {
      el.collectionsList.innerHTML = '<div class="empty-state-text">No collections found.</div>';
      return;
    }

    el.collectionsList.innerHTML = '';

    collections.forEach(coll => {
      const collName = coll.name;
      const count = coll.count !== undefined ? coll.count : 0;
      const sizeBytes = coll.size !== undefined ? coll.size : 0;
      const formattedSize = formatBytes(sizeBytes);
      const metaText = `${count} doc${count === 1 ? '' : 's'} • ${formattedSize}`;

      const item = document.createElement('div');
      item.className = 'collection-item';
      if (collName === state.activeColl) item.classList.add('active');

      item.innerHTML = `
      <div class="collection-name-wrapper" title="${collName}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        <div class="collection-text-group">
          <span class="collection-title">${collName}</span>
          <span class="collection-meta">${metaText}</span>
        </div>
      </div>
      <div class="collection-item-actions">
        <button class="btn-icon btn-coll-delete" title="Drop Collection">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7M4 7h16M10 11v6M14 11v6"/></svg>
        </button>
      </div>
    `;

      // Select Collection Trigger
      item.addEventListener('click', (e) => {
        // Prevent choosing if clicking drop collection inside item
        if (e.target.closest('.btn-coll-delete')) return;
        handleCollectionSelect(collName);
      });

      // Quick drop collection trigger
      const btnDel = item.querySelector('.btn-coll-delete');
      btnDel.addEventListener('click', (e) => {
        e.stopPropagation();
        confirmDanger({
          type: 'collection',
          name: collName,
          message: `Are you absolutely sure you want to drop collection "${collName}"? This deletes all data in it.`,
          keyword: collName,
          action: () => executeDropCollection(collName)
        });
      });

      el.collectionsList.appendChild(item);
    });
  }

  function filterCollectionsList(query) {
    const filtered = state.collections.filter(coll =>
      coll.name.toLowerCase().includes(query.toLowerCase())
    );
    renderCollectionsList(filtered);
  }

  function handleCollectionSelect(collName) {
    state.activeColl = collName;
    state.currentPage = 1;

    // Auto-close sidebar on mobile after selecting a collection
    if (el.sidebar && el.sidebar.classList.contains('open')) {
      el.sidebar.classList.remove('open');
      el.sidebarBackdrop.classList.remove('active');
    }

    // Highlight active collection
    document.querySelectorAll('.collection-item').forEach(item => {
      const textSpan = item.querySelector('.collection-title');
      if (textSpan && textSpan.textContent.trim() === collName) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });

    // Update header and breadcrumbs
    el.bcColl.textContent = collName;
    el.btnAddDoc.disabled = false;
    el.btnDropColl.disabled = false;

    // Reset query search and find
    el.queryFilterInput.value = '{}';
    el.querySortField.value = '';

    fetchDocuments();
  }

  async function handleCreateCollection(e) {
    e.preventDefault();
    const collectionName = el.newCollName.value.trim();

    if (!collectionName || !state.activeDb) return;

    try {
      await apiPost('/api/collections/create', {
        db_name: state.activeDb,
        collection_name: collectionName
      });

      closeModal();
      showToast('Success', `Collection '${collectionName}' created successfully.`, 'success');

      // Refresh collections list
      const data = await apiGet(`/api/collections?db_name=${encodeURIComponent(state.activeDb)}`);
      state.collections = data.collections;
      renderCollectionsList(state.collections);
      el.newCollName.value = '';

      // Automatically select the newly created collection
      handleCollectionSelect(collectionName);
    } catch (error) {
      showToast('Creation Failed', error.message, 'error');
    }
  }

  async function executeDropCollection(collName = null) {
    const targetColl = collName || state.activeColl;
    if (!state.activeDb || !targetColl) return;

    try {
      await apiPost('/api/collections/delete', {
        db_name: state.activeDb,
        collection_name: targetColl
      });

      showToast('Success', `Dropped collection '${targetColl}' successfully.`, 'success');

      // Reset if it was the selected one
      if (targetColl === state.activeColl) {
        state.activeColl = '';
        el.bcColl.textContent = '-';
        el.btnAddDoc.disabled = true;
        el.btnDropColl.disabled = true;
        renderEmptyDocumentsState();
        el.paginationBar.classList.add('hidden');
      }

      // Refresh lists
      const data = await apiGet(`/api/collections?db_name=${encodeURIComponent(state.activeDb)}`);
      state.collections = data.collections;
      renderCollectionsList(state.collections);
    } catch (error) {
      showToast('Drop Failed', error.message, 'error');
    }
  }

  // --- DOCUMENTS SEARCH & FETCH ---
  async function fetchDocuments() {
    if (!state.activeDb || !state.activeColl) return;

    const filterQuery = el.queryFilterInput.value.trim() || '{}';
    const sortField = el.querySortField.value.trim() || null;
    const sortOrder = parseInt(el.querySortOrder.value, 10);

    setIndicatorActive(true);

    try {
      const data = await apiPost('/api/documents', {
        db_name: state.activeDb,
        collection_name: state.activeColl,
        filter_query: filterQuery,
        sort_field: sortField,
        sort_order: sortOrder,
        page: state.currentPage,
        limit: state.pageSize
      });

      state.documents = data.documents;
      state.totalDocs = data.total;
      state.totalPages = data.pages;

      renderDocumentsList();
      updatePaginationControls();
    } catch (error) {
      showToast('Query Failed', error.message, 'error');
      renderQueryErrorState(error.message);
    } finally {
      setIndicatorActive(false);
    }
  }

  async function refreshCollectionStats() {
    if (!state.activeDb) return;
    try {
      const data = await apiGet(`/api/collections?db_name=${encodeURIComponent(state.activeDb)}`);
      state.collections = data.collections;
      renderCollectionsList(state.collections);
    } catch (error) {
      console.error('Failed to refresh collection stats:', error);
    }
  }

  function renderDocumentsList() {
    if (state.documents.length === 0) {
      el.documentCountLabel.textContent = '0 Documents';
      el.documentsGrid.innerHTML = `
      <div class="dashboard-empty-state">
        <div class="empty-art">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
        </div>
        <h3>No matching documents</h3>
        <p>No entries matched your current search query. Try resetting your filters.</p>
      </div>
    `;
      el.paginationBar.classList.add('hidden');
      return;
    }

    el.documentCountLabel.textContent = `${state.totalDocs} ${state.totalDocs === 1 ? 'Document' : 'Documents'} found`;
    el.documentsGrid.innerHTML = '';

    state.documents.forEach((doc, idx) => {
      const card = document.createElement('article');
      card.className = 'document-card';

      // Extract a representative ID or primary string for the card header
      let docIdDisplay = 'Unnamed Document';
      let docIdString = '';

      if (doc._id) {
        if (typeof doc._id === 'object' && doc._id.$oid) {
          docIdString = doc._id.$oid;
          docIdDisplay = `id: ${docIdString}`;
        } else {
          docIdString = String(doc._id);
          docIdDisplay = `id: ${docIdString}`;
        }
      }

      card.innerHTML = `
      <div class="document-card-header">
        <span class="doc-id-badge" title="Copy Document ID">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right: 4px;"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          ${docIdDisplay}
        </span>
        <div class="doc-card-actions">
          <button class="btn-icon btn-doc-edit" title="Edit Document">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4z"/></svg>
          </button>
          <button class="btn-icon btn-doc-delete" title="Delete Document">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/></svg>
          </button>
        </div>
      </div>
      <div class="pretty-json-wrapper">
        <code>${renderPrettyJSON(doc)}</code>
      </div>
    `;

      // Copy ID shortcut click
      const idBadge = card.querySelector('.doc-id-badge');
      idBadge.addEventListener('click', () => {
        navigator.clipboard.writeText(docIdString || JSON.stringify(doc._id));
        showToast('Copied', 'Document ID copied to clipboard.', 'success');
      });

      // Trigger Edit Document Modal
      card.querySelector('.btn-doc-edit').addEventListener('click', () => {
        openDocumentModal(doc);
      });

      // Trigger Delete Document Confirm
      card.querySelector('.btn-doc-delete').addEventListener('click', () => {
        confirmDanger({
          type: 'document',
          id: docIdString,
          name: docIdDisplay,
          message: 'Are you sure you want to permanently delete this document?',
          action: () => executeDeleteDocument(docIdString)
        });
      });

      el.documentsGrid.appendChild(card);
    });

    el.paginationBar.classList.remove('hidden');
  }

  function updatePaginationControls() {
    el.paginationText.textContent = `Page ${state.currentPage} of ${state.totalPages || 1}`;
    el.btnPrevPage.disabled = state.currentPage <= 1;
    el.btnNextPage.disabled = state.currentPage >= state.totalPages;
  }

  // --- DOCUMENT INSERT / EDIT FLOWS ---
  function openDocumentModal(doc = null) {
    state.editingDocumentId = null;
    el.documentEditor.classList.remove('invalid');
    el.editorErrorMsg.classList.add('hidden');

    if (doc) {
      // EDIT FLOW
      el.docModalTitle.textContent = 'Edit Document';
      state.editingDocumentId = doc._id && doc._id.$oid ? doc._id.$oid : String(doc._id);

      // Stringify document neatly with 2 spaces
      el.documentEditor.value = JSON.stringify(doc, null, 2);
    } else {
      // ADD NEW FLOW
      el.docModalTitle.textContent = 'Add New Document';

      // Standard template
      const template = {
        name: "Sample Item",
        quantity: 10,
        active: true,
        tags: ["new", "db-explorer"]
      };
      el.documentEditor.value = JSON.stringify(template, null, 2);
    }

    validateEditorJson();
    openModal(el.documentModal);
  }

  function validateEditorJson() {
    const value = el.documentEditor.value.trim();

    if (!value) {
      setEditorValidState(false, 'JSON editor is empty');
      return false;
    }

    try {
      JSON.parse(value);
      setEditorValidState(true);
      return true;
    } catch (error) {
      setEditorValidState(false, error.message);
      return false;
    }
  }

  function setEditorValidState(isValid, errorMsg = '') {
    if (isValid) {
      el.editorSyntaxStatus.className = 'editor-syntax-status valid';
      el.editorSyntaxStatus.querySelector('.status-label').textContent = 'Valid JSON';
      el.editorErrorMsg.classList.add('hidden');
      el.documentEditor.style.borderColor = '';
    } else {
      el.editorSyntaxStatus.className = 'editor-syntax-status invalid';
      el.editorSyntaxStatus.querySelector('.status-label').textContent = 'Syntax Error';
      el.editorErrorMsg.textContent = errorMsg;
      el.editorErrorMsg.classList.remove('hidden');
      el.documentEditor.style.borderColor = 'var(--danger)';
    }
  }

  async function handleSaveDocument(e) {
    e.preventDefault();

    if (!validateEditorJson()) {
      // Shake modal if invalid
      const card = el.documentModal.querySelector('.modal-card');
      card.classList.add('shake');
      setTimeout(() => card.classList.remove('shake'), 400);
      return;
    }

    const docPayload = JSON.parse(el.documentEditor.value);

    try {
      if (state.editingDocumentId) {
        // API Update Call
        await apiPost('/api/documents/update', {
          db_name: state.activeDb,
          collection_name: state.activeColl,
          id_str: state.editingDocumentId,
          document: docPayload
        });
        showToast('Document Saved', 'Your document edits were saved successfully.', 'success');
      } else {
        // API Create Call
        await apiPost('/api/documents/create', {
          db_name: state.activeDb,
          collection_name: state.activeColl,
          document: docPayload
        });
        showToast('Document Created', 'A new document was added successfully.', 'success');
      }

      closeModal();
      fetchDocuments();
      refreshCollectionStats();
    } catch (error) {
      showToast('Save Failed', error.message, 'error');
    }
  }

  async function executeDeleteDocument(docId) {
    if (!state.activeDb || !state.activeColl || !docId) return;

    try {
      await apiPost('/api/documents/delete', {
        db_name: state.activeDb,
        collection_name: state.activeColl,
        id_str: docId
      });

      showToast('Success', 'Document deleted successfully.', 'success');
      fetchDocuments();
      refreshCollectionStats();
    } catch (error) {
      showToast('Deletion Failed', error.message, 'error');
    }
  }

  // --- DANGER / DESTRUCTIVE CONFIRMATIONS ---
  function confirmDanger({ type, name, message, keyword = '', action }) {
    state.activeDeleteTarget = { type, name, action };

    el.dangerModalTitle.textContent = type === 'collection' ? 'Drop Collection' : 'Delete Document';
    el.dangerModalMessage.textContent = message;

    if (keyword) {
      el.dangerConfirmKeyword.textContent = keyword;
      el.dangerConfirmInput.value = '';
      el.dangerConfirmTypeWrapper.classList.remove('hidden');
      el.btnConfirmDanger.disabled = true;

      // Watch typing input
      el.dangerConfirmInput.oninput = (e) => {
        el.btnConfirmDanger.disabled = e.target.value.trim() !== keyword;
      };
    } else {
      el.dangerConfirmTypeWrapper.classList.add('hidden');
      el.btnConfirmDanger.disabled = false;
    }

    openModal(el.confirmDangerModal);
  }

  function handleConfirmDanger() {
    if (!state.activeDeleteTarget) return;

    const { action } = state.activeDeleteTarget;
    closeModal();
    action();
    state.activeDeleteTarget = null;
  }

  // --- PREMIUM JSON TREE BUILDER ---
  function renderPrettyJSON(value, indent = 0) {
    const pad = ' '.repeat(indent);
    const nextPad = ' '.repeat(indent + 2);

    if (value === null) {
      return `<span class="json-null">null</span>`;
    }
    if (typeof value === 'boolean') {
      return `<span class="json-boolean">${value}</span>`;
    }
    if (typeof value === 'number') {
      return `<span class="json-number">${value}</span>`;
    }
    if (typeof value === 'string') {
      return `<span class="json-string">"${escapeHtml(value)}"</span>`;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) return `<span class="json-bracket">[]</span>`;
      let html = `<span class="json-bracket">[</span>\n`;
      html += value.map(item => nextPad + renderPrettyJSON(item, indent + 2)).join(',\n');
      html += `\n${pad}<span class="json-bracket">]</span>`;
      return html;
    }
    if (typeof value === 'object') {
      // Match extended JSON BSON representations from FastAPI
      if ('$oid' in value && Object.keys(value).length === 1) {
        return `<span class="bson-pill" title="ObjectId">oid</span> <span class="json-string">"${escapeHtml(value.$oid)}"</span>`;
      }
      if ('$date' in value && Object.keys(value).length === 1) {
        return `<span class="bson-pill date" title="ISODate">date</span> <span class="json-string">"${escapeHtml(value.$date)}"</span>`;
      }

      const keys = Object.keys(value);
      if (keys.length === 0) return `<span class="json-bracket">{}</span>`;

      let html = `<span class="json-bracket">{</span>\n`;
      html += keys.map(key => {
        const keySpan = `<span class="json-key">"${escapeHtml(key)}"</span>`;
        return `${nextPad}${keySpan}: ${renderPrettyJSON(value[key], indent + 2)}`;
      }).join(',\n');
      html += `\n${pad}<span class="json-bracket">}</span>`;
      return html;
    }
    return escapeHtml(String(value));
  }

  function escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // --- SYSTEM HELPERS ---
  function showScreen(screenEl) {
    // Hide all screens
    document.querySelectorAll('.screen').forEach(scr => {
      scr.classList.remove('active');
    });

    // Show target
    screenEl.classList.add('active');
  }

  function openModal(modalEl) {
    state.activeModal = modalEl;
    modalEl.classList.add('active');
  }

  function closeModal() {
    if (state.activeModal) {
      state.activeModal.classList.remove('active');
      state.activeModal = null;
    } else {
      document.querySelectorAll('.modal-overlay').forEach(modal => {
        modal.classList.remove('active');
      });
    }
  }

  function showToast(title, message, type = 'info', duration = 4000) {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    let iconSvg = '';
    if (type === 'success') {
      iconSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
    } else if (type === 'error') {
      iconSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
    } else {
      iconSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="8"/></svg>';
    }

    toast.innerHTML = `
    <div class="toast-icon">${iconSvg}</div>
    <div class="toast-body">
      <span class="toast-title">${title}</span>
      <span class="toast-message">${message}</span>
    </div>
    <button class="toast-close-btn" title="Dismiss">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
    </button>
    <div class="toast-progress"></div>
  `;

    // Close toast trigger
    toast.querySelector('.toast-close-btn').onclick = () => removeToast(toast);

    el.toastContainer.appendChild(toast);

    // Animate progress bar disappearing
    const progress = toast.querySelector('.toast-progress');
    progress.style.transition = `width ${duration}ms linear`;
    setTimeout(() => { progress.style.width = '0%'; }, 10);

    // Auto dismiss
    const dismissTimer = setTimeout(() => {
      removeToast(toast);
    }, duration);

    toast.dataset.timer = dismissTimer;
  }

  function removeToast(toast) {
    clearTimeout(toast.dataset.timer);
    toast.classList.add('removing');
    toast.addEventListener('animationend', () => {
      toast.remove();
    });
  }

  function renderEmptyDocumentsState() {
    el.documentCountLabel.textContent = '0 Documents';
    el.documentsGrid.innerHTML = `
    <div class="dashboard-empty-state">
      <div class="empty-art">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
          <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>
        </svg>
      </div>
      <h3>No collection selected</h3>
      <p>Select a database and choose a collection from the sidebar to view documents, or filter your active documents.</p>
    </div>
  `;
  }

  function renderQueryErrorState(errorMsg) {
    el.documentCountLabel.textContent = 'Query Failed';
    el.documentsGrid.innerHTML = `
    <div class="dashboard-empty-state" style="border-color: rgba(239, 68, 68, 0.3);">
      <div class="empty-art" style="color: var(--danger);">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
        </svg>
      </div>
      <h3 style="color: var(--danger);">Database Query Failed</h3>
      <p style="color: var(--text-secondary); max-width: 420px; font-family: var(--font-mono); margin-top: 10px; background: rgba(239,68,68,0.05); padding: 12px; border-radius: 6px; border: 1px dashed rgba(239,68,68,0.2);">
        ${errorMsg}
      </p>
    </div>
  `;
    el.paginationBar.classList.add('hidden');
  }

  function setIndicatorActive(isActive) {
    if (isActive) {
      el.refreshIndicator.classList.add('active');
    } else {
      el.refreshIndicator.classList.remove('active');
    }
  }

  function setButtonLoading(btnEl, isLoading, text) {
    btnEl.disabled = isLoading;
    const span = btnEl.querySelector('span');
    if (span) span.textContent = text;
  }

  function cleanUriForDisplay(uri) {
    try {
      const parsed = new URL(uri);
      // Strip username/password for safety display
      if (parsed.password) parsed.password = '****';
      return parsed.href;
    } catch (e) {
      // If standard URL parsing fails, mask credentials regex
      return uri.replace(/\/\/([^:]+):([^@]+)@/, '//xxxx:xxxx@');
    }
  }

})();
