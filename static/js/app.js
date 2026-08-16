/* MOHAMMAD CONSTRUCTION & ENGINEERING SDN.BHD. - Frontend Application Logic */

const API_BASE = '/api';
let currentUser = null;
let authToken = localStorage.getItem('token');

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getLocalDateString(d = new Date()) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function get16thCycleStartDate(refDate = new Date()) {
  const day = refDate.getDate();
  let year = refDate.getFullYear();
  let month = refDate.getMonth();

  if (day < 16) {
    month -= 1;
    if (month < 0) {
      month = 11;
      year -= 1;
    }
  }
  const cycleStartObj = new Date(year, month, 16);
  return getLocalDateString(cycleStartObj);
}

// Initialization
document.addEventListener('DOMContentLoaded', () => {
  // Set current date input default to today YYYY-MM-DD and set max attribute to disable future dates
  const now = new Date();
  const todayStr = getLocalDateString(now);
  const dateInput = document.getElementById('attendanceDate');
  if (dateInput) {
    dateInput.max = todayStr;
    if (!dateInput.value || dateInput.value > todayStr) dateInput.value = todayStr;
  }

  // Set default report & lookup date range: 16th-to-15th monthly cycle start up to today
  const cycleStartStr = get16thCycleStartDate(now);


  // Set default lookup date range for Worker Attendance History (16th to 15th cycle)
  const lookupStartInput = document.getElementById('lookupStartDate');
  const lookupEndInput = document.getElementById('lookupEndDate');
  if (lookupStartInput) {
    lookupStartInput.max = todayStr;
    if (!lookupStartInput.value || lookupStartInput.value > todayStr) lookupStartInput.value = (cycleStartStr > todayStr) ? todayStr : cycleStartStr;
  }
  if (lookupEndInput) {
    lookupEndInput.max = todayStr;
    if (!lookupEndInput.value || lookupEndInput.value > todayStr) lookupEndInput.value = todayStr;
  }

  const headerDateStr = document.getElementById('headerDateStr');
  if (headerDateStr) {
    const options = { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' };
    headerDateStr.innerText = new Date().toLocaleDateString('en-MY', options);
  }

  if (authToken) {
    showAuthCheckingState();
    checkCurrentAuth();
  } else {
    showLoginOverlay();
  }
});

// UI Overlay Helpers
function showLoginOverlay() {
  const form = document.getElementById('loginForm');
  const loading = document.getElementById('authLoadingState');
  if (form) form.style.display = 'block';
  if (loading) loading.style.display = 'none';
  const overlay = document.getElementById('loginOverlay');
  if (overlay) overlay.style.display = 'flex';
  const appEl = document.getElementById('app');
  if (appEl) appEl.style.display = 'none';
}

function showAuthCheckingState() {
  const form = document.getElementById('loginForm');
  const loading = document.getElementById('authLoadingState');
  if (form) form.style.display = 'none';
  if (loading) loading.style.display = 'block';
  const overlay = document.getElementById('loginOverlay');
  if (overlay) overlay.style.display = 'flex';
  const appEl = document.getElementById('app');
  if (appEl) appEl.style.display = 'none';
}

// Auth Helpers
async function apiFetch(endpoint, options = {}) {
  options.headers = options.headers || {};
  if (authToken) {
    options.headers['Authorization'] = `Bearer ${authToken}`;
  }
  options.headers['Content-Type'] = options.headers['Content-Type'] || 'application/json';

  const res = await fetch(`${API_BASE}${endpoint}`, options);
  if (res.status === 401) {
    handleLogout();
    throw new Error('Session expired. Please log in again.');
  }
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.detail || 'API request failed');
  }
  return data;
}

async function checkCurrentAuth() {
  try {
    currentUser = await apiFetch('/auth/me');
    setupUserSession();
  } catch (err) {
    console.error("Auth check failed:", err);
    handleLogout();
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const usernameInput = document.getElementById('loginUsername').value.trim();
  const passwordInput = document.getElementById('loginPassword').value.trim();
  const errorDiv = document.getElementById('loginError');

  errorDiv.style.display = 'none';

  try {
    const data = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: usernameInput, password: passwordInput })
    }).then(r => r.json());

    if (data.access_token) {
      authToken = data.access_token;
      localStorage.setItem('token', authToken);
      currentUser = data.user;
      setupUserSession();
    } else {
      errorDiv.innerText = data.detail || 'Login failed';
      errorDiv.style.display = 'block';
    }
  } catch (err) {
    errorDiv.innerText = err.message || 'Server error';
    errorDiv.style.display = 'block';
  }
}

function setupUserSession() {
  document.getElementById('loginOverlay').style.display = 'none';
  document.getElementById('app').style.display = 'flex';

  // Update Sidebar Info
  const avatar = document.getElementById('sidebarAvatar');
  const name = document.getElementById('sidebarUserName');
  const role = document.getElementById('sidebarUserRole');

  if (avatar) avatar.innerText = currentUser.full_name ? currentUser.full_name[0].toUpperCase() : 'U';
  if (name) name.innerText = currentUser.full_name || currentUser.username;
  if (role) {
    if (currentUser.role === 'admin') {
      role.innerText = 'Chief Admin';
    } else {
      role.innerText = currentUser.assigned_project_name ? `Site Mgr (${currentUser.assigned_project_name})` : 'Site Manager';
    }
  }

  // Toggle Admin-only elements and tab access permissions
  applyRoleBasedAccess();

  // Load initial filter options & restore last active section
  loadProjectOptions();
  loadGroupOptions();

  // Eager pre-download and pre-cache AI face engine in background on 1st boot up / launch
  setTimeout(() => {
    initFaceScanner(true).catch(e => console.warn("Background face engine pre-loader notice:", e));
  }, 150);

  const savedSection = localStorage.getItem('activeSection') || 'dashboard';
  switchSection(savedSection);
}

function applyRoleBasedAccess() {
  if (!currentUser) return;
  const isSiteManager = (currentUser.role === 'site_manager');
  let allowedTabs = currentUser.allowed_tabs || ['dashboard', 'face-scanner', 'attendance', 'workers', 'projects', 'groups'];
  
  // Ensure 'face-scanner' is available to site managers by default
  if (!allowedTabs.includes('face-scanner')) {
    allowedTabs.push('face-scanner');
  }

  // Toggle Admin-only elements
  const adminElements = document.querySelectorAll('.admin-only');
  adminElements.forEach(el => {
    const isVisible = (currentUser && currentUser.role === 'admin');
    if (!isVisible) {
      el.style.display = 'none';
    } else {
      el.style.display = (el.tagName === 'BUTTON' || el.tagName === 'SPAN' || el.classList.contains('scan-photo-btn')) ? 'inline-flex' : 'flex';
    }
  });

  // Filter sidebar navigation items based on manager allowed_tabs permissions
  const navItems = document.querySelectorAll('.sidebar-nav .nav-item');
  navItems.forEach(item => {
    const onclickAttr = item.getAttribute('onclick') || '';
    const match = onclickAttr.match(/switchSection\('([^']+)'/);
    if (match) {
      const secKey = match[1];
      if (secKey === 'users') {
        item.style.display = (currentUser.role === 'admin') ? 'flex' : 'none';
      } else if (isSiteManager) {
        item.style.display = allowedTabs.includes(secKey) ? 'flex' : 'none';
      } else {
        item.style.display = 'flex';
      }
    }
  });
}

function handleLogout() {
  localStorage.removeItem('token');
  localStorage.removeItem('activeSection');
  authToken = null;
  currentUser = null;
  showLoginOverlay();
}

// Navigation
function switchSection(sectionId, element) {
  // Access control check for site managers & allowed tabs
  if (currentUser) {
    if (currentUser.role === 'admin') {
      // Admin has access to all
    } else if (currentUser.role === 'site_manager') {
      if (sectionId === 'users') {
        sectionId = 'dashboard';
      }
      const allowedTabs = currentUser.allowed_tabs || ['dashboard', 'attendance', 'workers', 'projects', 'groups'];
      if (!allowedTabs.includes(sectionId)) {
        sectionId = allowedTabs[0] || 'attendance';
      }
    }
  }

  const target = document.getElementById(`section-${sectionId}`);
  if (!target) {
    sectionId = 'dashboard';
  }

  // Save active section preference
  localStorage.setItem('activeSection', sectionId);

  const sections = document.querySelectorAll('.app-section');
  sections.forEach(s => s.style.display = 'none');

  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(n => n.classList.remove('active'));

  const activeTarget = document.getElementById(`section-${sectionId}`);
  if (activeTarget) activeTarget.style.display = 'block';

  // Highlight active nav item
  if (!element) {
    element = document.querySelector(`.nav-item[onclick*="'${sectionId}'"]`);
  }
  if (element) element.classList.add('active');

  // Title update
  const titleMap = {
    'dashboard': 'Attendance Dashboard & Overview',
    'face-scanner': 'Face Recognition Attendance Scanner',
    'attendance': 'Daily Worker Attendance Logger',
    'workers': 'Construction Workers List',
    'projects': 'Construction Project Sites',
    'groups': 'Worker Groups',
    'users': 'Site Managers & Admin Accounts'
  };

  document.getElementById('pageTitle').innerText = titleMap[sectionId] || 'Attendance System';

  // Stop scanner camera if leaving face-scanner tab
  if (sectionId !== 'face-scanner') {
    stopFaceScannerCamera();
  }

  // Section specific triggers
  if (sectionId === 'dashboard') {
    loadDashboardStats();
    populateLookupWorkers();
    // Default date range to current month on first open
    const todayStr = getLocalDateString(new Date());
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const startEl = document.getElementById('lookupStartDate');
    const endEl = document.getElementById('lookupEndDate');
    if (startEl) { startEl.max = todayStr; if (!startEl.value) startEl.value = monthStart; }
    if (endEl) { endEl.max = todayStr; if (!endEl.value) endEl.value = todayStr; }
  }
  if (sectionId === 'face-scanner') initFaceScanner();
  if (sectionId === 'attendance') loadAttendanceSheet();
  if (sectionId === 'workers') loadWorkers();
  if (sectionId === 'projects') loadProjectsTable();
  if (sectionId === 'groups') loadGroupsTable();
  if (sectionId === 'users') loadUsersTable();


  // Close mobile sidebar if open
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  const toggleBtn = document.getElementById('sidebarToggleBtn');
  if (sidebar) sidebar.classList.remove('show');
  if (overlay) overlay.classList.remove('show');
  if (toggleBtn) toggleBtn.classList.remove('active');
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  const toggleBtn = document.getElementById('sidebarToggleBtn');
  if (sidebar) {
    sidebar.classList.toggle('show');
    const isShown = sidebar.classList.contains('show');
    if (overlay) {
      if (isShown) {
        overlay.classList.add('show');
      } else {
        overlay.classList.remove('show');
      }
    }
    if (toggleBtn) {
      toggleBtn.classList.toggle('active', isShown);
    }
  }
}

// Dashboard Stats
async function loadDashboardStats() {
  try {
    const stats = await apiFetch('/attendance/stats');
    document.getElementById('statTotalWorkers').innerText = stats.total_workers;
    document.getElementById('statPresent').innerText = stats.present;
    document.getElementById('statLate').innerText = stats.late;
    document.getElementById('statAbsent').innerText = stats.absent;
  } catch (err) {
    console.error("Dashboard error:", err);
  }
}


// ── Custom Worker Picker ──────────────────────────────────────────────
let _wpWorkers = [];   // full workers list cache

async function populateLookupWorkers() {
  try {
    _wpWorkers = await apiFetch('/workers');
    _buildWpList(_wpWorkers);
  } catch (err) {
    console.error('Could not load workers for lookup:', err);
  }
}

function _buildWpList(workers) {
  const list = document.getElementById('wpList');
  const empty = document.getElementById('wpEmpty');
  if (!list) return;

  list.innerHTML = '';
  if (!workers.length) {
    empty.style.display = 'flex';
    return;
  }
  empty.style.display = 'none';

  workers.forEach(w => {
    const img = (w.picture_url && w.picture_url.trim()) ? w.picture_url.trim() : DEFAULT_WORKER_IMG;
    const passport = w.passport_number || 'No Passport';
    const project = w.project_name || 'Unassigned';
    const group = w.group_name || '';

    const item = document.createElement('div');
    item.className = 'wp-item';
    item.setAttribute('role', 'option');
    item.setAttribute('data-id', w.id);
    item.setAttribute('data-name', w.name.toLowerCase());
    item.setAttribute('data-passport', passport.toLowerCase());
    item.innerHTML = `
      <img src="${img}" onerror="handleImgError(this)" class="wp-item-img" alt="">
      <div class="wp-item-info">
        <div class="wp-item-name">${w.name}</div>
        <div class="wp-item-meta">
          <span><i class="fa-solid fa-id-card"></i>${passport}</span>
          <span><i class="fa-solid fa-city"></i>${project}</span>
          ${group ? `<span><i class="fa-solid fa-layer-group"></i>${group}</span>` : ''}
        </div>
      </div>
      <i class="fa-solid fa-check wp-item-check"></i>
    `;
    item.addEventListener('click', () => selectWorkerPickerItem(w, img));
    list.appendChild(item);
  });
}

function toggleWorkerPicker(e) {
  e.stopPropagation();
  const panel = document.getElementById('workerPickerPanel');
  const trigger = document.getElementById('workerPickerTrigger');
  const chevron = document.getElementById('wpChevron');
  const search = document.getElementById('wpSearchInput');
  const isOpen = panel.classList.contains('wp-open');

  if (isOpen) {
    closeWorkerPicker();
  } else {
    panel.classList.add('wp-open');
    trigger.setAttribute('aria-expanded', 'true');
    trigger.classList.add('wp-active');
    chevron.style.transform = 'rotate(180deg)';
    // focus search box
    if (search) { search.value = ''; filterWorkerPicker(''); search.focus(); }
  }
}

function closeWorkerPicker() {
  const panel = document.getElementById('workerPickerPanel');
  const trigger = document.getElementById('workerPickerTrigger');
  const chevron = document.getElementById('wpChevron');
  if (!panel) return;
  panel.classList.remove('wp-open');
  trigger?.setAttribute('aria-expanded', 'false');
  trigger?.classList.remove('wp-active');
  if (chevron) chevron.style.transform = 'rotate(0deg)';
}

function filterWorkerPicker(query) {
  const q = query.toLowerCase().trim();
  const items = document.querySelectorAll('#wpList .wp-item');
  const empty = document.getElementById('wpEmpty');
  let visible = 0;
  items.forEach(item => {
    const name = item.getAttribute('data-name') || '';
    const passport = item.getAttribute('data-passport') || '';
    const match = !q || name.includes(q) || passport.includes(q);
    item.style.display = match ? '' : 'none';
    if (match) visible++;
  });
  empty.style.display = visible === 0 ? 'flex' : 'none';
}

function selectWorkerPickerItem(worker, imgSrc) {
  // Set hidden value
  document.getElementById('lookupWorkerSelect').value = worker.id;

  // Update trigger display
  const inner = document.getElementById('wpTriggerInner');
  inner.innerHTML = `
    <img src="${imgSrc}" onerror="handleImgError(this)" class="wp-selected-img" alt="">
    <div class="wp-selected-info">
      <div class="wp-selected-name">${worker.name}</div>
      <div class="wp-selected-sub">${worker.passport_number || ''} ${worker.project_name ? '· ' + worker.project_name : ''}</div>
    </div>
  `;

  // Highlight selected item
  document.querySelectorAll('#wpList .wp-item').forEach(el => {
    el.classList.toggle('wp-item-selected', el.getAttribute('data-id') === worker.id);
  });

  closeWorkerPicker();
  lookupWorkerDetails();
}

// Close picker when clicking outside
document.addEventListener('click', (e) => {
  if (!e.target.closest('#workerPicker')) closeWorkerPicker();
});


// Status badge helper
function _statusBadge(status) {
  const map = {
    'Present': ['badge-present', 'fa-circle-check'],
    'Late': ['badge-late', 'fa-clock-rotate-left'],
    'Absent': ['badge-absent', 'fa-user-xmark'],
    'Half-Day': ['badge-halfday', 'fa-circle-half-stroke'],
    'Pending': ['badge-pending', 'fa-clock'],
  };
  const [cls, icon] = map[status] || map['Pending'];
  return `<span class="badge ${cls}"><i class="fa-solid ${icon}"></i> ${status || 'Pending'}</span>`;
}

let _lastWorkerLookupData = null;
let _lookupDateSortDir = 'asc'; // 'asc' (oldest first) or 'desc' (newest first)

function toggleLookupDateSort() {
  _lookupDateSortDir = (_lookupDateSortDir === 'desc') ? 'asc' : 'desc';
  updateLookupDateSortHeaderUI();
  if (_lastWorkerLookupData && _lastWorkerLookupData.records) {
    renderLookupHistoryRows(_lastWorkerLookupData);
  }
}

function updateLookupDateSortHeaderUI() {
  const icon = document.getElementById('lookupDateSortIcon');
  const btn = document.getElementById('lookupDateSortBtn');
  if (icon) {
    if (_lookupDateSortDir === 'asc') {
      icon.className = 'fa-solid fa-arrow-up-1-9';
      icon.style.color = '#10B981';
    } else {
      icon.className = 'fa-solid fa-arrow-down-9-1';
      icon.style.color = '#3B82F6';
    }
  }
  if (btn) {
    btn.title = _lookupDateSortDir === 'asc' ? 'Sorted Ascending (Oldest first). Click to sort Descending' : 'Sorted Descending (Newest first). Click to sort Ascending';
  }
}

function renderLookupHistoryRows(data) {
  if (!data || !data.records) return;

  let records = [...data.records];
  if (_lookupDateSortDir === 'asc') {
    records.sort((a, b) => a.date.localeCompare(b.date));
  } else {
    records.sort((a, b) => b.date.localeCompare(a.date));
  }

  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const tbody = document.getElementById('lookupHistoryBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const rowsHtml = records.map((r, idx) => {
    const parts = r.date.split('-').map(Number);
    const dateObj = new Date(parts[0], parts[1] - 1, parts[2]);
    const dayName = DAYS[dateObj.getDay()];
    const dateDisplay = dateObj.toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' });
    const hours = (r.hours_worked && r.hours_worked > 0) ? r.hours_worked + ' hrs' : (r.check_in && r.check_out ? calculateHoursJS(r.check_in, r.check_out) + ' hrs' : '—');

    const isWeekend = (dateObj.getDay() === 0);
    const rowClass = isWeekend ? 'row-weekend' : '';
    const rowNum = _lookupDateSortDir === 'desc' ? (records.length - idx) : (idx + 1);

    return `
      <tr class="${rowClass}">
        <td class="lookup-row-num">${rowNum}</td>
        <td class="lookup-date-cell"><strong>${dateDisplay}</strong></td>
        <td class="lookup-day-cell ${isWeekend ? 'day-weekend' : ''}">${dayName}</td>
        <td>${_statusBadge(r.status)}</td>
        <td class="lookup-time-cell">${escapeHtml(r.check_in) || '<span class="text-muted">—</span>'}</td>
        <td class="lookup-time-cell">${escapeHtml(r.check_out) || '<span class="text-muted">—</span>'}</td>
        <td class="lookup-hours-cell">${hours}</td>
        <td class="lookup-vol-cell">${escapeHtml(r.work_volume) || '<span class="text-muted">—</span>'}</td>
        <td class="lookup-notes-cell">${escapeHtml(r.notes) || '<span class="text-muted">—</span>'}</td>
      </tr>`;
  }).join('');

  const totalsHtml = `
    <tr class="lookup-totals-row">
      <td colspan="6" style="text-align:right; font-weight:700; color:var(--primary);">
        <i class="fa-solid fa-sigma"></i> Totals
      </td>
      <td class="lookup-hours-cell"><strong>${data.total_hours} hrs</strong></td>
      <td colspan="2"></td>
    </tr>`;

  tbody.innerHTML = rowsHtml + totalsHtml;
}

// Worker Attendance History Lookup — Excel-style table
async function lookupWorkerDetails() {
  const workerId = document.getElementById('lookupWorkerSelect')?.value || '';
  const startDate = document.getElementById('lookupStartDate')?.value || '';
  const endDate = document.getElementById('lookupEndDate')?.value || '';

  const resultEl = document.getElementById('workerLookupResult');
  const emptyEl = document.getElementById('workerLookupEmpty');
  const placeholder = document.getElementById('workerLookupPlaceholder');

  resultEl.style.display = 'none';
  emptyEl.style.display = 'none';
  placeholder.style.display = 'none';

  if (!workerId) {
    placeholder.style.display = 'flex';
    return;
  }

  try {
    let url = `/attendance/worker/${workerId}`;
    const params = [];
    if (startDate) params.push(`start_date=${startDate}`);
    if (endDate) params.push(`end_date=${endDate}`);
    if (params.length) url += '?' + params.join('&');

    const data = await apiFetch(url);
    _lastWorkerLookupData = data;
    const records = data.records || [];

    if (records.length === 0) {
      emptyEl.style.display = 'flex';
      return;
    }

    const w = data.worker;
    const imgSrc = (w.picture_url && w.picture_url.trim()) ? w.picture_url.trim() : DEFAULT_WORKER_IMG;

    // Worker info bar
    document.getElementById('lookupWorkerInfoBar').innerHTML = `
      <img src="${imgSrc}" onerror="handleImgError(this)" class="lookup-worker-img" alt="Worker">
      <div>
        <div class="lookup-worker-name">${w.name}</div>
        <div class="lookup-worker-meta">
          <span><i class="fa-solid fa-id-card"></i> ${w.passport_number || 'No Passport'}</span>
          <span><i class="fa-solid fa-city"></i> ${w.project_name || 'Unassigned'}</span>
          <span><i class="fa-solid fa-layer-group"></i> ${w.group_name || 'General'}</span>
        </div>
      </div>
    `;

    // Summary chips
    const absentCount = records.filter(r => r.status === 'Absent' && !r.check_in).length;
    const lateCount = records.filter(r => r.status === 'Late').length;
    document.getElementById('lookupSummaryBar').innerHTML = `
      <div class="lookup-chip chip-total">
        <i class="fa-solid fa-calendar-days"></i>
        <span>${records.length} Records</span>
      </div>
      <div class="lookup-chip chip-present">
        <i class="fa-solid fa-circle-check"></i>
        <span>${data.days_worked} Days Worked</span>
      </div>
      <div class="lookup-chip chip-hours">
        <i class="fa-solid fa-clock"></i>
        <span>${data.total_hours} Total Hours</span>
      </div>
      <div class="lookup-chip chip-late">
        <i class="fa-solid fa-clock-rotate-left"></i>
        <span>${lateCount} Late</span>
      </div>
      <div class="lookup-chip chip-absent">
        <i class="fa-solid fa-user-xmark"></i>
        <span>${absentCount} Absent</span>
      </div>
    `;

    updateLookupDateSortHeaderUI();
    renderLookupHistoryRows(data);

    resultEl.style.display = 'block';
  } catch (err) {
    console.error('Lookup error:', err);
    emptyEl.style.display = 'flex';
  }
}


// Export / Print Worker Attendance History to PDF
function exportWorkerAttendancePDF() {
  if (!_lastWorkerLookupData || !_lastWorkerLookupData.records) {
    alert("Please search for a worker first before printing/exporting.");
    return;
  }

  const data = _lastWorkerLookupData;
  const w = data.worker || {};
  let records = [...(data.records || [])];
  if (_lookupDateSortDir === 'asc') {
    records.sort((a, b) => a.date.localeCompare(b.date));
  } else {
    records.sort((a, b) => b.date.localeCompare(a.date));
  }

  const startDate = document.getElementById('lookupStartDate')?.value || '';
  const endDate = document.getElementById('lookupEndDate')?.value || '';
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const printWin = window.open('', '_blank');
  if (!printWin) {
    alert("Please allow popups to generate the print / PDF report.");
    return;
  }

  const absentCount = records.filter(r => r.status === 'Absent' && !r.check_in).length;
  const lateCount = records.filter(r => r.status === 'Late').length;

  let rowsHtml = '';
  records.forEach((r, idx) => {
    const parts = r.date.split('-').map(Number);
    const dateObj = new Date(parts[0], parts[1] - 1, parts[2]);
    const dayName = DAYS[dateObj.getDay()];
    const isWeekend = (dateObj.getDay() === 0);
    const hours = (r.hours_worked && r.hours_worked > 0) ? r.hours_worked + ' hrs' : (r.check_in && r.check_out ? calculateHoursJS(r.check_in, r.check_out) + ' hrs' : '—');
    const statusColor = r.status === 'Present' ? '#10B981' : (r.status === 'Late' ? '#F59E0B' : (r.status === 'Half-Day' ? '#3B82F6' : '#EF4444'));
    const rowNum = _lookupDateSortDir === 'desc' ? (records.length - idx) : (idx + 1);

    rowsHtml += `
      <tr style="${isWeekend ? 'background-color: #FAF5FF;' : ''}">
        <td style="text-align:center; color:#64748B; padding:4px 6px;">${rowNum}</td>
        <td style="white-space:nowrap; padding:4px 7px;"><strong>${r.date}</strong></td>
        <td style="${isWeekend ? 'color:#7C3AED; font-weight:bold;' : ''} padding:4px 6px;">${dayName}</td>
        <td style="padding:4px 6px;"><span style="display:inline-block; padding:1.5px 7px; border-radius:3px; font-weight:600; font-size:10.5px; color:#fff; background-color:${statusColor};">${r.status || 'Absent'}</span></td>
        <td style="padding:4px 7px; white-space:nowrap;">${r.check_in || '—'}</td>
        <td style="padding:4px 7px; white-space:nowrap;">${r.check_out || '—'}</td>
        <td style="font-weight:bold; color:#D97706; padding:4px 7px; white-space:nowrap;">${hours}</td>
        <td style="padding:4px 7px;">${r.work_volume || '—'}</td>
        <td style="padding:4px 7px;">${r.notes || '—'}</td>
      </tr>
    `;
  });

  printWin.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Attendance History - ${w.name || 'Worker'}</title>
      <style>
        @page { margin: 8mm 10mm; }
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; margin: 0; padding: 0; color: #0F172A; font-size: 11px; line-height: 1.3; }
        .header { text-align: center; border-bottom: 1.5px solid #0F172A; padding-bottom: 5px; margin-bottom: 8px; }
        .header h1 { margin: 0; color: #0F172A; font-size: 17.5px; letter-spacing: 0.3px; text-transform: uppercase; }
        .header p { margin: 2px 0 0 0; color: #64748B; font-size: 11.5px; font-weight: 500; }
        .info-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px 18px; background: #F8FAFC; padding: 7px 12px; border-radius: 5px; border: 1px solid #E2E8F0; margin-bottom: 8px; font-size: 11.5px; }
        .summary-bar { display: flex; gap: 8px; margin-bottom: 8px; }
        .chip { flex: 1; padding: 4.5px 8px; border-radius: 4px; background: #F1F5F9; text-align: center; font-size: 11px; font-weight: bold; }
        table { width: 100%; border-collapse: collapse; margin-top: 5px; font-size: 11px; }
        th, td { padding: 4px 7px; text-align: left; border-bottom: 1px solid #E2E8F0; }
        th { background-color: #0F172A; color: #FFFFFF; font-weight: 600; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.3px; }
        .totals-row td { font-weight: bold; background-color: #F1F5F9; border-top: 1.5px solid #0F172A; padding: 6px 7px; }
        @media print {
          body { margin: 0; }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>Mohammad Construction & Engineering Sdn.Bhd.</h1>
        <p>Worker Attendance History Report</p>
      </div>

      <div class="info-grid">
        <div><strong>Worker Name:</strong> ${w.name || 'N/A'}</div>
        <div><strong>Passport / ID:</strong> ${w.passport_number || 'N/A'}</div>
        <div><strong>Project Site:</strong> ${w.project_name || 'Unassigned'}</div>
        <div><strong>Worker Group:</strong> ${w.group_name || 'General'}</div>
        <div><strong>Report Period:</strong> ${startDate || 'Start'} to ${endDate || 'Today'}</div>
        <div><strong>Generated Date:</strong> ${new Date().toLocaleString()}</div>
      </div>

      <div class="summary-bar">
        <div class="chip" style="color:#0F172A;">Total Records: ${records.length}</div>
        <div class="chip" style="color:#10B981;">Days Worked: ${data.days_worked}</div>
        <div class="chip" style="color:#D97706;">Total Hours: ${data.total_hours} hrs</div>
        <div class="chip" style="color:#F59E0B;">Late: ${lateCount}</div>
        <div class="chip" style="color:#EF4444;">Absent: ${absentCount}</div>
      </div>

      <table>
        <thead>
          <tr>
            <th style="width:30px; text-align:center;">#</th>
            <th style="white-space:nowrap;">Date</th>
            <th>Day</th>
            <th>Status</th>
            <th>Check-In</th>
            <th>Check-Out</th>
            <th>Hours Worked</th>
            <th>Work Volume</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
          <tr class="totals-row">
            <td colspan="6" style="text-align:right;">TOTAL HOURS WORKED:</td>
            <td style="color:#D97706;">${data.total_hours} hrs</td>
            <td colspan="2"></td>
          </tr>
        </tbody>
      </table>
    </body>
    </html>
  `);

  printWin.document.close();
  printWin.focus();
  setTimeout(() => {
    printWin.print();
  }, 500);
}

// ==========================================
// BULK WORKER ATTENDANCE HISTORY & MATRIX
// ==========================================
let _bulkAttendanceHistoryMode = 'individual';
let _lastBulkMatrixData = null;
let _selectedBulkWorkerIds = new Set();

function switchAttendanceHistoryMode(mode) {
  _bulkAttendanceHistoryMode = mode;
  const tabInd = document.getElementById('modeTabIndividual');
  const tabBulk = document.getElementById('modeTabBulk');
  const viewInd = document.getElementById('attendanceModeIndividual');
  const viewBulk = document.getElementById('attendanceModeBulk');

  if (mode === 'bulk') {
    tabInd?.classList.remove('active');
    tabBulk?.classList.add('active');
    if (viewInd) viewInd.style.display = 'none';
    if (viewBulk) viewBulk.style.display = 'block';

    initBulkAttendanceMode();
  } else {
    tabBulk?.classList.remove('active');
    tabInd?.classList.add('active');
    if (viewBulk) viewBulk.style.display = 'none';
    if (viewInd) viewInd.style.display = 'block';
  }
}

async function initBulkAttendanceMode() {
  const startEl = document.getElementById('bulkLookupStartDate');
  const endEl = document.getElementById('bulkLookupEndDate');

  if (startEl && !startEl.value) {
    startEl.value = get16thCycleStartDate();
  }
  if (endEl && !endEl.value) {
    endEl.value = getLocalDateString(new Date());
  }

  try {
    if (!window._projectsData) {
      window._projectsData = await apiFetch('/projects');
    }
    if (!window._groupsData) {
      window._groupsData = await apiFetch('/groups');
    }
    if (!window._workersData) {
      window._workersData = await apiFetch('/workers');
    }
  } catch (e) {
    console.error('Error fetching dropdown options for bulk attendance:', e);
  }

  const projSelect = document.getElementById('bulkLookupProjectSelect');
  if (projSelect) {
    const curVal = projSelect.value || 'All';
    let opts = '<option value="All">All Projects</option>';
    if (window._projectsData && window._projectsData.length) {
      opts += window._projectsData.map(p => `<option value="${escapeHtml(p.name)}">${escapeHtml(p.name)}</option>`).join('');
    }
    projSelect.innerHTML = opts;
    projSelect.value = curVal;
  }

  const groupSelect = document.getElementById('bulkLookupGroupSelect');
  if (groupSelect) {
    const curVal = groupSelect.value || 'All';
    let opts = '<option value="All">All Groups</option>';
    if (window._groupsData && window._groupsData.length) {
      opts += window._groupsData.map(g => `<option value="${escapeHtml(g.name)}">${escapeHtml(g.name)}</option>`).join('');
    }
    groupSelect.innerHTML = opts;
    groupSelect.value = curVal;
  }

  renderBulkWorkerList();
}

function onBulkFilterChange() {
  renderBulkWorkerList();
}

function renderBulkWorkerList(searchQuery = '') {
  const pFilter = document.getElementById('bulkLookupProjectSelect')?.value || 'All';
  const gFilter = document.getElementById('bulkLookupGroupSelect')?.value || 'All';
  const q = searchQuery.toLowerCase().trim();

  const container = document.getElementById('bulkWpList');
  if (!container) return;

  let workers = Array.isArray(window._workersData) ? window._workersData : [];
  if (pFilter !== 'All') {
    workers = workers.filter(w => (w.project_name || '') === pFilter);
  }
  if (gFilter !== 'All') {
    workers = workers.filter(w => (w.group_name || '') === gFilter);
  }
  if (q) {
    workers = workers.filter(w => 
      (w.name || '').toLowerCase().includes(q) || 
      (w.passport_number || '').toLowerCase().includes(q)
    );
  }

  if (workers.length === 0) {
    container.innerHTML = '<div style="padding:0.5rem; color:var(--text-muted); text-align:center; font-size:0.82rem;">No matching workers found</div>';
    updateBulkWorkerPickerText();
    return;
  }

  let html = '';
  workers.forEach(w => {
    const isChecked = _selectedBulkWorkerIds.size === 0 || _selectedBulkWorkerIds.has(w.id);
    html += `
      <label class="bulk-worker-item">
        <input type="checkbox" value="${w.id}" ${isChecked ? 'checked' : ''} onchange="toggleBulkWorkerSelection('${w.id}', this.checked)">
        <span style="font-weight:600;">${escapeHtml(w.name)}</span>
        <span style="font-size:0.75rem; color:var(--text-muted); margin-left:auto;">${escapeHtml(w.passport_number || '')}</span>
      </label>
    `;
  });
  container.innerHTML = html;
  updateBulkWorkerPickerText();
}

function toggleBulkWorkerSelection(wid, isChecked) {
  if (isChecked) {
    _selectedBulkWorkerIds.add(wid);
  } else {
    _selectedBulkWorkerIds.delete(wid);
  }
  updateBulkWorkerPickerText();
}

function selectAllBulkWorkers(selectState) {
  const container = document.getElementById('bulkWpList');
  if (!container) return;
  const checkboxes = container.querySelectorAll('input[type="checkbox"]');
  checkboxes.forEach(cb => {
    cb.checked = selectState;
    if (selectState) {
      _selectedBulkWorkerIds.add(cb.value);
    } else {
      _selectedBulkWorkerIds.delete(cb.value);
    }
  });
  updateBulkWorkerPickerText();
}

function updateBulkWorkerPickerText() {
  const textEl = document.getElementById('bulkWorkerPickerText');
  if (!textEl) return;
  const total = (window._workersData || []).length;
  const selectedCount = _selectedBulkWorkerIds.size;

  if (selectedCount === 0 || selectedCount === total) {
    textEl.textContent = 'All Workers Selected';
  } else {
    textEl.textContent = `${selectedCount} Workers Selected`;
  }
}

function toggleBulkWorkerPicker(e) {
  e.stopPropagation();
  const panel = document.getElementById('bulkWorkerPickerPanel');
  const trigger = document.getElementById('bulkWorkerPickerTrigger');
  if (!panel) return;

  const isOpen = panel.classList.contains('wp-open') || panel.style.display === 'block';

  if (isOpen) {
    panel.classList.remove('wp-open');
    panel.style.display = 'none';
    trigger?.classList.remove('wp-active');
  } else {
    if (!window._workersData) {
      initBulkAttendanceMode();
    } else {
      renderBulkWorkerList();
    }
    panel.style.display = 'block';
    panel.classList.add('wp-open');
    trigger?.classList.add('wp-active');
    document.addEventListener('click', closeBulkWorkerPickerOutside);
  }
}

function closeBulkWorkerPickerOutside(e) {
  const picker = document.getElementById('bulkWorkerPicker');
  if (picker && !picker.contains(e.target)) {
    const panel = document.getElementById('bulkWorkerPickerPanel');
    const trigger = document.getElementById('bulkWorkerPickerTrigger');
    if (panel) {
      panel.classList.remove('wp-open');
      panel.style.display = 'none';
    }
    if (trigger) trigger.classList.remove('wp-active');
    document.removeEventListener('click', closeBulkWorkerPickerOutside);
  }
}

function filterBulkWorkerPicker(q) {
  renderBulkWorkerList(q);
}


async function lookupBulkWorkerDetails() {
  const pFilter = document.getElementById('bulkLookupProjectSelect')?.value || 'All';
  const gFilter = document.getElementById('bulkLookupGroupSelect')?.value || 'All';
  const startDate = document.getElementById('bulkLookupStartDate')?.value || '';
  const endDate = document.getElementById('bulkLookupEndDate')?.value || '';

  const resultEl = document.getElementById('bulkWorkerResult');
  const emptyEl = document.getElementById('bulkWorkerEmpty');
  const placeholderEl = document.getElementById('bulkWorkerPlaceholder');

  resultEl.style.display = 'none';
  emptyEl.style.display = 'none';
  placeholderEl.style.display = 'none';

  try {
    const params = [];
    if (startDate) params.push(`start_date=${startDate}`);
    if (endDate) params.push(`end_date=${endDate}`);
    if (pFilter !== 'All') params.push(`project_name=${encodeURIComponent(pFilter)}`);
    if (gFilter !== 'All') params.push(`group_name=${encodeURIComponent(gFilter)}`);

    if (_selectedBulkWorkerIds.size > 0) {
      params.push(`worker_ids=${Array.from(_selectedBulkWorkerIds).join(',')}`);
    }

    const url = `/attendance/bulk-history` + (params.length ? '?' + params.join('&') : '');
    const data = await apiFetch(url);
    _lastBulkMatrixData = data;

    const workers = data.workers || [];
    const dates = data.dates || [];
    const matrix = data.matrix || {};

    if (workers.length === 0 || dates.length === 0) {
      emptyEl.style.display = 'flex';
      return;
    }

    const startFmt = data.start_date.split('-').reverse().join('.');
    const endFmt = data.end_date.split('-').reverse().join('.');
    document.getElementById('bulkMatrixSummaryText').innerHTML = `
      <i class="fa-solid fa-layer-group" style="color:var(--accent-gold); margin-right:6px;"></i>
      <span>${escapeHtml(data.banner)}</span>
      <span style="margin: 0 8px; opacity:0.4;">|</span>
      <span>${workers.length} Workers</span>
      <span style="margin: 0 8px; opacity:0.4;">|</span>
      <span>${dates.length} Days (${startFmt} - ${endFmt})</span>
      <span style="margin: 0 8px; opacity:0.4;">|</span>
      <span style="color:#D97706; font-weight:700;">${data.grand_total_hours} Total Hours</span>
    `;

    const totalCols = 4 + dates.length;
    let theadHtml = `
      <tr>
        <th style="width:45px;">NO.</th>
        <th style="min-width:180px; text-align:left;">NAME</th>
        <th style="min-width:120px;">PASSPORT No.</th>
        ${dates.map(d => `<th class="${d.is_sunday ? 'th-sunday' : ''}">${d.formatted}<br>${d.day}</th>`).join('')}
        <th style="min-width:110px; background-color:#FEF08A; color:#713F12;">TOTAL HOURS</th>
      </tr>
      <tr class="banner-row">
        <th colspan="${totalCols}">${escapeHtml(data.banner)}</th>
      </tr>
    `;
    document.getElementById('bulkMatrixThead').innerHTML = theadHtml;

    let tbodyHtml = '';
    workers.forEach((w, idx) => {
      const wid = w.id;
      const w_data = matrix[wid] || { daily_hours: {}, total_hours: 0 };
      const d_hours = w_data.daily_hours || {};
      const tot = w_data.total_hours || 0;

      const dailyCells = dates.map(d => {
        const val = d_hours[d.date] || 0;
        const valDisplay = val > 0 ? (Number.isInteger(val) ? val : val.toFixed(1)) : '0';
        return `<td class="${d.is_sunday ? 'td-sunday' : ''}">${valDisplay}</td>`;
      }).join('');

      const totDisplay = Number.isInteger(tot) ? tot : tot.toFixed(1);

      tbodyHtml += `
        <tr>
          <td class="col-no">${idx + 1}</td>
          <td class="col-name">${escapeHtml((w.name || '').toUpperCase())}</td>
          <td class="col-passport">${escapeHtml(w.passport_number || '—')}</td>
          ${dailyCells}
          <td class="col-total">${totDisplay}</td>
        </tr>
      `;
    });
    document.getElementById('bulkMatrixTbody').innerHTML = tbodyHtml;

    resultEl.style.display = 'block';
  } catch (err) {
    console.error('Bulk lookup error:', err);
    emptyEl.style.display = 'flex';
  }
}

async function exportBulkAttendanceExcel() {
  if (!_lastBulkMatrixData) {
    alert("Please generate matrix first before exporting.");
    return;
  }
  const data = _lastBulkMatrixData;
  const pFilter = document.getElementById('bulkLookupProjectSelect')?.value || 'All';
  const gFilter = document.getElementById('bulkLookupGroupSelect')?.value || 'All';

  const body = {
    start_date: data.start_date,
    end_date: data.end_date,
    project_name: pFilter,
    group_name: gFilter,
    title_banner: data.banner
  };

  if (_selectedBulkWorkerIds.size > 0) {
    body.worker_ids = Array.from(_selectedBulkWorkerIds);
  }

  try {
    const token = authToken || localStorage.getItem('token');
    const res = await fetch('/api/attendance/export-bulk-excel', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      throw new Error('Export failed');
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Worker_Attendance_Matrix_${data.start_date}_to_${data.end_date}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('Excel export error:', err);
    alert('Failed to export Excel file. Please try again.');
  }
}



function exportBulkAttendancePDF() {
  if (!_lastBulkMatrixData) {
    alert("Please generate matrix first before printing.");
    return;
  }
  const data = _lastBulkMatrixData;
  const workers = data.workers || [];
  const dates = data.dates || [];
  const matrix = data.matrix || {};

  const printWin = window.open('', '_blank');
  if (!printWin) {
    alert("Pop-up blocked. Please allow pop-ups to print PDF.");
    return;
  }

  const dateThs = dates.map(d => `<th class="${d.is_sunday ? 'sun-header' : ''}">${d.formatted}<br>${d.day}</th>`).join('');

  let rowsHtml = '';
  workers.forEach((w, idx) => {
    const wid = w.id;
    const w_data = matrix[wid] || { daily_hours: {}, total_hours: 0 };
    const d_hours = w_data.daily_hours || {};
    const tot = w_data.total_hours || 0;

    const dailyCells = dates.map(d => {
      const val = d_hours[d.date] || 0;
      const valDisplay = val > 0 ? (Number.isInteger(val) ? val : val.toFixed(1)) : '0';
      return `<td class="${d.is_sunday ? 'sun-cell' : ''}">${valDisplay}</td>`;
    }).join('');

    rowsHtml += `
      <tr>
        <td style="text-align:center;">${idx + 1}</td>
        <td class="name-cell">${escapeHtml((w.name || '').toUpperCase())}</td>
        <td style="text-align:center;">${escapeHtml(w.passport_number || '—')}</td>
        ${dailyCells}
        <td class="total-cell">${tot}</td>
      </tr>
    `;
  });

  const totalCols = 4 + dates.length;

  printWin.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Attendance Matrix Report</title>
      <style>
        @page { size: A4 landscape; margin: 10mm; }
        body { font-family: Arial, sans-serif; font-size: 10px; color: #000; margin: 0; padding: 10px; }
        .title { font-size: 16px; font-weight: bold; color: #1F497D; }
        .subtitle { font-size: 12px; font-weight: bold; color: #595959; margin-bottom: 10px; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 9px; }
        th, td { border: 1px solid #999; padding: 4px 5px; text-align: center; }
        th { background: #F2F2F2; font-weight: bold; }
        .sun-header { color: #DC2626 !important; background: #FEF2F2 !important; }
        .sun-cell { color: #DC2626; font-weight: bold; }
        .banner-row { background: #E2E8F0 !important; font-size: 11px; font-weight: bold; }
        .name-cell { text-align: left; font-weight: bold; background: #D9E1F2; }
        .total-cell { font-weight: bold; background: #FFFF00; }
      </style>
    </head>
    <body>
      <div class="title">MOHAMMAD CONSTRUCTION & ENGINEERING SDN.BHD.</div>
      <div class="subtitle">WORKER ATTENDANCE HISTORY REPORT (Period: ${data.start_date} to ${data.end_date})</div>
      
      <table>
        <thead>
          <tr>
            <th>NO.</th>
            <th style="text-align:left;">NAME</th>
            <th>PASSPORT No.</th>
            ${dateThs}
            <th style="background:#FFFF00;">TOTAL HOURS</th>
          </tr>
          <tr class="banner-row">
            <th colspan="${totalCols}">${escapeHtml(data.banner)}</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    </body>
    </html>
  `);

  printWin.document.close();
  printWin.focus();
  setTimeout(() => { printWin.print(); }, 500);
}

// Option Loader Helpers
async function loadProjectOptions() {

  try {
    const projects = await apiFetch('/projects');
    const selects = ['attendanceProjectFilter', 'workerProjectFilter', 'workerProject'];

    const isSiteManagerHasProj = currentUser && currentUser.role === 'site_manager' && currentUser.assigned_project_id;

    selects.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const val = el.value;
      const defaultOption = id.includes('Filter') ? '<option value="">All Active Projects</option>' : '<option value="">Select Project</option>';
      const projOptions = projects.map(p => {
        const locStr = p.location ? ` (${p.location})` : '';
        return `<option value="${p.id}">${escapeHtml(p.name)}${escapeHtml(locStr)}</option>`;
      }).join('');
      el.innerHTML = defaultOption + projOptions;

      if (isSiteManagerHasProj) {
        el.value = currentUser.assigned_project_id;
        el.disabled = true;
        el.style.opacity = '0.75';
        el.title = `Locked to your assigned site: ${currentUser.assigned_project_name || 'Assigned Site'}`;
      } else {
        el.disabled = false;
        el.style.opacity = '1';
        if (val) el.value = val;
      }
    });
  } catch (err) { console.error("Error loading project options", err); }
}

async function loadGroupOptions() {
  try {
    const groups = await apiFetch('/groups');
    const selects = ['attendanceGroupFilter', 'workerGroupFilter', 'workerGroup'];

    selects.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const val = el.value;
      const defaultOption = id.includes('Filter') ? '<option value="">All Worker Groups</option>' : '<option value="">Select Group</option>';
      const groupOptions = groups.map(g => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join('');
      el.innerHTML = defaultOption + groupOptions;
      el.value = val;
    });
  } catch (err) { console.error("Error loading group options", err); }
}

const DEFAULT_WORKER_IMG = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAiIGhlaWdodD0iMTAwIiB2aWV3Qm94PSIwIDAgMjQgMjQiIGZpbGw9IiM5NEEzQjgiPjxwYXRoIGQ9Ik0xMiAyQzYuNDggMiAyIDYuNDggMiAxMnM0LjQ4IDEwIDEwIDEwIDEwLTQuNDggMTAtMTBTMTcuNTIgMiAxMiAyem0wIDRjMS45MyAwIDMuNSAxLjU3IDMuNSAzLjVTMTMuOTMgMTMgMTIgMTNzLTMuNS0xLjU3LTMuNS0zLjVTMTAuMDcgNiAxMiA2em0wIDE4Yy0yLjAzIDAtMy44LS44NS01LjA1LTIuMi4wMy0xLjY4IDMuMzctMi42IDUuMDUtMi42czUuMDIuOTIgNS4wNSAyLjZDMTUuOCAxOS4xNSAxNC4wMyAyMCAxMiAyMHoiLz48L3N2Zz4=";

window.handleImgError = function (img) {
  img.onerror = null;
  img.src = DEFAULT_WORKER_IMG;
};

function calculateHoursJS(inStr, outStr) {
  if (!inStr || !outStr) return 0;
  const parts1 = inStr.split(':').map(Number);
  const parts2 = outStr.split(':').map(Number);
  if (parts1.length < 2 || parts2.length < 2 || isNaN(parts1[0]) || isNaN(parts2[0])) return 0;
  let t1 = parts1[0] * 60 + parts1[1];
  let t2 = parts2[0] * 60 + parts2[1];
  let diff = t2 - t1;
  if (diff < 0) diff += 24 * 60; // Overnight shift
  return Math.round((diff / 60) * 100) / 100;
}

function getCurrentTimeStr() {
  const now = new Date();
  const hrs = String(now.getHours()).padStart(2, '0');
  const mins = String(now.getMinutes()).padStart(2, '0');
  return `${hrs}:${mins}`;
}

function setCheckInNow(workerId) {
  const timeInput = document.getElementById(`in_${workerId}`);
  if (timeInput) {
    timeInput.value = getCurrentTimeStr();
    updateRowHours(workerId);
  }
}

function setCheckOutNow(workerId) {
  const timeInput = document.getElementById(`out_${workerId}`);
  if (timeInput) {
    timeInput.value = getCurrentTimeStr();
    updateRowHours(workerId);
  }
}

function resetCheckIn(workerId) {
  const timeInput = document.getElementById(`in_${workerId}`);
  if (timeInput) {
    timeInput.value = '';
    updateRowHours(workerId);
  }
}

function resetCheckOut(workerId) {
  const timeInput = document.getElementById(`out_${workerId}`);
  if (timeInput) {
    timeInput.value = '';
    updateRowHours(workerId);
  }
}

function setElementState(el, enabled, defaultTitle, disabledTitle, isButton = false) {
  if (!el) return;
  el.disabled = !enabled;
  el.style.opacity = enabled ? '1' : '0.5';
  el.style.cursor = enabled ? (isButton ? 'pointer' : 'auto') : 'not-allowed';
  el.title = enabled ? defaultTitle : disabledTitle;
}

function updateRowHours(workerId) {
  const inEl = document.getElementById(`in_${workerId}`);
  const outEl = document.getElementById(`out_${workerId}`);
  const volEl = document.getElementById(`vol_${workerId}`);
  const hoursEl = document.getElementById(`hours_${workerId}`);

  if (!inEl) return;
  const inVal = inEl.value;

  const attRecord = currentAttendanceMap[workerId] || {};
  const isSiteManager = currentUser && currentUser.role === 'site_manager';
  const isLocked = attRecord.is_locked || (isSiteManager && attRecord.is_older_than_24h);

  const dbCheckIn = attRecord.check_in || '';
  const dbCheckOut = attRecord.check_out || '';
  const isSavedInDb = Boolean((dbCheckIn && dbCheckIn.trim()) || (dbCheckOut && dbCheckOut.trim()));

  if (!isLocked) {
    const disabledMsg = 'Save Check-In to database first';
    if (!isSavedInDb && outEl) outEl.value = '';

    setElementState(outEl, isSavedInDb, '', disabledMsg);
    setElementState(volEl, isSavedInDb, '', disabledMsg);
    setElementState(document.getElementById(`btn_out_now_${workerId}`), isSavedInDb, 'Set Check-Out to Current Time', disabledMsg, true);
    setElementState(document.getElementById(`btn_out_reset_${workerId}`), isSavedInDb, 'Reset/Clear Check-Out Time', disabledMsg, true);
    setElementState(document.getElementById(`btn_out_confirm_${workerId}`), isSavedInDb, 'Confirm Check-Out Time', disabledMsg, true);
  }

  const outVal = outEl ? outEl.value : '';
  const hours = calculateHoursJS(inVal, outVal);
  if (hoursEl) hoursEl.innerText = `${hours} hrs`;
  const hoursMobileEl = document.getElementById(`hours_mobile_${workerId}`);
  if (hoursMobileEl) hoursMobileEl.innerHTML = `<i class="fa-solid fa-clock"></i> ${hours} hrs`;
}

let currentAttendanceMap = {};

function getTakenTimeText(isoStr, isOlderThan24h = false, isLocked = false) {
  if (isLocked) {
    return 'Locked (>24h)';
  }
  if (!isoStr) return 'Not recorded';
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return 'Not recorded';
    const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
    const dateStr = d.toLocaleDateString([], { month: 'short', day: 'numeric' });

    if (isOlderThan24h) {
      return `Recorded: ${dateStr} ${timeStr} (>24h)`;
    }
    return `Recorded: ${dateStr} ${timeStr}`;
  } catch (e) {
    return 'Not recorded';
  }
}

function buildStatusBadgeHtml(checkInVal, checkOutVal, isLocked, recordedText) {
  let cls = 'badge-absent';
  let icon = 'fa-user-xmark';
  let text = 'Absent';

  if (isLocked) {
    cls = 'badge-locked';
    icon = 'fa-lock';
    text = 'Locked';
  } else if (checkInVal && checkOutVal) {
    cls = 'badge-present';
    icon = 'fa-check';
    text = `${escapeHtml(checkInVal)} - ${escapeHtml(checkOutVal)}`;
  } else if (checkInVal) {
    cls = 'badge-present';
    icon = 'fa-user-check';
    text = `In: ${escapeHtml(checkInVal)}`;
  }

  const tooltipAttr = escapeHtml(recordedText || '');
  return `<span class="badge ${cls} status-badge-hover" title="${tooltipAttr}"><i class="fa-solid ${icon}"></i> ${text}<span class="badge-tooltip-popup"><i class="fa-solid fa-clock-rotate-left"></i> ${tooltipAttr}</span></span>`;
}

let allWorkerCardsExpanded = false;

function toggleWorkerCard(workerId) {
  if (window.innerWidth > 768) return;
  const row = document.getElementById(`row_${workerId}`);
  if (row) {
    row.classList.toggle('expanded');
  }
}

function toggleAllWorkerCards() {
  const rows = document.querySelectorAll('.attendance-row');
  allWorkerCardsExpanded = !allWorkerCardsExpanded;
  rows.forEach(r => {
    if (allWorkerCardsExpanded) {
      r.classList.add('expanded');
    } else {
      r.classList.remove('expanded');
    }
  });
  const lbl = document.getElementById('lblToggleExpandAll');
  if (lbl) lbl.innerText = allWorkerCardsExpanded ? 'Collapse All' : 'Expand All';
}

function getLocalDateString(d = new Date()) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function stepAttendanceDate(delta) {
  const dateInput = document.getElementById('attendanceDate');
  if (!dateInput) return;
  const todayStr = getLocalDateString(new Date());
  dateInput.max = todayStr;

  if (delta === 0) {
    dateInput.value = todayStr;
  } else {
    const curVal = dateInput.value || todayStr;
    const parts = curVal.split('-').map(Number);
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    d.setDate(d.getDate() + delta);
    const nextStr = getLocalDateString(d);
    if (nextStr > todayStr) {
      alert("Future dates are disabled for attendance logging.");
      dateInput.value = todayStr;
      loadAttendanceSheet();
      return;
    }
    dateInput.value = nextStr;
  }
  loadAttendanceSheet();
}

function updateDateBanner(targetDateStr) {
  const banner = document.getElementById('attendanceDateBanner');
  const icon = document.getElementById('dateBannerIcon');
  const tag = document.getElementById('dateBannerTag');
  const title = document.getElementById('dateBannerTitle');

  if (!targetDateStr || !banner) return;

  const todayStr = getLocalDateString(new Date());
  const parts = targetDateStr.split('-').map(Number);
  const selectedDate = new Date(parts[0], parts[1] - 1, parts[2]);

  const formattedDate = selectedDate.toLocaleDateString('en-MY', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });

  if (targetDateStr < todayStr) {
    banner.className = 'attendance-date-banner banner-past';
    if (icon) icon.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i>`;
    if (tag) tag.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> EDITING PREVIOUS DATE`;
    if (title) title.innerText = formattedDate;
  } else {
    banner.className = 'attendance-date-banner banner-today';
    if (icon) icon.innerHTML = `<i class="fa-solid fa-calendar-check"></i>`;
    if (tag) tag.innerHTML = `<i class="fa-solid fa-circle-check"></i> TODAY'S ATTENDANCE SHEET`;
    if (title) title.innerText = formattedDate;
  }
}

/// Daily Attendance Sheet
async function loadAttendanceSheet() {
  const todayStr = getLocalDateString(new Date());
  const dateInput = document.getElementById('attendanceDate');
  if (dateInput) {
    dateInput.max = todayStr;
    if (dateInput.value > todayStr) {
      alert("Future dates are disabled for attendance logging.");
      dateInput.value = todayStr;
    }
  }
  const targetDate = (dateInput && dateInput.value) ? dateInput.value : todayStr;
  const projectFilter = document.getElementById('attendanceProjectFilter').value;
  const groupFilter = document.getElementById('attendanceGroupFilter').value;

  // Toggle Next Day buttons enabled/disabled state based on todayStr
  const nextBtns = document.querySelectorAll('button[onclick*="stepAttendanceDate(1)"]');
  nextBtns.forEach(btn => {
    if (targetDate >= todayStr) {
      btn.disabled = true;
      btn.style.opacity = '0.4';
      btn.style.cursor = 'not-allowed';
      btn.title = "Future dates are disabled";
    } else {
      btn.disabled = false;
      btn.style.opacity = '1';
      btn.style.cursor = 'pointer';
      btn.title = "Next Day";
    }
  });

  updateDateBanner(targetDate);

  allWorkerCardsExpanded = false;
  const lblToggle = document.getElementById('lblToggleExpandAll');
  if (lblToggle) lblToggle.innerText = 'Expand All';

  currentAttendanceMap = {};

  try {
    const data = await apiFetch(`/attendance?date=${targetDate}&project_id=${projectFilter}&group_id=${groupFilter}`);
    const tbody = document.getElementById('attendanceTableBody');
    tbody.innerHTML = '';

    const filteredCount = (data && data.records) ? data.records.length : 0;
    let totalCount = 0;
    if (!projectFilter && !groupFilter) {
      totalCount = filteredCount;
    } else if (_cachedAllWorkers !== null) {
      totalCount = _cachedAllWorkers.length;
    } else {
      const allW = await fetchAllWorkersCache();
      totalCount = allW.length;
    }

    const attFEl = document.getElementById('attFilteredCount');
    if (attFEl) attFEl.innerText = filteredCount;
    const attTEl = document.getElementById('attTotalCount');
    if (attTEl) attTEl.innerText = totalCount;

    if (!data.records || data.records.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:2rem; color:var(--text-muted);">No construction workers found matching filters.</td></tr>`;
      return;
    }

    const isSiteManager = currentUser && currentUser.role === 'site_manager';
    const isAdmin = currentUser && currentUser.role === 'admin';

    const rowsHtml = data.records.map(item => {
      const w = item.worker;
      const a = item.attendance;
      currentAttendanceMap[w.id] = { worker: w, ...a };

      const imgSrc = (w.picture_url && w.picture_url.trim()) ? w.picture_url.trim() : DEFAULT_WORKER_IMG;

      const checkInVal = a.check_in || '';
      const checkOutVal = a.check_out || '';
      const displayHours = (a.hours_worked && a.hours_worked > 0) ? a.hours_worked : calculateHoursJS(checkInVal, checkOutVal);

      const isCheckInSavedInDb = Boolean(checkInVal && checkInVal.trim());
      const isCheckOutSavedInDb = Boolean(checkOutVal && checkOutVal.trim());
      const isSavedInDb = isCheckInSavedInDb || isCheckOutSavedInDb;
      const isLocked = a.is_locked || (isSiteManager && a.is_older_than_24h);
      const isOlderThan24h = a.is_older_than_24h || false;

      const inDisabledAttr = isLocked ? 'disabled style="opacity:0.6; cursor:not-allowed;" title="Editing locked (>24h)"' : '';

      let outDisabledAttr = '';
      let volDisabledAttr = '';
      if (isLocked) {
        outDisabledAttr = 'disabled style="opacity:0.6; cursor:not-allowed;" title="Editing locked (>24h)"';
        volDisabledAttr = 'disabled style="opacity:0.6; cursor:not-allowed;" title="Editing locked (>24h)"';
      } else if (!isSavedInDb) {
        outDisabledAttr = 'disabled style="opacity:0.5; cursor:not-allowed;" title="Save Check-In to database first"';
        volDisabledAttr = 'disabled style="opacity:0.5; cursor:not-allowed;" title="Save Check-In to database first"';
      }

      const recordedText = getTakenTimeText(a.recorded_at || a.updated_at, isOlderThan24h, isLocked);
      const statusBadgeHtml = buildStatusBadgeHtml(checkInVal, checkOutVal, isLocked, recordedText);

      let confirmInBtnHtml = '';
      let confirmOutBtnHtml = '';
      if (isLocked) {
        confirmInBtnHtml = `<button type="button" class="btn btn-secondary btn-sm confirm-btn" id="btn_in_confirm_${w.id}" disabled title="Editing locked: >24 hours since recording"><i class="fa-solid fa-lock"></i> Locked</button>`;
        confirmOutBtnHtml = `<button type="button" class="btn btn-secondary btn-sm confirm-btn" id="btn_out_confirm_${w.id}" disabled title="Editing locked: >24 hours since recording"><i class="fa-solid fa-lock"></i> Locked</button>`;
      } else if (isAdmin && isOlderThan24h) {
        confirmInBtnHtml = `<button type="button" class="btn btn-warning btn-sm confirm-btn" id="btn_in_confirm_${w.id}" onclick="saveSingleAttendance('${w.id}', 'check_in')" title="Recorded >24 hours ago. Admin confirmation required." ${inDisabledAttr}><i class="fa-solid fa-user-shield"></i> Confirm</button>`;
        confirmOutBtnHtml = `<button type="button" class="btn btn-warning btn-sm confirm-btn" id="btn_out_confirm_${w.id}" onclick="saveSingleAttendance('${w.id}', 'check_out')" title="Recorded >24 hours ago. Admin confirmation required." ${outDisabledAttr}><i class="fa-solid fa-user-shield"></i> Confirm</button>`;
      } else {
        confirmInBtnHtml = `<button type="button" class="btn btn-accent btn-sm confirm-btn" id="btn_in_confirm_${w.id}" onclick="saveSingleAttendance('${w.id}', 'check_in')" title="Confirm Check-In Time" ${inDisabledAttr}><i class="fa-solid fa-check"></i> Confirm</button>`;
        confirmOutBtnHtml = `<button type="button" class="btn btn-accent btn-sm confirm-btn" id="btn_out_confirm_${w.id}" onclick="saveSingleAttendance('${w.id}', 'check_out')" title="Confirm Check-Out Time" ${outDisabledAttr}><i class="fa-solid fa-check"></i> Confirm</button>`;
      }

      return `
        <tr class="attendance-row ${isLocked ? 'row-locked' : ''}" id="row_${w.id}">
          <td data-label="Worker Details" class="col-worker" onclick="toggleWorkerCard('${w.id}')">
            <div class="worker-pill-container">
              <div class="worker-pill">
                <img src="${imgSrc}" onerror="handleImgError(this)" class="worker-img" alt="Worker">
                <div class="worker-details" style="line-height:1.2;">
                  <strong class="worker-name" style="line-height:1.25; display:block; margin-bottom:1px;">${escapeHtml(w.name)}</strong>
                  <span class="worker-passport" style="font-size:0.7rem; font-weight:500; color:var(--text-muted); display:block; opacity:0.85; line-height:1.2; margin-top:1px;"><i class="fa-solid fa-id-card" style="font-size:0.65rem;"></i> ${escapeHtml(w.passport_number || 'N/A')}</span>
                  <div class="worker-group-text" style="font-size:0.7rem; font-weight:600; color:var(--primary); line-height:1.2; margin-top:1px;">
                    <i class="fa-solid fa-layer-group" style="font-size:0.65rem;"></i> ${escapeHtml(w.group_name || 'General')}
                  </div>
                  <div class="worker-project-text" style="font-size:0.7rem; font-weight:500; color:var(--text-muted); line-height:1.2; margin-top:1px;">
                    <i class="fa-solid fa-city" style="font-size:0.65rem;"></i> ${escapeHtml(w.project_name || 'Unassigned')}
                  </div>
                </div>
              </div>
              <div class="mobile-header-right">
                <div class="mobile-status-container">
                  <div id="status_pill_${w.id}">${statusBadgeHtml}</div>
                  <div id="hours_mobile_${w.id}" class="mobile-hours-badge"><i class="fa-solid fa-clock"></i> ${displayHours} hrs</div>
                </div>
                <button type="button" class="mobile-expand-btn" title="Toggle Input Controls">
                  <i class="fa-solid fa-chevron-down"></i>
                </button>
              </div>
            </div>
          </td>
          <td data-label="Check-In Time" class="col-checkin mobile-collapsible">
            <span class="mobile-sub-label"><i class="fa-solid fa-right-to-bracket"></i> Check-In</span>
            <div class="time-control-group">
              <input type="time" class="form-control time-input" id="in_${w.id}" value="${escapeHtml(checkInVal)}" oninput="updateRowHours('${w.id}')" ${inDisabledAttr}>
              <div class="time-btn-group">
                <div class="time-btn-row">
                  <button type="button" class="btn btn-now btn-sm" id="btn_in_now_${w.id}" onclick="setCheckInNow('${w.id}')" title="Set Check-In to Current Time" ${inDisabledAttr}><i class="fa-solid fa-clock"></i> Now</button>
                  <button type="button" class="btn btn-reset btn-sm" id="btn_in_reset_${w.id}" onclick="resetCheckIn('${w.id}')" title="Reset/Clear Check-In Time" ${inDisabledAttr}><i class="fa-solid fa-rotate-left"></i> Reset</button>
                </div>
                ${confirmInBtnHtml}
              </div>
            </div>
          </td>
          <td data-label="Check-Out Time" class="col-checkout mobile-collapsible">
            <span class="mobile-sub-label"><i class="fa-solid fa-right-from-bracket"></i> Check-Out</span>
            <div class="time-control-group">
              <input type="time" class="form-control time-input" id="out_${w.id}" value="${escapeHtml(checkOutVal)}" oninput="updateRowHours('${w.id}')" ${outDisabledAttr}>
              <div class="time-btn-group">
                <div class="time-btn-row">
                  <button type="button" class="btn btn-now btn-sm" id="btn_out_now_${w.id}" onclick="setCheckOutNow('${w.id}')" title="Set Check-Out to Current Time" ${outDisabledAttr}><i class="fa-solid fa-clock"></i> Now</button>
                  <button type="button" class="btn btn-reset btn-sm" id="btn_out_reset_${w.id}" onclick="resetCheckOut('${w.id}')" title="Reset/Clear Check-Out Time" ${outDisabledAttr}><i class="fa-solid fa-rotate-left"></i> Reset</button>
                </div>
                ${confirmOutBtnHtml}
              </div>
            </div>
          </td>
          <td data-label="Total Hours" class="col-hours mobile-collapsible">
            <span class="mobile-label">Total Hours</span>
            <strong id="hours_${w.id}" class="total-hours-badge">${displayHours} hrs</strong>
          </td>
          <td data-label="Daily Work Volume" class="col-work-volume mobile-collapsible">
            <span class="mobile-sub-label"><i class="fa-solid fa-cubes-stacked"></i> Daily Work Volume</span>
            <div class="work-volume-group">
              <input type="text" list="commonWorkUnits" class="form-control work-volume-input" id="vol_${w.id}" value="${escapeHtml(a.work_volume || '')}" placeholder="e.g. 50 m², 120 sqft" onchange="saveSingleAttendance('${w.id}', 'work_volume')" ${volDisabledAttr}>
              <button type="button" class="btn btn-accent btn-sm btn-vol-confirm" id="btn_vol_confirm_${w.id}" onclick="saveSingleAttendance('${w.id}', 'work_volume')" title="Confirm Daily Work Volume Entry" ${volDisabledAttr}>
                <i class="fa-solid fa-check"></i>
              </button>
            </div>
          </td>
          <td data-label="Status Info" class="col-status desktop-only-cell">
            <div id="status_pill_desktop_${w.id}">${statusBadgeHtml}</div>
            <div id="taken_at_desktop_${w.id}" class="taken-at-time" style="display:none;"></div>
          </td>
        </tr>
      `;
    }).join('');

    tbody.innerHTML = rowsHtml;
  } catch (err) {
    console.error("Attendance load error:", err);
  }
}

function showAttendanceError(title, message) {
  const titleEl = document.getElementById('attendanceErrorModalTitle');
  const detailsEl = document.getElementById('attendanceErrorModalDetails');
  
  if (titleEl) {
    titleEl.innerHTML = `<i class="fa-solid fa-circle-xmark" style="color: #DC2626; font-size: 0.95rem;"></i> ${title || 'Invalid Input'}`;
  }
  if (detailsEl) {
    detailsEl.innerText = message || 'An error occurred while validating attendance inputs.';
  }

  const modal = document.getElementById('attendanceErrorModal');
  if (modal) modal.classList.add('show');
}

async function saveSingleAttendance(workerId, entryType = 'all', adminConfirmed = false, bypassOverwrite = false) {
  const targetDate = document.getElementById('attendanceDate').value;
  const todayStr = getLocalDateString(new Date());
  if (targetDate > todayStr) {
    showAttendanceError("Invalid Date", "Future dates are disabled for attendance recording.");
    return;
  }
  const inEl = document.getElementById(`in_${workerId}`);
  const outEl = document.getElementById(`out_${workerId}`);
  const volEl = document.getElementById(`vol_${workerId}`);
  const inVal = inEl ? inEl.value : '';
  const outVal = outEl ? outEl.value : '';
  const volVal = volEl ? volEl.value.trim() : '';

  // Validate sequence: Check-In and Check-Out cannot be identical
  if (inVal && outVal && inVal === outVal) {
    showAttendanceError("Invalid Attendance Times", `Check-In time (${inVal}) and Check-Out time (${outVal}) cannot be identical.`);
    return;
  }

  let statusVal = 'Absent';
  if (inVal) {
    statusVal = (inVal > '09:00') ? 'Late' : 'Present';
  } else {
    statusVal = 'Absent';
  }

  const attRecord = currentAttendanceMap[workerId] || {};
  const isOlderThan24h = attRecord.is_older_than_24h || false;
  const isSiteManager = currentUser && currentUser.role === 'site_manager';
  const isAdmin = currentUser && currentUser.role === 'admin';

  if (isSiteManager && isOlderThan24h) {
    showAttendanceError("Editing Locked (>24h)", "Site managers can only edit worker work details within 24 hours of input recording.");
    return;
  }

  if (isAdmin && isOlderThan24h && !adminConfirmed) {
    const workerName = attRecord.worker ? attRecord.worker.name : 'Worker';
    const recTimeStr = attRecord.recorded_at ? new Date(attRecord.recorded_at).toLocaleString() : targetDate;

    document.getElementById('adminConfirmWorkerName').innerText = workerName;
    document.getElementById('adminConfirmRecordDate').innerText = `Input Recorded: ${recTimeStr}`;

    const submitBtn = document.getElementById('adminConfirmSubmitBtn');
    submitBtn.onclick = () => {
      closeModal('adminConfirmModal');
      saveSingleAttendance(workerId, entryType, true, bypassOverwrite);
    };

    document.getElementById('adminConfirmModal').classList.add('show');
    return;
  }

  // Overwrite Warning Check (matches Face Recognition tab warning behavior)
  if (!bypassOverwrite && entryType !== 'work_volume') {
    const existingCheckIn = attRecord.check_in || '';
    const existingCheckOut = attRecord.check_out || '';
    const workerName = attRecord.worker ? attRecord.worker.name : 'Worker';

    let showOverwritePrompt = false;
    let overwriteMsg = '';

    if (entryType === 'check_in' && existingCheckIn && existingCheckIn !== inVal) {
      showOverwritePrompt = true;
      if (inVal) {
        overwriteMsg = `An attendance check-in record already exists for ${workerName} on ${targetDate}. Overwriting will replace the check-in time (${existingCheckIn}) with ${inVal}.`;
      } else {
        overwriteMsg = `An attendance check-in record already exists for ${workerName} on ${targetDate}. Overwriting will clear the existing check-in time (${existingCheckIn}).`;
      }
    } else if (entryType === 'check_out' && existingCheckOut && existingCheckOut !== outVal) {
      showOverwritePrompt = true;
      if (outVal) {
        overwriteMsg = `An attendance check-out record already exists for ${workerName} on ${targetDate}. Overwriting will replace the check-out time (${existingCheckOut}) with ${outVal}.`;
      } else {
        overwriteMsg = `An attendance check-out record already exists for ${workerName} on ${targetDate}. Overwriting will clear the existing check-out time (${existingCheckOut}).`;
      }
    } else if (entryType === 'all') {
      if (existingCheckIn && inVal && existingCheckIn !== inVal) {
        showOverwritePrompt = true;
        overwriteMsg = `An attendance check-in record already exists for ${workerName} on ${targetDate}. Overwriting will replace the check-in time (${existingCheckIn}) with ${inVal}.`;
      } else if (existingCheckOut && outVal && existingCheckOut !== outVal) {
        showOverwritePrompt = true;
        overwriteMsg = `An attendance check-out record already exists for ${workerName} on ${targetDate}. Overwriting will replace the check-out time (${existingCheckOut}) with ${outVal}.`;
      }
    }

    if (showOverwritePrompt) {
      document.getElementById('attendanceOverwriteWorkerName').innerText = workerName;
      document.getElementById('attendanceOverwriteRecordDate').innerText = `Date: ${targetDate}`;
      document.getElementById('lblAttendanceOverwriteText').innerText = overwriteMsg;

      const overwriteBtn = document.getElementById('attendanceOverwriteSubmitBtn');
      overwriteBtn.onclick = () => {
        closeModal('attendanceOverwriteModal');
        saveSingleAttendance(workerId, entryType, adminConfirmed, true);
      };

      document.getElementById('attendanceOverwriteModal').classList.add('show');
      return;
    }
  }

  let targetButtons = [];
  if (entryType === 'check_in') {
    targetButtons = [document.getElementById(`btn_in_confirm_${workerId}`)].filter(Boolean);
  } else if (entryType === 'check_out') {
    targetButtons = [document.getElementById(`btn_out_confirm_${workerId}`)].filter(Boolean);
  } else if (entryType === 'work_volume') {
    targetButtons = [document.getElementById(`btn_vol_confirm_${workerId}`)].filter(Boolean);
  } else {
    targetButtons = [
      document.getElementById(`btn_in_confirm_${workerId}`),
      document.getElementById(`btn_out_confirm_${workerId}`),
      document.getElementById(`btn_vol_confirm_${workerId}`)
    ].filter(Boolean);
  }

  targetButtons.forEach(btn => {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${entryType === 'work_volume' ? '' : 'Saving...'}`;
  });

  const payloadWorkVolume = (entryType === 'work_volume' || entryType === 'all') ? volVal : (attRecord.work_volume || '');

  try {
    const res = await apiFetch('/attendance/record', {
      method: 'POST',
      body: JSON.stringify({
        worker_id: workerId,
        date: targetDate,
        check_in: inVal || null,
        check_out: outVal || null,
        status: statusVal,
        work_volume: payloadWorkVolume,
        admin_confirmed: adminConfirmed
      })
    });

    // Update in-memory DB map state for worker
    if (!currentAttendanceMap[workerId]) currentAttendanceMap[workerId] = {};
    if (res.deleted) {
      currentAttendanceMap[workerId].check_in = null;
      currentAttendanceMap[workerId].check_out = null;
      currentAttendanceMap[workerId].work_volume = '';
    } else {
      currentAttendanceMap[workerId].check_in = res.check_in || null;
      currentAttendanceMap[workerId].check_out = res.check_out || null;
      currentAttendanceMap[workerId].work_volume = res.work_volume || '';
    }
    if (res.is_locked !== undefined) currentAttendanceMap[workerId].is_locked = res.is_locked;
    if (res.is_older_than_24h !== undefined) currentAttendanceMap[workerId].is_older_than_24h = res.is_older_than_24h;

    // Dynamically update Check-Out & Work Volume inputs state based on saved DB record
    updateRowHours(workerId);

    const hoursEl = document.getElementById(`hours_${workerId}`);
    const finalHours = res.hours_worked !== undefined ? res.hours_worked : calculateHoursJS(inVal, outVal);
    if (hoursEl) hoursEl.innerText = `${finalHours} hrs`;
    const hoursMobileEl = document.getElementById(`hours_mobile_${workerId}`);
    if (hoursMobileEl) hoursMobileEl.innerHTML = `<i class="fa-solid fa-clock"></i> ${finalHours} hrs`;

    const recText = getTakenTimeText(res.recorded_at || res.updated_at, res.is_older_than_24h, res.is_locked);
    const updatedBadgeHtml = buildStatusBadgeHtml(inVal, outVal, res.is_locked, recText);

    const pillEls = [
      document.getElementById(`status_pill_${workerId}`),
      document.getElementById(`status_pill_desktop_${workerId}`)
    ].filter(Boolean);

    pillEls.forEach(pillEl => {
      pillEl.innerHTML = updatedBadgeHtml;
    });

    targetButtons.forEach(btn => {
      btn.disabled = false;
      if (res.deleted) {
        btn.className = btn.id.includes('btn_vol_confirm') ? 'btn btn-secondary btn-sm btn-vol-confirm' : 'btn btn-secondary btn-sm confirm-btn';
        btn.innerHTML = btn.id.includes('btn_vol_confirm') ? `<i class="fa-solid fa-check"></i>` : `<i class="fa-solid fa-trash-can"></i> Cleared`;
      } else {
        btn.className = btn.id.includes('btn_vol_confirm') ? 'btn btn-present btn-sm btn-vol-confirm' : 'btn btn-present btn-sm confirm-btn';
        btn.innerHTML = btn.id.includes('btn_vol_confirm') ? `<i class="fa-solid fa-circle-check"></i>` : `<i class="fa-solid fa-circle-check"></i> Saved`;
      }
      setTimeout(() => {
        if (btn.id.includes('btn_vol_confirm')) {
          btn.className = 'btn btn-accent btn-sm btn-vol-confirm';
          btn.innerHTML = `<i class="fa-solid fa-check"></i>`;
        } else if (isAdmin && isOlderThan24h) {
          btn.className = 'btn btn-warning btn-sm confirm-btn';
          btn.innerHTML = `<i class="fa-solid fa-user-shield"></i> Confirm`;
        } else {
          btn.className = 'btn btn-accent btn-sm confirm-btn';
          btn.innerHTML = `<i class="fa-solid fa-check"></i> Confirm`;
        }
      }, 2000);
    });
    loadDashboardStats();
  } catch (err) {
    targetButtons.forEach(btn => {
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-solid fa-check"></i> Confirm`;
    });
    if (err.message && err.message.includes('24_HOUR_OVERRIDE_REQUIRED')) {
      if (isAdmin) {
        document.getElementById('adminConfirmWorkerName').innerText = 'Worker Work Details';
        document.getElementById('adminConfirmRecordDate').innerText = `Recorded >24 Hours Ago`;
        const submitBtn = document.getElementById('adminConfirmSubmitBtn');
        submitBtn.onclick = () => {
          closeModal('adminConfirmModal');
          saveSingleAttendance(workerId, entryType, true, bypassOverwrite);
        };
        document.getElementById('adminConfirmModal').classList.add('show');
        return;
      }
    }
    showAttendanceError("Submission Failed", err.message || "Could not update attendance.");
  }
}

function formatTime12h(time24) {
  if (!time24) return '';
  const parts = time24.split(':');
  let h = parseInt(parts[0], 10);
  const m = parts[1] || '00';
  if (isNaN(h)) return time24;
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  const hDisplay = String(h).padStart(2, '0');
  return `${hDisplay}:${m} ${ampm}`;
}

async function triggerBatchCheckIn(adminConfirmed = false, bypassOverwrite = false) {
  const targetDate = document.getElementById('attendanceDate').value;
  const todayStr = getLocalDateString(new Date());
  if (targetDate > todayStr) {
    showAttendanceError("Invalid Date", "Future dates are disabled for attendance recording.");
    return;
  }
  const projectFilter = document.getElementById('attendanceProjectFilter').value;
  const groupFilter = document.getElementById('attendanceGroupFilter').value;
  const checkInTime = document.getElementById('batchCheckInTime')?.value || '08:00';
  const checkInTimeFormatted = formatTime12h(checkInTime);

  const isSiteManager = currentUser && currentUser.role === 'site_manager';
  const isAdmin = currentUser && currentUser.role === 'admin';

  const hasOlderRecords = Object.values(currentAttendanceMap).some(a => a && a.is_older_than_24h);

  if (isSiteManager && hasOlderRecords) {
    showAttendanceError("Batch Operation Locked", "Attendance records for one or more workers on this date were recorded >24 hours ago.");
    return;
  }

  if (isAdmin && hasOlderRecords && !adminConfirmed) {
    document.getElementById('adminConfirmWorkerName').innerText = `Batch Operations on ${targetDate}`;
    document.getElementById('adminConfirmRecordDate').innerText = `Multiple Records >24 Hours Old`;

    const submitBtn = document.getElementById('adminConfirmSubmitBtn');
    submitBtn.onclick = () => {
      closeModal('adminConfirmModal');
      triggerBatchCheckIn(true, bypassOverwrite);
    };

    document.getElementById('adminConfirmModal').classList.add('show');
    return;
  }

  if (!bypassOverwrite) {
    const existingCheckIns = Object.values(currentAttendanceMap).filter(a => a && a.check_in);
    if (existingCheckIns.length > 0) {
      document.getElementById('attendanceOverwriteWorkerName').innerText = `Batch Check-In on ${targetDate}`;
      document.getElementById('attendanceOverwriteRecordDate').innerText = `${existingCheckIns.length} worker(s) already checked in`;
      document.getElementById('lblAttendanceOverwriteText').innerText = `One or more workers already have an attendance check-in record for ${targetDate}. Overwriting will replace their check-in times with ${checkInTimeFormatted}.`;

      const overwriteBtn = document.getElementById('attendanceOverwriteSubmitBtn');
      overwriteBtn.onclick = () => {
        closeModal('attendanceOverwriteModal');
        triggerBatchCheckIn(adminConfirmed, true);
      };

      document.getElementById('attendanceOverwriteModal').classList.add('show');
      return;
    }
  }

  try {
    const workerIds = Object.keys(currentAttendanceMap);
    if (!workerIds || workerIds.length === 0) {
      showAttendanceError("No Active Workers Found", "No active workers found on the sheet to check in.");
      return;
    }

    await apiFetch('/attendance/bulk-checkin', {
      method: 'POST',
      body: JSON.stringify({
        worker_ids: workerIds,
        date: targetDate,
        check_in_time: checkInTime,
        admin_confirmed: adminConfirmed
      })
    });

    loadAttendanceSheet();
  } catch (err) {
    if (err.message && err.message.includes('24_HOUR_OVERRIDE_REQUIRED') && isAdmin) {
      document.getElementById('adminConfirmWorkerName').innerText = `Batch Operations on ${targetDate}`;
      document.getElementById('adminConfirmRecordDate').innerText = `Multiple Records >24 Hours Old`;
      const submitBtn = document.getElementById('adminConfirmSubmitBtn');
      submitBtn.onclick = () => {
        closeModal('adminConfirmModal');
        triggerBatchCheckIn(true, bypassOverwrite);
      };
      document.getElementById('adminConfirmModal').classList.add('show');
      return;
    }
    showAttendanceError("Batch Check-In Failed", err.message || "Batch check-in failed.");
  }
}

async function triggerBatchCheckOut(adminConfirmed = false, bypassOverwrite = false) {
  const targetDate = document.getElementById('attendanceDate').value;
  const todayStr = getLocalDateString(new Date());
  if (targetDate > todayStr) {
    showAttendanceError("Invalid Date", "Future dates are disabled for attendance recording.");
    return;
  }
  const checkOutTime = document.getElementById('batchCheckOutTime')?.value || '18:00';
  const checkOutTimeFormatted = formatTime12h(checkOutTime);

  const isSiteManager = currentUser && currentUser.role === 'site_manager';
  const isAdmin = currentUser && currentUser.role === 'admin';

  // Batch Check-Out applies ONLY to active workers who have checked in!
  const checkedInItems = Object.values(currentAttendanceMap).filter(a => {
    if (!a || !a.check_in || !a.check_in.trim()) return false;
    const wStatus = a.worker ? a.worker.status : null;
    if (wStatus && wStatus !== 'Active') return false;
    return true;
  });
  if (checkedInItems.length === 0) {
    showAttendanceError("No Checked-In Workers", "No workers have checked in for this date yet. Batch Check-Out only applies to checked-in workers.");
    return;
  }

  // Filter out workers whose check-in time is identical to the batch check-out time
  const validItems = checkedInItems.filter(a => a.check_in.trim() !== checkOutTime.trim());
  if (validItems.length === 0) {
    showAttendanceError("Invalid Check-Out Time", `Batch Check-Out time (${checkOutTimeFormatted}) cannot be identical to worker Check-In time.`);
    return;
  }

  const hasOlderRecords = validItems.some(a => a && a.is_older_than_24h);

  if (isSiteManager && hasOlderRecords) {
    showAttendanceError("Batch Operation Locked", "Attendance records for one or more workers on this date were recorded >24 hours ago.");
    return;
  }

  if (isAdmin && hasOlderRecords && !adminConfirmed) {
    document.getElementById('adminConfirmWorkerName').innerText = `Batch Operations on ${targetDate}`;
    document.getElementById('adminConfirmRecordDate').innerText = `Multiple Records >24 Hours Old`;

    const submitBtn = document.getElementById('adminConfirmSubmitBtn');
    submitBtn.onclick = () => {
      closeModal('adminConfirmModal');
      triggerBatchCheckOut(true, bypassOverwrite);
    };

    document.getElementById('adminConfirmModal').classList.add('show');
    return;
  }

  if (!bypassOverwrite) {
    const existingCheckOuts = validItems.filter(a => a && a.check_out && a.check_out.trim());
    if (existingCheckOuts.length > 0) {
      document.getElementById('attendanceOverwriteWorkerName').innerText = `Batch Check-Out on ${targetDate}`;
      document.getElementById('attendanceOverwriteRecordDate').innerText = `${existingCheckOuts.length} worker(s) already checked out`;
      document.getElementById('lblAttendanceOverwriteText').innerText = `One or more workers already have an attendance check-out record for ${targetDate}. Overwriting will replace their check-out times with ${checkOutTimeFormatted}.`;

      const overwriteBtn = document.getElementById('attendanceOverwriteSubmitBtn');
      overwriteBtn.onclick = () => {
        closeModal('attendanceOverwriteModal');
        triggerBatchCheckOut(adminConfirmed, true);
      };

      document.getElementById('attendanceOverwriteModal').classList.add('show');
      return;
    }
  }

  try {
    const workerIds = validItems.map(item => item.worker.id);
    if (!workerIds || workerIds.length === 0) {
      showAttendanceError("No Checked-In Workers", "No checked-in workers found to check out.");
      return;
    }

    await apiFetch('/attendance/bulk-checkout', {
      method: 'POST',
      body: JSON.stringify({
        worker_ids: workerIds,
        date: targetDate,
        check_out_time: checkOutTime,
        admin_confirmed: adminConfirmed
      })
    });

    loadAttendanceSheet();
  } catch (err) {
    if (err.message && err.message.includes('24_HOUR_OVERRIDE_REQUIRED') && isAdmin) {
      document.getElementById('adminConfirmWorkerName').innerText = `Batch Operations on ${targetDate}`;
      document.getElementById('adminConfirmRecordDate').innerText = `Multiple Records >24 Hours Old`;
      const submitBtn = document.getElementById('adminConfirmSubmitBtn');
      submitBtn.onclick = () => {
        closeModal('adminConfirmModal');
        triggerBatchCheckOut(true, bypassOverwrite);
      };
      document.getElementById('adminConfirmModal').classList.add('show');
      return;
    }
    showAttendanceError("Batch Check-Out Failed", err.message || "Batch check-out failed.");
  }
}

// Workers List
let _cachedAllWorkers = null;
let _currentPhotoFilter = ''; // '', 'with_photo', or 'without_photo'

function togglePhotoFilter(type) {
  if (_currentPhotoFilter === type) {
    _currentPhotoFilter = '';
  } else {
    _currentPhotoFilter = type;
  }
  
  updatePhotoFilterButtons();
  loadWorkers();
}

function updatePhotoFilterButtons() {
  const btnWith = document.getElementById('btnWithPhoto');
  const btnWithout = document.getElementById('btnWithoutPhoto');
  
  if (btnWith) {
    btnWith.classList.toggle('active', _currentPhotoFilter === 'with_photo');
  }
  if (btnWithout) {
    btnWithout.classList.toggle('active', _currentPhotoFilter === 'without_photo');
  }
}

async function fetchAllWorkersCache() {
  try {
    const allWorkers = await apiFetch('/workers');
    _cachedAllWorkers = Array.isArray(allWorkers) ? allWorkers : [];
    return _cachedAllWorkers;
  } catch (err) {
    console.error("Error fetching workers cache:", err);
    return [];
  }
}

async function loadWorkers() {
  const queryInput = document.getElementById('workerSearchQuery');
  const query = queryInput ? queryInput.value.trim() : '';
  const project_id = document.getElementById('workerProjectFilter')?.value || '';
  const group_id = document.getElementById('workerGroupFilter')?.value || '';
  const status_val = document.getElementById('workerStatusFilter')?.value || '';
  const photo_val = _currentPhotoFilter;

  const hasFilter = Boolean(query || project_id || group_id || status_val || photo_val);

  try {
    const workers = await apiFetch(`/workers?query=${encodeURIComponent(query)}&project_id=${project_id}&group_id=${group_id}&status=${status_val}&photo_status=${photo_val}`);
    const filteredCount = Array.isArray(workers) ? workers.length : 0;

    let allWorkers = [];
    if (!hasFilter) {
      allWorkers = Array.isArray(workers) ? workers : [];
      _cachedAllWorkers = allWorkers;
    } else if (_cachedAllWorkers !== null) {
      allWorkers = _cachedAllWorkers;
    } else {
      allWorkers = await fetchAllWorkersCache();
    }

    const totalCount = allWorkers.length;
    const withPhotoCount = allWorkers.filter(w => w.picture_url && w.picture_url.trim().length > 0).length;
    const withoutPhotoCount = totalCount - withPhotoCount;

    // Update UI counters
    const totalEl = document.getElementById('totalWorkerCount');
    if (totalEl) totalEl.innerText = totalCount;

    const filteredEl = document.getElementById('filteredWorkerCount');
    if (filteredEl) filteredEl.innerText = filteredCount;

    const withPhotoEl = document.getElementById('withPhotoCount');
    if (withPhotoEl) withPhotoEl.innerText = withPhotoCount;

    const withoutPhotoEl = document.getElementById('withoutPhotoCount');
    if (withoutPhotoEl) withoutPhotoEl.innerText = withoutPhotoCount;

    updatePhotoFilterButtons();

    const grid = document.getElementById('workersGrid');
    if (!grid) return;
    grid.innerHTML = '';

    if (!workers || workers.length === 0) {
      grid.innerHTML = `<div style="grid-column: 1/-1; text-align:center; padding:3rem; color:var(--text-muted);"><i class="fa-solid fa-user-slash" style="font-size:2rem; margin-bottom:0.5rem; display:block;"></i>No workers registered matching filters. Click "Add Worker" to register a new worker.</div>`;
      return;
    }

    grid.innerHTML = workers.map(w => {
      const imgSrc = (w.picture_url && w.picture_url.trim()) ? w.picture_url.trim() : DEFAULT_WORKER_IMG;
      const statusStr = w.status || 'Active';
      let badgeClass = 'badge-present';
      let badgeIcon = 'fa-circle-check';
      if (statusStr === 'On Leave') {
        badgeClass = 'badge-late';
        badgeIcon = 'fa-umbrella-beach';
      } else if (statusStr === 'Resigned') {
        badgeClass = 'badge-absent';
        badgeIcon = 'fa-user-minus';
      } else if (statusStr === 'Terminated') {
        badgeClass = 'badge-locked';
        badgeIcon = 'fa-user-xmark';
      }

      return `
        <div class="worker-card">
          <div class="worker-card-header">
            <img src="${imgSrc}" onerror="handleImgError(this)" class="worker-card-img" alt="Worker">
            <div>
              <strong style="font-size:1.05rem; display:block; color:var(--primary);">${escapeHtml(w.name)}</strong>
              <span class="badge ${badgeClass}"><i class="fa-solid ${badgeIcon}"></i> ${escapeHtml(statusStr)}</span>
            </div>
          </div>
          <div class="worker-card-body">
            <div><i class="fa-solid fa-id-card"></i> Passport: <strong>${escapeHtml(w.passport_number || 'N/A')}</strong></div>
            <div><i class="fa-solid fa-layer-group"></i> Trade: <strong>${escapeHtml(w.group_name || 'General')}</strong></div>
            <div><i class="fa-solid fa-city"></i> Site: ${escapeHtml(w.project_name || 'Unassigned')}</div>
            <div><i class="fa-solid fa-money-bill-wave"></i> Basic Salary: <strong>${w.hourly_rate !== undefined && w.hourly_rate !== null && w.hourly_rate !== '' ? '$' + Number(w.hourly_rate).toFixed(2) + '/hr' : (w.phone ? '$' + w.phone + '/hr' : 'N/A')}</strong></div>
          </div>
          <div style="margin-top: 1rem; padding-top: 0.75rem; border-top: 1px solid var(--border-color); display:flex; justify-content:flex-end; gap:0.5rem;">
            <button class="btn btn-secondary btn-sm" onclick="editWorker('${w.id}')"><i class="fa-solid fa-pen-to-square"></i> Edit</button>
            <button class="btn btn-danger btn-sm" onclick="deleteWorker('${w.id}')"><i class="fa-solid fa-trash"></i></button>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error("Worker load error:", err);
  }
}

function openWorkerModal(worker = null) {
  document.getElementById('workerForm').reset();
  document.getElementById('workerId').value = '';
  const titleEl = document.getElementById('workerModalTitle');
  if (titleEl) {
    titleEl.innerHTML = `<i class="fa-solid fa-user-gear" style="color:var(--accent-amber); margin-right:0.4rem;"></i> ${worker ? 'Edit Construction Worker' : 'Add Construction Worker'}`;
  }
  const defaultImg = DEFAULT_WORKER_IMG;
  const projectSelect = document.getElementById('workerProject');

  if (worker) {
    document.getElementById('workerId').value = worker.id;
    document.getElementById('workerName').value = worker.name;
    document.getElementById('workerPassport').value = worker.passport_number || '';
    const rateEl = document.getElementById('workerHourlyRate');
    if (rateEl) rateEl.value = worker.hourly_rate !== undefined && worker.hourly_rate !== null && worker.hourly_rate !== '' ? worker.hourly_rate : (worker.phone || '');
    const statusEl = document.getElementById('workerStatus');
    if (statusEl) statusEl.value = worker.status || 'Active';
    if (projectSelect) projectSelect.value = worker.project_id || '';
    document.getElementById('workerGroup').value = worker.group_id || '';
    document.getElementById('workerPhotoUrl').value = worker.picture_url || '';

    const previewSrc = (worker.picture_url && worker.picture_url.trim()) ? worker.picture_url.trim() : defaultImg;
    document.getElementById('workerPhotoPreview').src = previewSrc;
  } else {
    const statusEl = document.getElementById('workerStatus');
    if (statusEl) statusEl.value = 'Active';
    document.getElementById('workerPhotoPreview').src = defaultImg;
  }

  if (currentUser && currentUser.role === 'site_manager' && currentUser.assigned_project_id) {
    if (projectSelect) {
      projectSelect.value = currentUser.assigned_project_id;
      projectSelect.disabled = true;
      projectSelect.title = `Assigned to ${currentUser.assigned_project_name || 'your site'}`;
    }
  } else if (projectSelect) {
    projectSelect.disabled = false;
  }

  document.getElementById('workerModal').classList.add('show');
}

function previewWorkerPhoto() {
  const url = document.getElementById('workerPhotoUrl').value.trim();
  const img = document.getElementById('workerPhotoPreview');
  img.src = url || DEFAULT_WORKER_IMG;
  img.onerror = function () {
    this.onerror = null;
    this.src = DEFAULT_WORKER_IMG;
  };
}

async function saveWorker(e) {
  e.preventDefault();
  const id = document.getElementById('workerId').value;
  const rateVal = document.getElementById('workerHourlyRate')?.value.trim() || '';
  const payload = {
    name: document.getElementById('workerName').value.trim(),
    passport_number: document.getElementById('workerPassport').value.trim(),
    hourly_rate: rateVal !== '' ? parseFloat(rateVal) : 0,
    phone: rateVal,
    status: document.getElementById('workerStatus')?.value || 'Active',
    project_id: document.getElementById('workerProject').value,
    group_id: document.getElementById('workerGroup').value,
    picture_url: document.getElementById('workerPhotoUrl').value.trim()
  };

  try {
    if (id) {
      await apiFetch(`/workers/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      await apiFetch('/workers', { method: 'POST', body: JSON.stringify(payload) });
    }
    closeModal('workerModal');
    _cachedAllWorkers = null;
    loadWorkers();
    loadDashboardStats();
  } catch (err) {
    alert("Error saving worker: " + err.message);
  }
}

async function editWorker(id) {
  try {
    const worker = await apiFetch(`/workers/${id}`);
    if (worker) openWorkerModal(worker);
  } catch (err) {
    alert("Could not fetch worker details: " + err.message);
  }
}

async function deleteWorker(id) {
  if (!confirm("Are you sure you want to remove this worker record?")) return;
  try {
    await apiFetch(`/workers/${id}`, { method: 'DELETE' });
    _cachedAllWorkers = null;
    loadWorkers();
    loadDashboardStats();
  } catch (err) {
    alert("Delete failed: " + err.message);
  }
}

// Projects Management
async function loadProjectsTable() {
  try {
    const projects = await apiFetch('/projects');
    const tbody = document.getElementById('projectsTableBody');
    if (!tbody) return;
    tbody.innerHTML = projects.map(p => {
      const badgeClass = p.status === 'Completed' ? 'badge-present' : (p.status === 'On Hold' ? 'badge-late' : 'badge-present');
      return `
        <tr>
          <td><strong style="color:var(--primary);">${escapeHtml(p.name)}</strong></td>
          <td>${escapeHtml(p.location || 'Malaysia')}</td>
          <td><span class="badge ${badgeClass}">${escapeHtml(p.status || 'Active')}</span></td>
          <td>
            <button class="btn btn-secondary btn-sm" onclick="editProject('${p.id}')"><i class="fa-solid fa-pen-to-square"></i> Edit</button>
            <button class="btn btn-danger btn-sm" onclick="deleteProject('${p.id}')"><i class="fa-solid fa-trash"></i></button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) { console.error("Projects load error", err); }
}

async function populateProjectManagerOptions(selectedMgrId = '') {
  try {
    const users = await apiFetch('/admin/users');
    const select = document.getElementById('projectAssignedManager');
    if (!select) return;
    const defaultOpt = '<option value="">Select Site Manager</option>';
    const userOpts = users.map(u => {
      const sel = (u.id === selectedMgrId || u.username === selectedMgrId) ? 'selected' : '';
      return `<option value="${escapeHtml(u.username)}" ${sel}>${escapeHtml(u.full_name)} (${escapeHtml(u.username)})</option>`;
    }).join('');
    select.innerHTML = defaultOpt + userOpts;
  } catch (e) { }
}

async function openProjectModal(project = null) {
  document.getElementById('projectForm').reset();
  document.getElementById('projectId').value = '';
  document.getElementById('projectModalTitle').innerText = project ? 'Edit Construction Project Site' : 'Add Construction Project Site';

  if (currentUser.role === 'admin') {
    await populateProjectManagerOptions(project ? (project.assigned_manager_id || project.assigned_manager_name || '') : '');
  }

  if (project) {
    document.getElementById('projectId').value = project.id;
    document.getElementById('projectName').value = project.name || '';
    document.getElementById('projectLocation').value = project.location || '';
    document.getElementById('projectStatus').value = project.status || 'Active';
  } else {
    document.getElementById('projectStatus').value = 'Active';
  }

  document.getElementById('projectModal').classList.add('show');
}

async function editProject(id) {
  try {
    const projects = await apiFetch('/projects');
    const project = projects.find(p => p.id === id);
    if (project) openProjectModal(project);
  } catch (err) {
    alert("Could not fetch project details: " + err.message);
  }
}

async function saveProject(e) {
  e.preventDefault();
  const id = document.getElementById('projectId').value;
  const mgrSelect = document.getElementById('projectAssignedManager');
  const selectedMgrOption = mgrSelect ? mgrSelect.options[mgrSelect.selectedIndex] : null;

  const payload = {
    name: document.getElementById('projectName').value.trim(),
    location: document.getElementById('projectLocation').value.trim(),
    status: document.getElementById('projectStatus').value,
    assigned_manager_id: mgrSelect ? mgrSelect.value : '',
    assigned_manager_name: mgrSelect && mgrSelect.value ? (selectedMgrOption ? selectedMgrOption.text : '') : ''
  };
  try {
    if (id) {
      await apiFetch(`/projects/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      await apiFetch('/projects', { method: 'POST', body: JSON.stringify(payload) });
    }
    closeModal('projectModal');
    loadProjectsTable();
    loadProjectOptions();
    if (typeof loadWorkers === 'function') loadWorkers();
  } catch (err) {
    alert("Error saving project: " + err.message);
  }
}

async function deleteProject(id) {
  if (!confirm("Delete project site?")) return;
  try {
    await apiFetch(`/projects/${id}`, { method: 'DELETE' });
    loadProjectsTable();
    loadProjectOptions();
    if (typeof loadWorkers === 'function') loadWorkers();
  } catch (err) {
    alert("Delete failed: " + err.message);
  }
}

// Worker Groups Management
async function loadGroupsTable() {
  try {
    const groups = await apiFetch('/groups');
    const tbody = document.getElementById('groupsTableBody');
    if (!tbody) return;
    tbody.innerHTML = groups.map(g => `
      <tr>
        <td><strong style="color:var(--primary);">${escapeHtml(g.name)}</strong></td>
        <td>${escapeHtml(g.description || 'N/A')}</td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="editGroup('${g.id}')"><i class="fa-solid fa-pen-to-square"></i> Edit</button>
          <button class="btn btn-danger btn-sm" onclick="deleteGroup('${g.id}')"><i class="fa-solid fa-trash"></i></button>
        </td>
      </tr>
    `).join('');
  } catch (err) { console.error("Groups load error", err); }
}

function openGroupModal(group = null) {
  document.getElementById('groupForm').reset();
  document.getElementById('groupId').value = '';
  document.getElementById('groupModalTitle').innerText = group ? 'Edit Worker Group' : 'Add Worker Group';

  if (group) {
    document.getElementById('groupId').value = group.id;
    document.getElementById('groupName').value = group.name || '';
    document.getElementById('groupDescription').value = group.description || '';
  }

  document.getElementById('groupModal').classList.add('show');
}

async function editGroup(id) {
  try {
    const groups = await apiFetch('/groups');
    const group = groups.find(g => g.id === id);
    if (group) openGroupModal(group);
  } catch (err) {
    alert("Could not fetch Group details: " + err.message);
  }
}

async function saveGroup(e) {
  e.preventDefault();
  const id = document.getElementById('groupId').value;
  const payload = {
    name: document.getElementById('groupName').value.trim(),
    description: document.getElementById('groupDescription').value.trim()
  };
  try {
    if (id) {
      await apiFetch(`/groups/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      await apiFetch('/groups', { method: 'POST', body: JSON.stringify(payload) });
    }
    closeModal('groupModal');
    loadGroupsTable();
    loadGroupOptions();
    if (typeof loadWorkers === 'function') loadWorkers();
  } catch (err) {
    alert("Error saving group: " + err.message);
  }
}

async function deleteGroup(id) {
  if (!confirm("Delete worker Group?")) return;
  try {
    await apiFetch(`/groups/${id}`, { method: 'DELETE' });
    loadGroupsTable();
    loadGroupOptions();
    if (typeof loadWorkers === 'function') loadWorkers();
  } catch (err) {
    alert("Delete failed: " + err.message);
  }
}

// Admin Users Management
async function loadUsersTable() {
  if (currentUser.role !== 'admin') return;
  try {
    const users = await apiFetch('/admin/users');
    const tbody = document.getElementById('usersTableBody');
    if (!tbody) return;
    tbody.innerHTML = users.map(u => {
      const assignedProjText = u.assigned_project_name || 'All / Unassigned';
      const phoneText = u.phone || u.email || 'N/A';
      const allowedCount = (u.role === 'admin') ? 'All Tabs' : (u.allowed_tabs ? `${u.allowed_tabs.length}/6 Tabs` : '6/6 Tabs');
      return `
        <tr>
          <td><strong>${escapeHtml(u.username)}</strong></td>
          <td>${escapeHtml(u.full_name)}</td>
          <td><span class="badge ${u.role === 'admin' ? 'badge-late' : 'badge-pending'}">${u.role === 'admin' ? 'Admin' : 'Site Manager'}</span></td>
          <td><strong style="color:var(--accent-amber);">${escapeHtml(assignedProjText)}</strong></td>
          <td><i class="fa-solid fa-phone" style="font-size:0.75rem; color:var(--text-muted); margin-right:0.35rem;"></i>${escapeHtml(phoneText)}</td>
          <td><span class="badge badge-present" style="font-size:0.78rem;">${allowedCount}</span></td>
          <td>
            <button class="btn btn-secondary btn-sm" onclick="editUser('${u.username}')"><i class="fa-solid fa-pen-to-square"></i> Edit</button>
            ${u.username !== currentUser.username ? `<button class="btn btn-danger btn-sm" onclick="deleteUser('${u.username}')"><i class="fa-solid fa-trash"></i></button>` : '<span style="font-size:0.75rem; color:var(--text-muted); margin-left:0.5rem;">Current</span>'}
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) { console.error("Users load error", err); }
}

async function populateUserModalProjects(selectedProjId = '') {
  try {
    const projects = await apiFetch('/projects');
    const select = document.getElementById('newAssignedProject');
    if (!select) return;
    const defaultOpt = '<option value="">All / Unassigned</option>';
    const projOpts = projects.map(p => {
      const sel = p.id === selectedProjId ? 'selected' : '';
      return `<option value="${p.id}" ${sel}>${escapeHtml(p.name)}</option>`;
    }).join('');
    select.innerHTML = defaultOpt + projOpts;
  } catch (e) {
    console.error("Failed to load project choices for user modal", e);
  }
}

async function openUserModal(user = null) {
  document.getElementById('userForm').reset();
  const title = document.getElementById('userModalTitle');
  const btn = document.getElementById('userSubmitBtn');
  const pwdLabel = document.getElementById('userPasswordLabel');
  const pwdInput = document.getElementById('newPassword');
  const unameInput = document.getElementById('newUsername');

  await populateUserModalProjects(user ? (user.assigned_project_id || '') : '');

  const defaultTabs = ['dashboard', 'attendance', 'workers', 'projects', 'groups'];
  const userTabs = (user && user.allowed_tabs) ? user.allowed_tabs : defaultTabs;

  document.querySelectorAll('.tab-perm-checkbox').forEach(cb => {
    cb.checked = userTabs.includes(cb.value);
  });

  const roleSelect = document.getElementById('newRole');
  roleSelect.disabled = false;
  roleSelect.title = '';

  if (user) {
    if (title) title.innerText = `Edit Site Manager Account: ${user.username}`;
    if (btn) btn.innerText = 'Save Changes';
    document.getElementById('editUsername').value = user.username;
    unameInput.value = user.username;
    unameInput.disabled = true;
    if (pwdLabel) pwdLabel.innerHTML = 'Password <small style="font-weight:400; font-size:0.72rem; color:var(--text-muted);">(blank = keep)</small>';
    pwdInput.required = false;
    pwdInput.value = '';
    pwdInput.placeholder = 'Leave blank to keep current';
    document.getElementById('newFullName').value = user.full_name || '';
    roleSelect.value = user.role || 'site_manager';
    document.getElementById('newPhone').value = user.phone || user.email || '';

    if (user.role === 'admin') {
      try {
        const allUsers = await apiFetch('/admin/users');
        const adminCount = allUsers.filter(u => u.role === 'admin').length;
        if (adminCount <= 1) {
          roleSelect.disabled = true;
          roleSelect.title = "Cannot change role: System requires at least one active Admin account.";
        }
      } catch (err) { }
    }
  } else {
    if (title) title.innerText = 'Create Site Manager Account';
    if (btn) btn.innerText = 'Create Account';
    document.getElementById('editUsername').value = '';
    unameInput.disabled = false;
    unameInput.required = true;
    if (pwdLabel) pwdLabel.innerText = 'Password *';
    pwdInput.required = true;
    pwdInput.value = '';
    pwdInput.placeholder = '••••••••';
    document.getElementById('newPhone').value = '';
  }

  document.getElementById('userModal').classList.add('show');
}

async function editUser(username) {
  try {
    const users = await apiFetch('/admin/users');
    const user = users.find(u => u.username === username);
    if (user) openUserModal(user);
  } catch (err) {
    alert("Could not load user details: " + err.message);
  }
}

async function saveUser(e) {
  e.preventDefault();
  const editUname = document.getElementById('editUsername').value;
  const projSelect = document.getElementById('newAssignedProject');
  const selectedProjOption = projSelect && projSelect.selectedIndex >= 0 ? projSelect.options[projSelect.selectedIndex] : null;

  const phoneVal = document.getElementById('newPhone').value.trim();
  const checkedTabs = Array.from(document.querySelectorAll('.tab-perm-checkbox:checked')).map(cb => cb.value);
  const roleSelect = document.getElementById('newRole');

  const payload = {
    username: document.getElementById('newUsername').value.trim(),
    full_name: document.getElementById('newFullName').value.trim(),
    role: roleSelect.value || (roleSelect.disabled ? 'admin' : 'site_manager'),
    phone: phoneVal,
    email: phoneVal,
    assigned_project_id: projSelect ? projSelect.value : '',
    assigned_project_name: projSelect && projSelect.value ? (selectedProjOption ? selectedProjOption.text : '') : '',
    allowed_tabs: checkedTabs
  };

  const pwd = document.getElementById('newPassword').value.trim();
  if (pwd) payload.password = pwd;

  try {
    if (editUname) {
      await apiFetch(`/admin/users/${encodeURIComponent(editUname)}`, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      if (!pwd) { alert("Password is required for new accounts"); return; }
      await apiFetch('/admin/users', { method: 'POST', body: JSON.stringify(payload) });
    }
    closeModal('userModal');
    loadUsersTable();
  } catch (err) {
    alert("Error saving user: " + err.message);
  }
}

async function deleteUser(username) {
  if (!confirm(`Delete user account ${username}?`)) return;
  try {
    await apiFetch(`/admin/users/${encodeURIComponent(username)}`, { method: 'DELETE' });
    loadUsersTable();
  } catch (err) {
    alert("Delete failed: " + err.message);
  }
}


// Utility Modal Closes
function closeModal(modalId) {
  const el = document.getElementById(modalId);
  if (el) el.classList.remove('show');
}

// ── Face Recognition Attendance Engine ────────────────────────────────
let _faceApiModelsLoaded = false;
let _faceScannerStream = null;
let _faceScanInterval = null;
let _isScannerCameraRunning = false;
let _activeMatchedWorker = null;
let _activeWorkerHasCheckInToday = false;
let _activeWorkerExistingCheckIn = null;
let _activeWorkerExistingCheckOut = null;
let _activeWorkerExistingNotes = '';
let _activeWorkerExistingWorkVolume = '';
let _pendingOverwriteRecordType = null;
let _lastMatchTimestamp = 0;
let _workerFaceDescriptors = [];
let _audioSynthContext = null;
let _availableCameraDevices = [];
let _selectedScannerDeviceId = '';

async function loadCameraDevices() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    _availableCameraDevices = devices.filter(d => d.kind === 'videoinput');

    populateCameraDropdown('cameraSelect', _selectedScannerDeviceId);
  } catch (err) {
    console.warn("Could not enumerate camera devices:", err);
  }
}

function populateCameraDropdown(selectId, selectedDeviceId) {
  const select = document.getElementById(selectId);
  if (!select) return;

  const isMobile = window.innerWidth <= 768;
  let prevVal = selectedDeviceId || select.value;

  // On mobile devices, auto-select back/environment camera if user hasn't explicitly chosen one
  if (isMobile && !prevVal && _availableCameraDevices.length > 0) {
    const backCam = _availableCameraDevices.find(d => d.label && /back|rear|environment|main/i.test(d.label));
    if (backCam) {
      prevVal = backCam.deviceId;
    }
  }

  select.innerHTML = '';

  if (_availableCameraDevices.length === 0) {
    select.innerHTML = '<option value="">Default Camera</option>';
    return;
  }

  select.innerHTML = _availableCameraDevices.map((device, index) => {
    const label = device.label || `Camera ${index + 1} (${device.deviceId.slice(0, 6)}...)`;
    const sel = (device.deviceId === prevVal || (index === 0 && !prevVal)) ? 'selected' : '';
    return `<option value="${device.deviceId}" ${sel}>${escapeHtml(label)}</option>`;
  }).join('');

  updateActiveCameraLabel();
}

function updateActiveCameraLabel() {
  const lbl = document.getElementById('lblActiveCameraName');
  if (!lbl) return;

  const currentId = _selectedScannerDeviceId || document.getElementById('cameraSelect')?.value;
  let activeDevice = _availableCameraDevices.find(d => d.deviceId === currentId);
  if (!activeDevice && _availableCameraDevices.length > 0) activeDevice = _availableCameraDevices[0];

  if (activeDevice && activeDevice.label) {
    const cleanLabel = activeDevice.label.replace(/\s*\([0-9a-f:]+\)\s*$/i, '').trim();
    lbl.innerText = cleanLabel || 'Default Camera';
  } else {
    lbl.innerText = 'Default Camera';
  }
}

async function cycleNextCamera() {
  await loadCameraDevices();
  if (!_availableCameraDevices || _availableCameraDevices.length === 0) {
    alert("No camera devices detected on your system.");
    return;
  }

  const currentId = _selectedScannerDeviceId || document.getElementById('cameraSelect')?.value;
  let currentIndex = _availableCameraDevices.findIndex(d => d.deviceId === currentId);
  if (currentIndex === -1) currentIndex = 0;

  const nextIndex = (currentIndex + 1) % _availableCameraDevices.length;
  const nextDevice = _availableCameraDevices[nextIndex];
  _selectedScannerDeviceId = nextDevice.deviceId;

  const select = document.getElementById('cameraSelect');
  if (select) select.value = nextDevice.deviceId;

  updateActiveCameraLabel();

  const btn = document.getElementById('btnCycleCamera');
  const label = nextDevice.label || `Camera ${nextIndex + 1}`;
  if (btn) btn.title = `Switch Camera (Active: ${label})`;

  if (_isScannerCameraRunning) {
    await startFaceScannerCamera(nextDevice.deviceId);
  }
}

let _isInitializingFaceScanner = false;

async function initFaceScanner(isSilent = false) {
  if (_isInitializingFaceScanner) return;
  _isInitializingFaceScanner = true;

  // Pre-set time input
  const timeInput = document.getElementById('scanRecordTime');
  if (timeInput && !timeInput.value) { timeInput.value = getCurrentTimeStr(); }

  // Load available cameras, AI models, and worker face catalog concurrently
  await Promise.all([
    loadCameraDevices().catch(e => console.warn("Camera load notice:", e)),
    loadFaceApiModels().catch(e => console.warn("Models load notice:", e)),
    indexWorkerFaceCatalog().catch(e => console.warn("Catalog index notice:", e))
  ]);

  _isInitializingFaceScanner = false;
}

let _faceApiScriptLoadingPromise = null;

function ensureFaceApiScriptLoaded() {
  if (typeof faceapi !== 'undefined') return Promise.resolve();
  if (_faceApiScriptLoadingPromise) return _faceApiScriptLoadingPromise;

  _faceApiScriptLoadingPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'models/face-api.js';
    script.onload = () => resolve();
    script.onerror = () => {
      console.warn("Local face-api.js failed to load, trying CDN...");
      const cdnScript = document.createElement('script');
      cdnScript.src = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.12/dist/face-api.js';
      cdnScript.onload = () => resolve();
      cdnScript.onerror = (e) => reject(e);
      document.head.appendChild(cdnScript);
    };
    document.head.appendChild(script);
  });
  return _faceApiScriptLoadingPromise;
}

async function loadFaceApiModels() {
  const badge = document.getElementById('aiEngineStatusBadge');
  if (_faceApiModelsLoaded) return;
  try {
    await ensureFaceApiScriptLoaded().catch(e => console.warn("face-api script load notice:", e));
    if (typeof faceapi !== 'undefined') {
      let MODEL_URL = '/models/';
      try {
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
          faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
          faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
          faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL)
        ]);
      } catch (localLoadErr) {
        console.warn("Local models not ready, falling back to CDN:", localLoadErr);
        MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.12/model/';
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
          faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
          faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
          faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL)
        ]);
      }
      _faceApiModelsLoaded = true;

      // WebGL Shader Warmup: Perform a 1-frame dummy detection to pre-compile WebGL shaders in background
      try {
        const warmupCanvas = document.createElement('canvas');
        warmupCanvas.width = 64;
        warmupCanvas.height = 64;
        const ctx = warmupCanvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#808080';
          ctx.fillRect(0, 0, 64, 64);
        }
        await faceapi.detectSingleFace(warmupCanvas, new faceapi.TinyFaceDetectorOptions({ inputSize: 160 })).withFaceLandmarks().withFaceDescriptor();
      } catch (wErr) {
        console.warn("Face model WebGL warmup notice:", wErr);
      }

      if (badge && _workerFaceDescriptors && _workerFaceDescriptors.length > 0) {
        badge.className = 'scanner-status-badge badge-ready';
        badge.innerHTML = `<i class="fa-solid fa-circle-check"></i> Face Engine Ready (${_workerFaceDescriptors.filter(d => d.descriptor).length} Indexed)`;
      } else if (badge) {
        badge.className = 'scanner-status-badge badge-ready';
        badge.innerHTML = '<i class="fa-solid fa-circle-dot"></i> Face Engine Ready';
      }
    } else {
      console.warn("faceapi JS library not yet available");
      if (badge) {
        badge.className = 'scanner-status-badge badge-ready';
        badge.innerHTML = '<i class="fa-solid fa-circle-check"></i> Image Scanner Ready';
      }
    }
  } catch (err) {
    console.error("Error loading face-api models:", err);
    if (badge) {
      badge.className = 'scanner-status-badge badge-ready';
      badge.innerHTML = '<i class="fa-solid fa-circle-check"></i> Image Scanner Ready';
    }
  }
}

async function indexWorkerFaceCatalog() {
  const badge = document.getElementById('aiEngineStatusBadge');

  // 1. Immediately hydrate from localStorage cache if available (instant 0ms startup)
  try {
    const cachedLocal = localStorage.getItem('worker_face_descriptors_cache');
    if (cachedLocal) {
      const parsed = JSON.parse(cachedLocal);
      if (Array.isArray(parsed) && parsed.length > 0) {
        _workerFaceDescriptors = parsed.map(item => ({
          ...item,
          descriptor: item.descriptor ? new Float32Array(item.descriptor) : null
        }));
        if (badge) {
          badge.className = 'scanner-status-badge badge-ready';
          badge.innerHTML = `<i class="fa-solid fa-circle-check"></i> Face Engine Ready (${_workerFaceDescriptors.filter(d => d.descriptor).length} Indexed)`;
        }
      }
    }
  } catch (cErr) {
    console.warn("Local catalog hydration notice:", cErr);
  }

  try {
    if (badge && (!_workerFaceDescriptors || _workerFaceDescriptors.length === 0) && _faceApiModelsLoaded) {
      badge.className = 'scanner-status-badge badge-active';
      badge.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Loading Index Cache...';
    }

    // 2. Fetch pre-cached face descriptors from server (index.pickle)
    const catalogData = await apiFetch('/face-descriptors');

    // 3. Process missing descriptors concurrently in parallel
    const extractSingleDescriptor = async (item) => {
      const w = item.worker;
      const imgUrl = item.imgUrl;
      let descriptor = item.descriptor ? new Float32Array(item.descriptor) : null;

      if (!descriptor && imgUrl && imgUrl.trim() && _faceApiModelsLoaded && typeof faceapi !== 'undefined') {
        try {
          let fetchTargetUrl = imgUrl.trim();
          if (fetchTargetUrl.startsWith('http://') || fetchTargetUrl.startsWith('https://')) {
            fetchTargetUrl = `${API_BASE}/proxy-image?url=${encodeURIComponent(fetchTargetUrl)}`;
          }

          const img = await faceapi.fetchImage(fetchTargetUrl);

          let detection = null;
          try {
            detection = await faceapi.detectSingleFace(img, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.15 }))
              .withFaceLandmarks()
              .withFaceDescriptor();
          } catch (e1) { }

          if (!detection) {
            try {
              detection = await faceapi.detectSingleFace(img, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.15 }))
                .withFaceLandmarks()
                .withFaceDescriptor();
            } catch (e2) { }
          }

          if (detection && detection.descriptor) {
            descriptor = detection.descriptor;
            // Cache to index.pickle on server for instant future reloads
            apiFetch('/face-descriptors/cache', {
              method: 'POST',
              body: JSON.stringify({
                worker_id: w.id,
                descriptor: Array.from(descriptor)
              })
            }).catch(e => console.warn("Failed to cache descriptor:", e));
          }
        } catch (imgErr) {
          console.warn(`Could not extract face descriptor for worker ${w.name}:`, imgErr);
        }
      }

      return {
        worker: w,
        imgUrl: imgUrl,
        name: w.name,
        descriptor: descriptor
      };
    };

    const freshDescriptors = await Promise.all(catalogData.map(item => extractSingleDescriptor(item)));
    _workerFaceDescriptors = freshDescriptors;

    // Update localStorage cache with fresh array
    try {
      const serializableCatalog = freshDescriptors.map(item => ({
        worker: item.worker,
        imgUrl: item.imgUrl,
        name: item.name,
        descriptor: item.descriptor ? Array.from(item.descriptor) : null
      }));
      localStorage.setItem('worker_face_descriptors_cache', JSON.stringify(serializableCatalog));
    } catch (sErr) {
      console.warn("Failed to save catalog to localStorage:", sErr);
    }

    if (badge) {
      badge.className = 'scanner-status-badge badge-ready';
      badge.innerHTML = `<i class="fa-solid fa-circle-check"></i> Face Engine Ready (${_workerFaceDescriptors.filter(d => d.descriptor).length} Indexed)`;
    }
  } catch (err) {
    console.error("Error indexing worker faces:", err);
  }
}



async function toggleFaceScannerCamera() {
  if (_isScannerCameraRunning) {
    stopFaceScannerCamera();
  } else {
    await startFaceScannerCamera();
  }
}

async function startFaceScannerCamera(deviceId = null) {
  const video = document.getElementById('faceWebcam');
  const btnLbl = document.getElementById('lblStartCamera');
  const btnIcon = document.getElementById('btnCameraIcon');
  const wrapper = document.getElementById('viewfinderWrapper');

  if (!video) return;

  const targetDeviceId = deviceId || document.getElementById('cameraSelect')?.value || _selectedScannerDeviceId;
  const isMobileView = window.innerWidth <= 768;
  const defaultFacingMode = isMobileView ? "environment" : "user";

  // Mobile-optimized resolution constraints: 640x480 ideal for mobile to eliminate frame decoding lag
  const videoConstraints = targetDeviceId
    ? { deviceId: { exact: targetDeviceId }, width: { ideal: isMobileView ? 640 : 1280 }, height: { ideal: isMobileView ? 480 : 720 } }
    : { width: { ideal: isMobileView ? 640 : 1280 }, height: { ideal: isMobileView ? 480 : 720 }, facingMode: defaultFacingMode };

  try {
    if (_faceScannerStream) {
      _faceScannerStream.getTracks().forEach(t => t.stop());
    }

    _faceScannerStream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints });

    video.srcObject = _faceScannerStream;

    await video.play();
    _isScannerCameraRunning = true;

    // Pre-compile WebGL GLSL GPU shaders for live video element
    if (_faceApiModelsLoaded && typeof faceapi !== 'undefined') {
      try {
        const isMobileView = window.innerWidth <= 768;
        const detectorInputSize = isMobileView ? 160 : 256;
        await faceapi.detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: detectorInputSize }))
          .withFaceLandmarks()
          .withFaceDescriptor();
      } catch (wErr) {
        console.warn("Live video GPU shader warmup notice:", wErr);
      }
    }

    // Load/refresh available camera devices after permission is granted
    await loadCameraDevices();

    if (wrapper) wrapper.classList.add('scanning-active');
    if (btnLbl) btnLbl.innerText = 'Stop Camera Scanner';
    if (btnIcon) btnIcon.className = 'fa-solid fa-video-slash';

    // Start scanner frame detection loop
    runFaceScannerLoop();
  } catch (err) {
    console.error("Camera access failed:", err);
    alert("Could not access camera: " + err.message + "\nPlease grant camera permissions in your browser.");
  }
}

async function changeScannerCamera(deviceId) {
  _selectedScannerDeviceId = deviceId;
  if (_isScannerCameraRunning) {
    await startFaceScannerCamera(deviceId);
  }
}

function stopFaceScannerCamera() {
  if (_faceScannerStream) {
    _faceScannerStream.getTracks().forEach(t => t.stop());
    _faceScannerStream = null;
  }
  if (_faceScanInterval) {
    clearInterval(_faceScanInterval);
    _faceScanInterval = null;
  }
  _isScannerCameraRunning = false;

  const video = document.getElementById('faceWebcam');
  if (video) {
    video.srcObject = null;
    video.onloadedmetadata = null;
    video.onloadeddata = null;
  }

  const btnLbl = document.getElementById('lblStartCamera');
  const btnIcon = document.getElementById('btnCameraIcon');
  const wrapper = document.getElementById('viewfinderWrapper');

  if (wrapper) {
    wrapper.classList.remove('scanning-active');
  }
  if (btnLbl) btnLbl.innerText = 'Start Camera Scanner';
  if (btnIcon) btnIcon.className = 'fa-solid fa-video';

  // Clear overlay canvas
  const canvas = document.getElementById('faceOverlayCanvas');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

const MAX_FACE_MATCH_DISTANCE = 0.48; // Optimal Euclidean distance threshold for faceRecognitionNet
let _isScanLoopProcessing = false;
let _consecutiveMatchCount = 0;
let _consecutiveMatchedWorkerId = null;

function runFaceScannerLoop() {
  if (_faceScanInterval) clearInterval(_faceScanInterval);
  _consecutiveMatchCount = 0;
  _consecutiveMatchedWorkerId = null;

  _faceScanInterval = setInterval(async () => {
    if (!_isScannerCameraRunning || _activeMatchedWorker || _isScanLoopProcessing) return;
    const video = document.getElementById('faceWebcam');
    const canvas = document.getElementById('faceOverlayCanvas');

    if (!video || video.paused || video.ended || video.readyState < 2) return;

    _isScanLoopProcessing = true;

    const vWidth = video.videoWidth || 640;
    const vHeight = video.videoHeight || 480;
    const cWidth = canvas ? (canvas.clientWidth || 240) : 240;
    const cHeight = canvas ? (canvas.clientHeight || 240) : 240;

    if (canvas && (canvas.width !== cWidth || canvas.height !== cHeight)) {
      canvas.width = cWidth;
      canvas.height = cHeight;
    }

    try {
      if (_faceApiModelsLoaded && typeof faceapi !== 'undefined') {
        const isMobileView = window.innerWidth <= 768;
        // Mobile input size 160/224 runs 10x faster on mobile GPUs (~8-15ms per frame)
        const detectorInputSize = isMobileView ? 160 : 256;

        // Single-Pass Face Detection, Landmarks & Descriptor Computation
        const detection = await faceapi.detectSingleFace(
          video,
          new faceapi.TinyFaceDetectorOptions({ inputSize: detectorInputSize, scoreThreshold: 0.30 })
        ).withFaceLandmarks().withFaceDescriptor();

        if (canvas) {
          const ctx = canvas.getContext('2d');

          if (!detection) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            _consecutiveMatchCount = 0;
            _consecutiveMatchedWorkerId = null;
            return;
          }

          ctx.clearRect(0, 0, canvas.width, canvas.height);

          if (detection) {
            const scale = Math.max(cWidth / vWidth, cHeight / vHeight);
            const offsetX = (cWidth - (vWidth * scale)) / 2;
            const offsetY = (cHeight - (vHeight * scale)) / 2;

            const box = detection.detection.box;
            const bx = box.x * scale + offsetX;
            const by = box.y * scale + offsetY;
            const bw = box.width * scale;
            const bh = box.height * scale;

            // Reject faces that are too small in the viewfinder (under 35px wide)
            if (bw >= 35 && bh >= 35 && _workerFaceDescriptors.length > 0) {
              const bestMatch = findBestWorkerMatch(detection.descriptor);
              if (bestMatch && bestMatch.worker) {
                // Known Worker Matched: Green bounding box
                ctx.strokeStyle = '#10B981';
                ctx.lineWidth = 2.5;
                if (ctx.roundRect) {
                  ctx.beginPath();
                  ctx.roundRect(bx, by, bw, bh, 8);
                  ctx.stroke();
                } else {
                  ctx.strokeRect(bx, by, bw, bh);
                }

                // Name Tag
                const labelText = `${bestMatch.worker.name} (${bestMatch.score}%)`;
                const textY = Math.max(14, by - 6);
                ctx.fillStyle = '#10B981';
                ctx.font = 'bold 11px sans-serif';
                ctx.fillText(labelText, bx, textY);

                if (_consecutiveMatchedWorkerId === bestMatch.worker.id) {
                  _consecutiveMatchCount++;
                } else {
                  _consecutiveMatchedWorkerId = bestMatch.worker.id;
                  _consecutiveMatchCount = 1;
                }

                // High-confidence match (>=82%) triggers immediately on frame 1 for instant response on mobile
                const requiredFrames = bestMatch.score >= 82 ? 1 : 2;
                const now = Date.now();
                if (_consecutiveMatchCount >= requiredFrames && (!_activeMatchedWorker || _activeMatchedWorker.id !== bestMatch.worker.id || (now - _lastMatchTimestamp > 4000))) {
                  _lastMatchTimestamp = now;
                  _consecutiveMatchCount = 0;
                  _consecutiveMatchedWorkerId = null;
                  handleWorkerFaceRecognized(bestMatch.worker, bestMatch.score);
                }
              } else {
                _consecutiveMatchCount = 0;
                _consecutiveMatchedWorkerId = null;

                // Unknown Person: Red bounding box
                ctx.strokeStyle = '#EF4444';
                ctx.lineWidth = 2;
                if (ctx.roundRect) {
                  ctx.beginPath();
                  ctx.roundRect(bx, by, bw, bh, 8);
                  ctx.stroke();
                } else {
                  ctx.strokeRect(bx, by, bw, bh);
                }

                const labelText = 'Unknown Face';
                const textY = Math.max(14, by - 6);
                ctx.fillStyle = '#EF4444';
                ctx.font = 'bold 11px sans-serif';
                ctx.fillText(labelText, bx, textY);

                const badge = document.getElementById('aiEngineStatusBadge');
                if (badge && !_activeMatchedWorker) {
                  badge.className = 'scanner-status-badge badge-error';
                  badge.innerHTML = '<i class="fa-solid fa-user-xmark"></i> Unknown Person (No Match)';
                }
              }
            }
          } else {
            _consecutiveMatchCount = 0;
            _consecutiveMatchedWorkerId = null;
          }
        }
      }
    } catch (e) {
      // Loop error catch
    } finally {
      _isScanLoopProcessing = false;
    }
  }, 120);
}

function findBestWorkerMatch(inputDescriptor) {
  if (!_workerFaceDescriptors || !_workerFaceDescriptors.length) return null;

  let bestWorker = null;
  let bestDistance = Infinity;
  let secondBestDistance = Infinity;

  for (const item of _workerFaceDescriptors) {
    if (item.descriptor) {
      const distance = faceapi.euclideanDistance(inputDescriptor, item.descriptor);
      if (distance < bestDistance) {
        secondBestDistance = bestDistance;
        bestDistance = distance;
        bestWorker = item.worker;
      } else if (distance < secondBestDistance) {
        secondBestDistance = distance;
      }
    }
  }

  // 1. Distance Threshold check
  if (!bestWorker || bestDistance > MAX_FACE_MATCH_DISTANCE) {
    return null;
  }

  // 2. Ambiguity Guard: If second best match is dangerously close to top match, treat as ambiguous
  if (secondBestDistance !== Infinity && (secondBestDistance - bestDistance < 0.04) && bestDistance > 0.38) {
    console.warn(`[Face Match Ambiguous] Top match ${bestWorker.name} (${bestDistance.toFixed(3)}) too close to 2nd match (${secondBestDistance.toFixed(3)})`);
    return null;
  }

  const score = Math.min(99, Math.max(72, Math.round((1 - (bestDistance / 0.55)) * 40 + 60)));
  return { worker: bestWorker, score: score, distance: bestDistance };
}

async function handleWorkerFaceRecognized(worker, matchScore) {
  _activeMatchedWorker = worker;
  playSuccessAudioChime();

  // Stop the full camera process when match is found
  stopFaceScannerCamera();

  const content = document.getElementById('matchedWorkerContent');
  if (content) content.style.display = 'block';

  const overlay = document.getElementById('matchedWorkerFloatingOverlay');
  if (overlay) overlay.classList.add('show');

  const canvas = document.getElementById('faceOverlayCanvas');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  // Set worker details
  const img = (worker.picture_url && worker.picture_url.trim()) ? worker.picture_url.trim() : DEFAULT_WORKER_IMG;
  document.getElementById('matchedWorkerImg').src = img;
  document.getElementById('matchedWorkerName').innerText = worker.name;
  document.getElementById('matchedWorkerPassport').innerText = worker.passport_number || 'No Passport';
  document.getElementById('matchedWorkerProject').innerText = worker.project_name || 'Unassigned';
  document.getElementById('matchedWorkerGroup').innerText = worker.group_name || 'General';
  document.getElementById('lblMatchScore').innerText = `${matchScore}% Match`;

  // Time default setup
  const timeInput = document.getElementById('scanRecordTime');
  if (timeInput) timeInput.value = getCurrentTimeStr();

  // Update status badge
  const badge = document.getElementById('aiEngineStatusBadge');
  if (badge) {
    badge.className = 'scanner-status-badge badge-matched';
    badge.innerHTML = `<i class="fa-solid fa-circle-check"></i> Matched: ${worker.name}`;
  }

  // Check daily check-in status automatically
  _activeWorkerHasCheckInToday = false;
  _activeWorkerExistingCheckIn = null;
  _activeWorkerExistingCheckOut = null;
  _activeWorkerExistingNotes = '';
  _activeWorkerExistingWorkVolume = '';
  const btnIn = document.getElementById('btnConfirmCheckIn');
  const btnOut = document.getElementById('btnConfirmCheckOut');
  const scanTimeModeLbl = document.getElementById('lblScanTimeMode');

  try {
    const todayStr = getLocalDateString(new Date());
    const attHistory = await apiFetch(`/attendance/worker/${worker.id}?start_date=${todayStr}&end_date=${todayStr}`);
    if (attHistory && attHistory.records && attHistory.records.length > 0) {
      const todayRec = attHistory.records[0];
      if (todayRec.check_in) {
        _activeWorkerHasCheckInToday = true;
        _activeWorkerExistingCheckIn = todayRec.check_in;
      }
      if (todayRec.check_out) {
        _activeWorkerExistingCheckOut = todayRec.check_out;
      }
      if (todayRec.notes) {
        _activeWorkerExistingNotes = todayRec.notes;
      }
      if (todayRec.work_volume) {
        _activeWorkerExistingWorkVolume = todayRec.work_volume;
      }
    }
  } catch (e) {
    console.warn("Failed to check daily checkin state:", e);
  }

  if (btnIn && btnOut) {
    if (_activeWorkerHasCheckInToday) {
      btnIn.style.display = 'block';
      btnOut.style.display = 'block';
      if (scanTimeModeLbl) scanTimeModeLbl.innerText = 'Check-In / Out Detection';
    } else {
      btnIn.style.display = 'block';
      btnOut.style.display = 'none';
      if (scanTimeModeLbl) scanTimeModeLbl.innerText = 'Check-In Detection';
    }
  }

  const notesGroup = document.getElementById('scanWorkVolumeNotesGroup');
  const notesEl = document.getElementById('scanRecordNotes');
  if (notesGroup) {
    notesGroup.style.display = _activeWorkerHasCheckInToday ? 'block' : 'none';
  }
  if (notesEl) {
    if (_activeWorkerHasCheckInToday) {
      notesEl.placeholder = "Daily work volume (e.g. 12m2 plastering)";
      notesEl.value = _activeWorkerExistingWorkVolume || '';
    } else {
      notesEl.placeholder = "Check-In notes (Optional)";
      notesEl.value = _activeWorkerExistingNotes || '';
    }
  }
}

// Custom Inline Error Pane Handlers for Matched Worker Card
function showMatchedWorkerError(title, message) {
  const form = document.getElementById('matchedAttendanceForm');
  const confirmPane = document.getElementById('matchedWorkerOverwriteConfirmPane');
  const successPane = document.getElementById('matchedWorkerSuccessPane');
  const errorPane = document.getElementById('matchedWorkerErrorPane');

  const titleEl = document.getElementById('lblErrorTitle');
  const detailsEl = document.getElementById('lblErrorDetails');

  if (titleEl) titleEl.innerText = title || "Invalid Input";
  if (detailsEl) detailsEl.innerText = message || "An error occurred.";

  if (form) form.style.display = 'none';
  if (confirmPane) confirmPane.style.display = 'none';
  if (successPane) successPane.style.display = 'none';
  if (errorPane) errorPane.style.display = 'block';
}

function dismissMatchedWorkerError() {
  const form = document.getElementById('matchedAttendanceForm');
  const errorPane = document.getElementById('matchedWorkerErrorPane');

  if (form) form.style.display = 'block';
  if (errorPane) errorPane.style.display = 'none';
}

async function submitMatchedAttendance(recordType, bypassWarning = false) {
  if (!_activeMatchedWorker) return;

  const timeVal = (document.getElementById('scanRecordTime') && document.getElementById('scanRecordTime').value) || getCurrentTimeStr();

  // Validate sequence: Check-In and Check-Out cannot be identical
  const proposedCheckIn = (recordType === 'CheckIn') ? timeVal : _activeWorkerExistingCheckIn;
  const proposedCheckOut = (recordType === 'CheckOut') ? timeVal : _activeWorkerExistingCheckOut;

  if (proposedCheckIn && proposedCheckOut && proposedCheckIn === proposedCheckOut) {
    showMatchedWorkerError(
      "Invalid Attendance Times",
      `Check-In time (${proposedCheckIn}) and Check-Out time (${proposedCheckOut}) cannot be identical.`
    );
    return;
  }

  // Show custom modal warning instead of confirm() browser popup
  if (!bypassWarning) {
    if (recordType === 'CheckIn' && _activeWorkerExistingCheckIn) {
      _pendingOverwriteRecordType = recordType;
      const form = document.getElementById('matchedAttendanceForm');
      const confirmPane = document.getElementById('matchedWorkerOverwriteConfirmPane');
      const textLabel = document.getElementById('lblOverwriteConfirmText');
      if (textLabel) textLabel.innerText = "An attendance check-in record already exists for today. Overwriting will replace the check-in time.";
      if (form) form.style.display = 'none';
      if (confirmPane) confirmPane.style.display = 'block';
      return;
    }

    if (recordType === 'CheckOut' && _activeWorkerExistingCheckOut) {
      _pendingOverwriteRecordType = recordType;
      const form = document.getElementById('matchedAttendanceForm');
      const confirmPane = document.getElementById('matchedWorkerOverwriteConfirmPane');
      const textLabel = document.getElementById('lblOverwriteConfirmText');
      if (textLabel) textLabel.innerText = "An attendance check-out record already exists for today. Overwriting will replace the check-out time.";
      if (form) form.style.display = 'none';
      if (confirmPane) confirmPane.style.display = 'block';
      return;
    }
  }

  const workerId = _activeMatchedWorker.id;
  const targetDate = getLocalDateString(new Date());
  const statusVal = (recordType === 'CheckIn' && timeVal > '09:00') ? 'Late' : 'Present';
  const inputVal = (document.getElementById('scanRecordNotes') && document.getElementById('scanRecordNotes').value) || '';

  const payload = {
    worker_id: workerId,
    date: targetDate,
    status: statusVal,
    notes: (recordType === 'CheckIn') ? inputVal : (_activeWorkerExistingNotes || ''),
    work_volume: (recordType === 'CheckOut') ? inputVal : (_activeWorkerExistingWorkVolume || ''),
    check_in: proposedCheckIn,
    check_out: proposedCheckOut
  };

  try {
    const res = await apiFetch('/attendance/record', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    const actionText = (recordType === 'CheckIn') ? 'Check-In' : 'Check-Out';

    // Custom inline success pane display instead of browser alert()
    const form = document.getElementById('matchedAttendanceForm');
    const successPane = document.getElementById('matchedWorkerSuccessPane');
    const successWorkerName = document.getElementById('lblSuccessWorkerName');
    const successActionDetails = document.getElementById('lblSuccessActionDetails');

    if (successWorkerName) successWorkerName.innerText = _activeMatchedWorker.name;
    if (successActionDetails) {
      if (recordType === 'CheckOut') {
        const hrs = (res.hours_worked !== undefined) ? res.hours_worked : calculateHoursJS(payload.check_in, payload.check_out);
        successActionDetails.innerText = `${actionText} at ${timeVal} (${hrs} hrs)`;
      } else {
        successActionDetails.innerText = `${actionText} at ${timeVal} (${statusVal})`;
      }
    }

    if (form) form.style.display = 'none';
    if (successPane) successPane.style.display = 'block';

    // Hold for 2 seconds so user can comfortably read confirmation message, then reset
    setTimeout(() => {
      resetMatchedWorkerUI();
    }, 2000);

  } catch (err) {
    showMatchedWorkerError("Submission Failed", err.message || "Attendance recording failed.");
  }
}

function cancelOverwriteConfirm() {
  const form = document.getElementById('matchedAttendanceForm');
  const confirmPane = document.getElementById('matchedWorkerOverwriteConfirmPane');
  if (form) form.style.display = 'block';
  if (confirmPane) confirmPane.style.display = 'none';
  _pendingOverwriteRecordType = null;
}

async function proceedWithOverwrite() {
  if (_pendingOverwriteRecordType) {
    const type = _pendingOverwriteRecordType;
    // Hide overwrite confirm pane
    const form = document.getElementById('matchedAttendanceForm');
    const confirmPane = document.getElementById('matchedWorkerOverwriteConfirmPane');
    if (form) form.style.display = 'block';
    if (confirmPane) confirmPane.style.display = 'none';

    _pendingOverwriteRecordType = null;
    await submitMatchedAttendance(type, true);
  }
}

async function resetMatchedWorkerUI() {
  const overlay = document.getElementById('matchedWorkerFloatingOverlay');
  if (overlay) overlay.classList.remove('show');

  const notesEl = document.getElementById('scanRecordNotes');
  if (notesEl) notesEl.value = '';

  const badge = document.getElementById('aiEngineStatusBadge');
  if (badge) {
    badge.className = 'scanner-status-badge badge-ready';
    badge.innerHTML = '<i class="fa-solid fa-circle-dot"></i> Face Engine Ready';
  }

  // Allow 250ms for smooth modal fade-out transition to finish
  setTimeout(() => {
    _activeMatchedWorker = null;
    _pendingOverwriteRecordType = null;

    const content = document.getElementById('matchedWorkerContent');
    if (content) content.style.display = 'none';

    const form = document.getElementById('matchedAttendanceForm');
    const confirmPane = document.getElementById('matchedWorkerOverwriteConfirmPane');
    const successPane = document.getElementById('matchedWorkerSuccessPane');
    const errorPane = document.getElementById('matchedWorkerErrorPane');
    if (form) form.style.display = 'block';
    if (confirmPane) confirmPane.style.display = 'none';
    if (successPane) successPane.style.display = 'none';
    if (errorPane) errorPane.style.display = 'none';
  }, 250);

  // Immediately restart camera for next scan
  await startFaceScannerCamera();
}

function playSuccessAudioChime() {
  try {
    if (!_audioSynthContext) {
      _audioSynthContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (_audioSynthContext.state === 'suspended') {
      _audioSynthContext.resume();
    }
    const osc = _audioSynthContext.createOscillator();
    const gain = _audioSynthContext.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, _audioSynthContext.currentTime); // D5
    osc.frequency.exponentialRampToValueAtTime(880, _audioSynthContext.currentTime + 0.15); // A5
    gain.gain.setValueAtTime(0.3, _audioSynthContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, _audioSynthContext.currentTime + 0.3);
    osc.connect(gain);
    gain.connect(_audioSynthContext.destination);
    osc.start();
    osc.stop(_audioSynthContext.currentTime + 0.3);
  } catch (e) { }
}

// Face Scanner Options Dropdown Menu Handler
function toggleFaceScanOptionsMenu(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('faceScanOptionsMenu');
  if (menu) {
    menu.classList.toggle('show');
  }
}

document.addEventListener('click', (e) => {
  const menu = document.getElementById('faceScanOptionsMenu');
  if (menu && menu.classList.contains('show')) {
    if (!e.target.closest('.face-scan-menu-wrapper')) {
      menu.classList.remove('show');
    }
  }
});

// Fallback File Upload Scanner (Admin Only)
function triggerPhotoUploadScan() {
  if (currentUser && currentUser.role !== 'admin') {
    alert("Only Administrators are authorized to scan photo files.");
    return;
  }
  const input = document.getElementById('scanFileInput');
  if (input) input.click();
}

// Admin-Only Reset & Refresh Face Descriptors Index
async function refreshFaceDescriptorsIndex() {
  if (currentUser && currentUser.role !== 'admin') {
    alert("Only Administrators are authorized to refresh the face index.");
    return;
  }

  if (!confirm("Are you sure you want to reset index.pickle and re-extract face descriptors for all workers?\n\nThis will clear the index.pickle cache on the server and re-analyze worker photos.")) {
    return;
  }

  try {
    const badge = document.getElementById('aiEngineStatusBadge');
    if (badge) {
      badge.className = 'scanner-status-badge badge-active';
      badge.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Resetting Index Cache...';
    }

    await apiFetch('/face-descriptors/reset', { method: 'POST' });
    _workerFaceDescriptors = [];
    localStorage.removeItem('worker_face_descriptors_cache');

    await indexWorkerFaceCatalog();

    alert("Face descriptors and index.pickle have been refreshed successfully!");
  } catch (err) {
    console.error("Failed to refresh face descriptors:", err);
    alert("Error refreshing face index: " + err.message);
    const badge = document.getElementById('aiEngineStatusBadge');
    if (badge) {
      badge.className = 'scanner-status-badge badge-ready';
      badge.innerHTML = '<i class="fa-solid fa-circle-dot"></i> Face Engine Ready';
    }
  }
}

async function handleImageFileScan(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (evt) => {
    const base64Data = evt.target.result;

    if (_faceApiModelsLoaded && typeof faceapi !== 'undefined') {
      try {
        const badge = document.getElementById('aiEngineStatusBadge');
        if (badge) {
          badge.className = 'scanner-status-badge badge-active';
          badge.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Analyzing Photo Face...';
        }

        const img = new Image();
        img.src = base64Data;
        await new Promise((resolve) => { img.onload = resolve; });

        const detection = await faceapi.detectSingleFace(img, new faceapi.TinyFaceDetectorOptions())
          .withFaceLandmarks()
          .withFaceDescriptor();

        if (detection && detection.descriptor) {
          const bestMatch = findBestWorkerMatch(detection.descriptor);
          if (bestMatch && bestMatch.worker) {
            handleWorkerFaceRecognized(bestMatch.worker, bestMatch.score);
          } else {
            alert("No matching worker face found in the database for this photo.");
            resetMatchedWorkerUI();
          }
        } else {
          alert("No face detected in the uploaded image. Please upload a clear, front-facing photo.");
          resetMatchedWorkerUI();
        }
      } catch (err) {
        console.error("Face scanning failed:", err);
        alert("Error analyzing image: " + err.message);
        resetMatchedWorkerUI();
      }
    } else if (_workerFaceDescriptors.length > 0) {
      alert("AI Face API models are still loading. Please try again in a moment.");
    } else {
      alert("No workers with face photos are indexed in the system.");
    }
  };
  reader.readAsDataURL(file);
}

function triggerWorkerPhotoFileUpload() {
  const fileInput = document.getElementById('workerPhotoFileInput');
  if (fileInput) fileInput.click();
}

async function handleWorkerPhotoFileUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (evt) => {
    const base64Data = evt.target.result;
    const workerId = document.getElementById('workerId')?.value || '';
    try {
      const res = await apiFetch('/workers/upload-photo', {
        method: 'POST',
        body: JSON.stringify({
          image_data: base64Data,
          worker_id: workerId || null
        })
      });

      if (res.picture_url) {
        document.getElementById('workerPhotoUrl').value = res.picture_url;
        document.getElementById('workerPhotoPreview').src = res.picture_url;
      }
    } catch (err) {
      document.getElementById('workerPhotoUrl').value = base64Data;
      document.getElementById('workerPhotoPreview').src = base64Data;
    }
  };
  reader.readAsDataURL(file);
}

function deleteWorkerPhoto() {
  const photoInput = document.getElementById('workerPhotoUrl');
  const photoPreview = document.getElementById('workerPhotoPreview');
  if (photoInput) photoInput.value = '';
  if (photoPreview) photoPreview.src = DEFAULT_WORKER_IMG;
}
