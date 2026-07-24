/* MOHAMMAD CONSTRUCTION & ENGINEERING SDN.BHD. - Frontend Application Logic */

const API_BASE = '/api';
let currentUser = null;
let authToken = localStorage.getItem('token');

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

  // Set default report date range: 1st day of current month to today
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const startOfMonthStr = `${year}-${month}-01`;
  const reportStartInput = document.getElementById('reportStartDate');
  const reportEndInput = document.getElementById('reportEndDate');
  if (reportStartInput) {
    reportStartInput.max = todayStr;
    if (!reportStartInput.value || reportStartInput.value > todayStr) reportStartInput.value = (startOfMonthStr > todayStr) ? todayStr : startOfMonthStr;
  }
  if (reportEndInput) {
    reportEndInput.max = todayStr;
    if (!reportEndInput.value || reportEndInput.value > todayStr) reportEndInput.value = todayStr;
  }

  const headerDateStr = document.getElementById('headerDateStr');
  if (headerDateStr) {
    const options = { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' };
    headerDateStr.innerText = new Date().toLocaleDateString('en-MY', options);
  }

  if (authToken) {
    checkCurrentAuth();
  } else {
    showLoginOverlay();
  }
});

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

  const savedSection = localStorage.getItem('activeSection') || 'dashboard';
  switchSection(savedSection);
}

function applyRoleBasedAccess() {
  if (!currentUser) return;
  const isSiteManager = (currentUser.role === 'site_manager');
  const allowedTabs = currentUser.allowed_tabs || ['dashboard', 'attendance', 'workers', 'projects', 'groups', 'reports'];

  // Toggle Admin-only elements
  const adminElements = document.querySelectorAll('.admin-only');
  adminElements.forEach(el => {
    el.style.display = (currentUser.role === 'admin') ? 'flex' : 'none';
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
  document.getElementById('app').style.display = 'none';
  document.getElementById('loginOverlay').style.display = 'flex';
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
      const allowedTabs = currentUser.allowed_tabs || ['dashboard', 'attendance', 'workers', 'projects', 'groups', 'reports'];
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
    'attendance': 'Daily Worker Attendance Logger',
    'workers': 'Construction Workers List',
    'projects': 'Construction Project Sites',
    'groups': 'Worker Groups',
    'users': 'Site Managers & Admin Accounts',
    'reports': 'Payroll & Attendance Export'
  };
  document.getElementById('pageTitle').innerText = titleMap[sectionId] || 'Attendance System';

  // Section specific triggers
  if (sectionId === 'dashboard') {
    loadDashboardStats();
    populateLookupWorkers();
    // Default date range to current month on first open
    const todayStr = getLocalDateString(new Date());
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const startEl = document.getElementById('lookupStartDate');
    const endEl   = document.getElementById('lookupEndDate');
    if (startEl) { startEl.max = todayStr; if (!startEl.value) startEl.value = monthStart; }
    if (endEl)   { endEl.max   = todayStr; if (!endEl.value)   endEl.value   = todayStr; }
  }
  if (sectionId === 'attendance') loadAttendanceSheet();
  if (sectionId === 'workers') loadWorkers();
  if (sectionId === 'projects') loadProjectsTable();
  if (sectionId === 'groups') loadGroupsTable();
  if (sectionId === 'users') loadUsersTable();
  if (sectionId === 'reports') loadReportTable();

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
  const list  = document.getElementById('wpList');
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
    const project  = w.project_name   || 'Unassigned';
    const group    = w.group_name     || '';

    const item = document.createElement('div');
    item.className = 'wp-item';
    item.setAttribute('role', 'option');
    item.setAttribute('data-id',       w.id);
    item.setAttribute('data-name',     w.name.toLowerCase());
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
  const panel   = document.getElementById('workerPickerPanel');
  const trigger = document.getElementById('workerPickerTrigger');
  const chevron = document.getElementById('wpChevron');
  const search  = document.getElementById('wpSearchInput');
  const isOpen  = panel.classList.contains('wp-open');

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
  const panel   = document.getElementById('workerPickerPanel');
  const trigger = document.getElementById('workerPickerTrigger');
  const chevron = document.getElementById('wpChevron');
  if (!panel) return;
  panel.classList.remove('wp-open');
  trigger?.setAttribute('aria-expanded', 'false');
  trigger?.classList.remove('wp-active');
  if (chevron) chevron.style.transform = 'rotate(0deg)';
}

function filterWorkerPicker(query) {
  const q     = query.toLowerCase().trim();
  const items = document.querySelectorAll('#wpList .wp-item');
  const empty = document.getElementById('wpEmpty');
  let visible = 0;
  items.forEach(item => {
    const name     = item.getAttribute('data-name')     || '';
    const passport = item.getAttribute('data-passport') || '';
    const match    = !q || name.includes(q) || passport.includes(q);
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
    'Present':  ['badge-present', 'fa-circle-check'],
    'Late':     ['badge-late',    'fa-clock-rotate-left'],
    'Absent':   ['badge-absent',  'fa-user-xmark'],
    'Half-Day': ['badge-halfday', 'fa-circle-half-stroke'],
    'Pending':  ['badge-pending', 'fa-clock'],
  };
  const [cls, icon] = map[status] || map['Pending'];
  return `<span class="badge ${cls}"><i class="fa-solid ${icon}"></i> ${status || 'Pending'}</span>`;
}

// Worker Attendance History Lookup — Excel-style table
async function lookupWorkerDetails() {
  const workerId  = document.getElementById('lookupWorkerSelect')?.value || '';
  const startDate = document.getElementById('lookupStartDate')?.value   || '';
  const endDate   = document.getElementById('lookupEndDate')?.value     || '';

  const resultEl    = document.getElementById('workerLookupResult');
  const emptyEl     = document.getElementById('workerLookupEmpty');
  const placeholder = document.getElementById('workerLookupPlaceholder');

  resultEl.style.display    = 'none';
  emptyEl.style.display     = 'none';
  placeholder.style.display = 'none';

  if (!workerId) {
    placeholder.style.display = 'flex';
    return;
  }

  try {
    let url = `/attendance/worker/${workerId}`;
    const params = [];
    if (startDate) params.push(`start_date=${startDate}`);
    if (endDate)   params.push(`end_date=${endDate}`);
    if (params.length) url += '?' + params.join('&');

    const data = await apiFetch(url);
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
    const absentCount = records.filter(r => r.status === 'Absent').length;
    const lateCount   = records.filter(r => r.status === 'Late').length;
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

    // Table rows (newest first — already sorted by backend)
    const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const tbody = document.getElementById('lookupHistoryBody');
    tbody.innerHTML = '';

    records.forEach((r, idx) => {
      const parts = r.date.split('-').map(Number);
      const dateObj = new Date(parts[0], parts[1] - 1, parts[2]);
      const dayName = DAYS[dateObj.getDay()];
      const dateDisplay = dateObj.toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' });
      const hours = (r.hours_worked && r.hours_worked > 0) ? r.hours_worked + ' hrs' : (r.check_in && r.check_out ? calculateHoursJS(r.check_in, r.check_out) + ' hrs' : '—');

      const isWeekend = (dateObj.getDay() === 5 || dateObj.getDay() === 6); // Fri/Sat
      const rowClass  = isWeekend ? 'row-weekend' : '';

      tbody.innerHTML += `
        <tr class="${rowClass}">
          <td class="lookup-row-num">${records.length - idx}</td>
          <td class="lookup-date-cell"><strong>${dateDisplay}</strong></td>
          <td class="lookup-day-cell ${isWeekend ? 'day-weekend' : ''}">${dayName}</td>
          <td>${_statusBadge(r.status)}</td>
          <td class="lookup-time-cell">${r.check_in  || '<span class="text-muted">—</span>'}</td>
          <td class="lookup-time-cell">${r.check_out || '<span class="text-muted">—</span>'}</td>
          <td class="lookup-hours-cell">${hours}</td>
          <td class="lookup-vol-cell">${r.work_volume || '<span class="text-muted">—</span>'}</td>
          <td class="lookup-notes-cell">${r.notes || '<span class="text-muted">—</span>'}</td>
        </tr>`;
    });

    // Totals footer row
    tbody.innerHTML += `
      <tr class="lookup-totals-row">
        <td colspan="6" style="text-align:right; font-weight:700; color:var(--primary);">
          <i class="fa-solid fa-sigma"></i> Totals
        </td>
        <td class="lookup-hours-cell"><strong>${data.total_hours} hrs</strong></td>
        <td colspan="2"></td>
      </tr>`;

    resultEl.style.display = 'block';
  } catch (err) {
    console.error('Lookup error:', err);
    emptyEl.style.display = 'flex';
  }
}

// Option Loader Helpers
async function loadProjectOptions() {
  try {
    const projects = await apiFetch('/projects');
    const selects = ['attendanceProjectFilter', 'workerProjectFilter', 'workerProject', 'reportProjectFilter'];
    const isSiteManagerHasProj = currentUser && currentUser.role === 'site_manager' && currentUser.assigned_project_id;

    selects.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const val = el.value;
      el.innerHTML = (id.includes('Filter') ? '<option value="">All Active Projects</option>' : '<option value="">Select Project</option>');
      projects.forEach(p => {
        const locStr = p.location ? ` (${p.location})` : '';
        el.innerHTML += `<option value="${p.id}">${p.name}${locStr}</option>`;
      });

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
    const selects = ['attendanceGroupFilter', 'workerGroupFilter', 'workerGroup', 'reportGroupFilter'];
    selects.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const val = el.value;
      el.innerHTML = (id.includes('Filter') ? '<option value="">All Worker Groups</option>' : '<option value="">Select Group</option>');
      groups.forEach(g => {
        el.innerHTML += `<option value="${g.id}">${g.name}</option>`;
      });
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

function updateRowHours(workerId) {
  const inEl = document.getElementById(`in_${workerId}`);
  const outEl = document.getElementById(`out_${workerId}`);
  const volEl = document.getElementById(`vol_${workerId}`);
  const hoursEl = document.getElementById(`hours_${workerId}`);

  const outNowBtn = document.getElementById(`btn_out_now_${workerId}`);
  const outResetBtn = document.getElementById(`btn_out_reset_${workerId}`);

  if (!inEl) return;
  const inVal = inEl.value;

  const attRecord = currentAttendanceMap[workerId] || {};
  const isSiteManager = currentUser && currentUser.role === 'site_manager';
  const isLocked = attRecord.is_locked || (isSiteManager && attRecord.is_older_than_24h);

  // Check-Out and Work Volume require Check-In or Check-Out to be SAVED in database
  const dbCheckIn = attRecord.check_in || '';
  const dbCheckOut = attRecord.check_out || '';
  const isSavedInDb = Boolean((dbCheckIn && dbCheckIn.trim()) || (dbCheckOut && dbCheckOut.trim()));

  if (!isLocked) {
    if (isSavedInDb) {
      if (outEl) {
        outEl.disabled = false;
        outEl.style.opacity = '1';
        outEl.style.cursor = 'auto';
        outEl.title = '';
      }
      if (outNowBtn) {
        outNowBtn.disabled = false;
        outNowBtn.style.opacity = '1';
        outNowBtn.style.cursor = 'pointer';
        outNowBtn.title = 'Set Check-Out to Current Time';
      }
      if (outResetBtn) {
        outResetBtn.disabled = false;
        outResetBtn.style.opacity = '1';
        outResetBtn.style.cursor = 'pointer';
        outResetBtn.title = 'Reset/Clear Check-Out Time';
      }
      if (volEl) {
        volEl.disabled = false;
        volEl.style.opacity = '1';
        volEl.style.cursor = 'auto';
        volEl.title = '';
      }
    } else {
      if (outEl) {
        outEl.value = '';
        outEl.disabled = true;
        outEl.style.opacity = '0.5';
        outEl.style.cursor = 'not-allowed';
        outEl.title = 'Save Check-In to database first';
      }
      if (outNowBtn) {
        outNowBtn.disabled = true;
        outNowBtn.style.opacity = '0.5';
        outNowBtn.style.cursor = 'not-allowed';
        outNowBtn.title = 'Save Check-In to database first';
      }
      if (outResetBtn) {
        outResetBtn.disabled = true;
        outResetBtn.style.opacity = '0.5';
        outResetBtn.style.cursor = 'not-allowed';
        outResetBtn.title = 'Save Check-In to database first';
      }
      if (volEl) {
        volEl.disabled = true;
        volEl.style.opacity = '0.5';
        volEl.style.cursor = 'not-allowed';
        volEl.title = 'Save Check-In to database first';
      }
    }
  }

  const outVal = outEl ? outEl.value : '';
  const hours = calculateHoursJS(inVal, outVal);
  if (hoursEl) hoursEl.innerText = `${hours} hrs`;
}

let currentAttendanceMap = {};

function formatTakenTime(isoStr, isOlderThan24h = false, isLocked = false) {
  if (isLocked) {
    return `<div style="font-size:0.75rem; color:var(--danger); font-weight:700; margin-top:0.35rem;"><i class="fa-solid fa-lock"></i> Locked (>24h)</div>`;
  }
  if (!isoStr) return `<div style="font-size:0.75rem; color:var(--text-muted); margin-top:0.35rem;"><i class="fa-solid fa-clock"></i> Not recorded</div>`;
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return `<div style="font-size:0.75rem; color:var(--text-muted); margin-top:0.35rem;"><i class="fa-solid fa-clock"></i> Not recorded</div>`;
    const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
    const dateStr = d.toLocaleDateString([], { month: 'short', day: 'numeric' });

    if (isOlderThan24h) {
      return `<div style="font-size:0.75rem; color:var(--warning); font-weight:700; margin-top:0.35rem;" title="Recorded on ${dateStr} at ${timeStr}"><i class="fa-solid fa-user-shield"></i> Recorded: ${dateStr} ${timeStr} (>24h)</div>`;
    }
    return `<div style="font-size:0.75rem; color:var(--accent-amber); font-weight:600; margin-top:0.35rem;"><i class="fa-solid fa-clock-rotate-left"></i> Recorded: ${timeStr}</div>`;
  } catch (e) {
    return `<div style="font-size:0.75rem; color:var(--text-muted); margin-top:0.35rem;"><i class="fa-solid fa-clock"></i> Not recorded</div>`;
  }
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

    if (!data.records || data.records.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:2rem; color:var(--text-muted);">No construction workers found matching filters.</td></tr>`;
      return;
    }

    const isSiteManager = currentUser && currentUser.role === 'site_manager';
    const isAdmin = currentUser && currentUser.role === 'admin';

    data.records.forEach(item => {
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

      let statusBadgeHtml = '<span class="badge badge-absent"><i class="fa-solid fa-user-xmark"></i> Absent</span>';
      if (isLocked) {
        statusBadgeHtml = `<span class="badge badge-locked" title="Editing locked after 24h"><i class="fa-solid fa-lock"></i> Locked</span>`;
      } else if (checkInVal && checkOutVal) {
        statusBadgeHtml = `<span class="badge badge-present"><i class="fa-solid fa-check"></i> ${checkInVal} - ${checkOutVal}</span>`;
      } else if (checkInVal) {
        statusBadgeHtml = `<span class="badge badge-present"><i class="fa-solid fa-user-check"></i> In: ${checkInVal}</span>`;
      } else {
        statusBadgeHtml = '<span class="badge badge-absent"><i class="fa-solid fa-user-xmark"></i> Absent</span>';
      }

      let btnHtml = '';
      if (isLocked) {
        btnHtml = `<button class="btn btn-secondary btn-sm" disabled title="Editing locked: >24 hours since recording"><i class="fa-solid fa-lock"></i> Locked</button>`;
      } else if (isAdmin && isOlderThan24h) {
        btnHtml = `<button class="btn btn-warning btn-sm confirm-btn" id="btn_confirm_${w.id}" onclick="saveSingleAttendance('${w.id}')" title="Recorded >24 hours ago. Admin confirmation required."><i class="fa-solid fa-user-shield"></i> Confirm</button>`;
      } else {
        btnHtml = `<button class="btn btn-accent btn-sm confirm-btn" id="btn_confirm_${w.id}" onclick="saveSingleAttendance('${w.id}')"><i class="fa-solid fa-check"></i> Confirm</button>`;
      }

      tbody.innerHTML += `
        <tr class="attendance-row ${isLocked ? 'row-locked' : ''}" id="row_${w.id}">
          <td data-label="Worker Details" class="col-worker" onclick="toggleWorkerCard('${w.id}')">
            <div class="worker-pill-container">
              <div class="worker-pill">
                <img src="${imgSrc}" onerror="handleImgError(this)" class="worker-img" alt="Worker">
                <div class="worker-details">
                  <strong class="worker-name">${w.name}</strong>
                  <span class="worker-passport" style="font-size:0.7rem; font-weight:500; color:var(--text-muted); display:block; opacity:0.85; margin-top:1px;"><i class="fa-solid fa-id-card" style="font-size:0.65rem;"></i> ${w.passport_number || 'N/A'}</span>
                </div>
              </div>
              <div class="mobile-header-right">
                <div id="status_pill_${w.id}">${statusBadgeHtml}</div>
                <button type="button" class="mobile-expand-btn" title="Toggle Input Controls">
                  <i class="fa-solid fa-chevron-down"></i>
                </button>
              </div>
            </div>
          </td>
          <td data-label="Group / Project" class="col-group-project mobile-collapsible">
            <span class="mobile-label">Group / Project</span>
            <div class="group-text"><strong>${w.group_name || 'General'}</strong></div>
            <div class="project-text"><i class="fa-solid fa-city"></i> ${w.project_name || 'Unassigned'}</div>
          </td>
          <td data-label="Check-In Time" class="col-checkin mobile-collapsible">
            <span class="mobile-label"><i class="fa-solid fa-right-to-bracket"></i> Check-In Time</span>
            <div class="time-control-group">
              <input type="time" class="form-control time-input" id="in_${w.id}" value="${checkInVal}" oninput="updateRowHours('${w.id}')" ${inDisabledAttr}>
              <div class="time-btn-group">
                <button type="button" class="btn btn-now btn-sm" id="btn_in_now_${w.id}" onclick="setCheckInNow('${w.id}')" title="Set Check-In to Current Time" ${inDisabledAttr}><i class="fa-solid fa-clock"></i> Now</button>
                <button type="button" class="btn btn-reset btn-sm" id="btn_in_reset_${w.id}" onclick="resetCheckIn('${w.id}')" title="Reset/Clear Check-In Time" ${inDisabledAttr}><i class="fa-solid fa-rotate-left"></i> Reset</button>
              </div>
            </div>
          </td>
          <td data-label="Check-Out Time" class="col-checkout mobile-collapsible">
            <span class="mobile-label"><i class="fa-solid fa-right-from-bracket"></i> Check-Out Time</span>
            <div class="time-control-group">
              <input type="time" class="form-control time-input" id="out_${w.id}" value="${checkOutVal}" oninput="updateRowHours('${w.id}')" ${outDisabledAttr}>
              <div class="time-btn-group">
                <button type="button" class="btn btn-now btn-sm" id="btn_out_now_${w.id}" onclick="setCheckOutNow('${w.id}')" title="Set Check-Out to Current Time" ${outDisabledAttr}><i class="fa-solid fa-clock"></i> Now</button>
                <button type="button" class="btn btn-reset btn-sm" id="btn_out_reset_${w.id}" onclick="resetCheckOut('${w.id}')" title="Reset/Clear Check-Out Time" ${outDisabledAttr}><i class="fa-solid fa-rotate-left"></i> Reset</button>
              </div>
            </div>
          </td>
          <td data-label="Total Hours" class="col-hours mobile-collapsible">
            <span class="mobile-label">Total Hours</span>
            <strong id="hours_${w.id}" class="total-hours-badge">${displayHours} hrs</strong>
          </td>
          <td data-label="Daily Work Volume" class="col-work-volume mobile-collapsible">
            <span class="mobile-label"><i class="fa-solid fa-cubes-stacked"></i> Daily Work Volume</span>
            <input type="text" list="commonWorkUnits" class="form-control work-volume-input" id="vol_${w.id}" value="${a.work_volume || ''}" placeholder="e.g. 50 m², 120 sqft, 10 m³" style="font-size:0.83rem; font-weight:600; color:var(--primary); padding:0.4rem 0.65rem;" ${volDisabledAttr}>
          </td>
          <td data-label="Confirm" class="col-confirm mobile-collapsible">
            <div id="btn_container_${w.id}">${btnHtml}</div>
            <div id="taken_at_${w.id}" class="taken-at-time">${formatTakenTime(a.recorded_at || a.updated_at, isOlderThan24h, isLocked)}</div>
          </td>
        </tr>
      `;
    });
  } catch (err) {
    console.error("Attendance load error:", err);
  }
}

async function saveSingleAttendance(workerId, adminConfirmed = false) {
  const targetDate = document.getElementById('attendanceDate').value;
  const todayStr = getLocalDateString(new Date());
  if (targetDate > todayStr) {
    alert("Future dates are disabled for attendance recording.");
    return;
  }
  const inEl = document.getElementById(`in_${workerId}`);
  const outEl = document.getElementById(`out_${workerId}`);
  const volEl = document.getElementById(`vol_${workerId}`);
  const inVal = inEl ? inEl.value : '';
  const outVal = outEl ? outEl.value : '';
  const volVal = volEl ? volEl.value.trim() : '';

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
    alert("Editing locked: Site managers can only edit worker work details within 24 hours of input recording.");
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
      saveSingleAttendance(workerId, true);
    };

    document.getElementById('adminConfirmModal').classList.add('show');
    return;
  }

  const btn = document.getElementById(`btn_confirm_${workerId}`);
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;
  }

  try {
    const res = await apiFetch('/attendance/record', {
      method: 'POST',
      body: JSON.stringify({
        worker_id: workerId,
        date: targetDate,
        check_in: inVal || null,
        check_out: outVal || null,
        status: statusVal,
        work_volume: volVal,
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

    const takenEl = document.getElementById(`taken_at_${workerId}`);
    if (takenEl) {
      takenEl.innerHTML = formatTakenTime(res.recorded_at || res.updated_at, res.is_older_than_24h, res.is_locked);
    }

    const pillEl = document.getElementById(`status_pill_${workerId}`);
    if (pillEl) {
      if (res.is_locked) {
        pillEl.innerHTML = `<span class="badge badge-locked" title="Editing locked after 24h"><i class="fa-solid fa-lock"></i> Locked</span>`;
      } else if (inVal && outVal) {
        pillEl.innerHTML = `<span class="badge badge-present"><i class="fa-solid fa-check"></i> ${inVal} - ${outVal}</span>`;
      } else if (inVal) {
        pillEl.innerHTML = `<span class="badge badge-present"><i class="fa-solid fa-user-check"></i> In: ${inVal}</span>`;
      } else {
        pillEl.innerHTML = `<span class="badge badge-absent"><i class="fa-solid fa-user-xmark"></i> Absent</span>`;
      }
    }

    if (btn) {
      btn.disabled = false;
      if (res.deleted) {
        btn.className = 'btn btn-secondary btn-sm';
        btn.innerHTML = `<i class="fa-solid fa-trash-can"></i> Cleared`;
      } else {
        btn.className = 'btn btn-present btn-sm';
        btn.innerHTML = `<i class="fa-solid fa-circle-check"></i> Saved`;
      }
      setTimeout(() => {
        if (isAdmin && isOlderThan24h) {
          btn.className = 'btn btn-warning btn-sm confirm-btn';
          btn.innerHTML = `<i class="fa-solid fa-user-shield"></i> Confirm`;
        } else {
          btn.className = 'btn btn-accent btn-sm confirm-btn';
          btn.innerHTML = `<i class="fa-solid fa-check"></i> Confirm`;
        }
      }, 2000);
    }
    loadDashboardStats();
  } catch (err) {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-solid fa-check"></i> Confirm`;
    }
    if (err.message && err.message.includes('24_HOUR_OVERRIDE_REQUIRED')) {
      if (isAdmin) {
        document.getElementById('adminConfirmWorkerName').innerText = 'Worker Work Details';
        document.getElementById('adminConfirmRecordDate').innerText = `Recorded >24 Hours Ago`;
        const submitBtn = document.getElementById('adminConfirmSubmitBtn');
        submitBtn.onclick = () => {
          closeModal('adminConfirmModal');
          saveSingleAttendance(workerId, true);
        };
        document.getElementById('adminConfirmModal').classList.add('show');
        return;
      }
    }
    alert("Could not update attendance: " + err.message);
  }
}

async function triggerBatchCheckIn(adminConfirmed = false) {
  const targetDate = document.getElementById('attendanceDate').value;
  const todayStr = getLocalDateString(new Date());
  if (targetDate > todayStr) {
    alert("Future dates are disabled for attendance recording.");
    return;
  }
  const projectFilter = document.getElementById('attendanceProjectFilter').value;
  const groupFilter = document.getElementById('attendanceGroupFilter').value;

  const isSiteManager = currentUser && currentUser.role === 'site_manager';
  const isAdmin = currentUser && currentUser.role === 'admin';

  const hasOlderRecords = Object.values(currentAttendanceMap).some(a => a && a.is_older_than_24h);

  if (isSiteManager && hasOlderRecords) {
    alert("Batch check-in locked: Attendance records for one or more workers on this date were recorded >24 hours ago.");
    return;
  }

  if (isAdmin && hasOlderRecords && !adminConfirmed) {
    document.getElementById('adminConfirmWorkerName').innerText = `Batch Operations on ${targetDate}`;
    document.getElementById('adminConfirmRecordDate').innerText = `Multiple Records >24 Hours Old`;

    const submitBtn = document.getElementById('adminConfirmSubmitBtn');
    submitBtn.onclick = () => {
      closeModal('adminConfirmModal');
      triggerBatchCheckIn(true);
    };

    document.getElementById('adminConfirmModal').classList.add('show');
    return;
  }

  try {
    const workers = await apiFetch(`/workers?project_id=${projectFilter}&group_id=${groupFilter}`);
    if (!workers || workers.length === 0) {
      alert("No workers found to check in.");
      return;
    }
    const workerIds = workers.map(w => w.id);

    await apiFetch('/attendance/bulk-checkin', {
      method: 'POST',
      body: JSON.stringify({
        worker_ids: workerIds,
        date: targetDate,
        check_in_time: '08:00',
        admin_confirmed: adminConfirmed
      })
    });

    alert(`Successfully checked in ${workerIds.length} workers at 08:00 AM!`);
    loadAttendanceSheet();
  } catch (err) {
    if (err.message && err.message.includes('24_HOUR_OVERRIDE_REQUIRED') && isAdmin) {
      document.getElementById('adminConfirmWorkerName').innerText = `Batch Operations on ${targetDate}`;
      document.getElementById('adminConfirmRecordDate').innerText = `Multiple Records >24 Hours Old`;
      const submitBtn = document.getElementById('adminConfirmSubmitBtn');
      submitBtn.onclick = () => {
        closeModal('adminConfirmModal');
        triggerBatchCheckIn(true);
      };
      document.getElementById('adminConfirmModal').classList.add('show');
      return;
    }
    alert("Batch check-in error: " + err.message);
  }
}

async function triggerBatchCheckOut(adminConfirmed = false) {
  const targetDate = document.getElementById('attendanceDate').value;
  const todayStr = getLocalDateString(new Date());
  if (targetDate > todayStr) {
    alert("Future dates are disabled for attendance recording.");
    return;
  }
  const projectFilter = document.getElementById('attendanceProjectFilter').value;
  const groupFilter = document.getElementById('attendanceGroupFilter').value;

  const isSiteManager = currentUser && currentUser.role === 'site_manager';
  const isAdmin = currentUser && currentUser.role === 'admin';

  const hasOlderRecords = Object.values(currentAttendanceMap).some(a => a && a.is_older_than_24h);

  if (isSiteManager && hasOlderRecords) {
    alert("Batch check-out locked: Attendance records for one or more workers on this date were recorded >24 hours ago.");
    return;
  }

  if (isAdmin && hasOlderRecords && !adminConfirmed) {
    document.getElementById('adminConfirmWorkerName').innerText = `Batch Operations on ${targetDate}`;
    document.getElementById('adminConfirmRecordDate').innerText = `Multiple Records >24 Hours Old`;

    const submitBtn = document.getElementById('adminConfirmSubmitBtn');
    submitBtn.onclick = () => {
      closeModal('adminConfirmModal');
      triggerBatchCheckOut(true);
    };

    document.getElementById('adminConfirmModal').classList.add('show');
    return;
  }

  try {
    const workers = await apiFetch(`/workers?project_id=${projectFilter}&group_id=${groupFilter}`);
    if (!workers || workers.length === 0) {
      alert("No workers found to check out.");
      return;
    }
    const workerIds = workers.map(w => w.id);

    await apiFetch('/attendance/bulk-checkout', {
      method: 'POST',
      body: JSON.stringify({
        worker_ids: workerIds,
        date: targetDate,
        check_out_time: '18:00',
        admin_confirmed: adminConfirmed
      })
    });

    alert(`Successfully checked out ${workerIds.length} workers at 06:00 PM!`);
    loadAttendanceSheet();
  } catch (err) {
    if (err.message && err.message.includes('24_HOUR_OVERRIDE_REQUIRED') && isAdmin) {
      document.getElementById('adminConfirmWorkerName').innerText = `Batch Operations on ${targetDate}`;
      document.getElementById('adminConfirmRecordDate').innerText = `Multiple Records >24 Hours Old`;
      const submitBtn = document.getElementById('adminConfirmSubmitBtn');
      submitBtn.onclick = () => {
        closeModal('adminConfirmModal');
        triggerBatchCheckOut(true);
      };
      document.getElementById('adminConfirmModal').classList.add('show');
      return;
    }
    alert("Batch check-out error: " + err.message);
  }
}

// Workers List
async function loadWorkers() {
  const query = document.getElementById('workerSearchQuery').value;
  const project_id = document.getElementById('workerProjectFilter').value;
  const group_id = document.getElementById('workerGroupFilter').value;
  const status_val = document.getElementById('workerStatusFilter')?.value || '';

  try {
    const workers = await apiFetch(`/workers?query=${encodeURIComponent(query)}&project_id=${project_id}&group_id=${group_id}&status=${status_val}`);
    const grid = document.getElementById('workersGrid');
    grid.innerHTML = '';

    if (workers.length === 0) {
      grid.innerHTML = `<div style="grid-column: 1/-1; text-align:center; padding:3rem; color:var(--text-muted);">No workers registered matching filters. Click "Add Worker" to register a new worker.</div>`;
      return;
    }

    workers.forEach(w => {
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

      grid.innerHTML += `
        <div class="worker-card">
          <div class="worker-card-header">
            <img src="${imgSrc}" onerror="handleImgError(this)" class="worker-card-img" alt="Worker">
            <div>
              <strong style="font-size:1.05rem; display:block; color:var(--primary);">${w.name}</strong>
              <span class="badge ${badgeClass}"><i class="fa-solid ${badgeIcon}"></i> ${statusStr}</span>
            </div>
          </div>
          <div class="worker-card-body">
            <div><i class="fa-solid fa-id-card"></i> Passport: <strong>${w.passport_number || 'N/A'}</strong></div>
            <div><i class="fa-solid fa-layer-group"></i> Trade: <strong>${w.group_name || 'General'}</strong></div>
            <div><i class="fa-solid fa-city"></i> Site: ${w.project_name || 'Unassigned'}</div>
            <div><i class="fa-solid fa-phone"></i> Contact: ${w.phone || 'N/A'}</div>
          </div>
          <div style="margin-top: 1rem; padding-top: 0.75rem; border-top: 1px solid var(--border-color); display:flex; justify-content:flex-end; gap:0.5rem;">
            <button class="btn btn-secondary btn-sm" onclick="editWorker('${w.id}')"><i class="fa-solid fa-pen-to-square"></i> Edit</button>
            <button class="btn btn-danger btn-sm" onclick="deleteWorker('${w.id}')"><i class="fa-solid fa-trash"></i></button>
          </div>
        </div>
      `;
    });
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
    document.getElementById('workerPhone').value = worker.phone || '';
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
  const payload = {
    name: document.getElementById('workerName').value.trim(),
    passport_number: document.getElementById('workerPassport').value.trim(),
    phone: document.getElementById('workerPhone').value.trim(),
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
    tbody.innerHTML = '';
    projects.forEach(p => {
      const badgeClass = p.status === 'Completed' ? 'badge-present' : (p.status === 'On Hold' ? 'badge-late' : 'badge-present');
      tbody.innerHTML += `
        <tr>
          <td><strong style="color:var(--primary);">${p.name}</strong></td>
          <td>${p.location || 'Malaysia'}</td>
          <td><span class="badge ${badgeClass}">${p.status || 'Active'}</span></td>
          <td>
            <button class="btn btn-secondary btn-sm" onclick="editProject('${p.id}')"><i class="fa-solid fa-pen-to-square"></i> Edit</button>
            <button class="btn btn-danger btn-sm" onclick="deleteProject('${p.id}')"><i class="fa-solid fa-trash"></i></button>
          </td>
        </tr>
      `;
    });
  } catch (err) { console.error("Projects load error", err); }
}

async function populateProjectManagerOptions(selectedMgrId = '') {
  try {
    const users = await apiFetch('/admin/users');
    const select = document.getElementById('projectAssignedManager');
    if (!select) return;
    select.innerHTML = '<option value="">Select Site Manager</option>';
    users.forEach(u => {
      const sel = (u.id === selectedMgrId || u.username === selectedMgrId) ? 'selected' : '';
      select.innerHTML += `<option value="${u.username}" ${sel}>${u.full_name} (${u.username})</option>`;
    });
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
    tbody.innerHTML = '';
    groups.forEach(g => {
      tbody.innerHTML += `
        <tr>
          <td><strong style="color:var(--primary);">${g.name}</strong></td>
          <td>${g.description || 'N/A'}</td>
          <td>
            <button class="btn btn-secondary btn-sm" onclick="editGroup('${g.id}')"><i class="fa-solid fa-pen-to-square"></i> Edit</button>
            <button class="btn btn-danger btn-sm" onclick="deleteGroup('${g.id}')"><i class="fa-solid fa-trash"></i></button>
          </td>
        </tr>
      `;
    });
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
    tbody.innerHTML = '';
    users.forEach(u => {
      const assignedProjText = u.assigned_project_name || 'All / Unassigned';
      const phoneText = u.phone || u.email || 'N/A';
      const allowedCount = (u.role === 'admin') ? 'All Tabs' : (u.allowed_tabs ? `${u.allowed_tabs.length}/6 Tabs` : '6/6 Tabs');
      tbody.innerHTML += `
        <tr>
          <td><strong>${u.username}</strong></td>
          <td>${u.full_name}</td>
          <td><span class="badge ${u.role === 'admin' ? 'badge-late' : 'badge-pending'}">${u.role === 'admin' ? 'Admin' : 'Site Manager'}</span></td>
          <td><strong style="color:var(--accent-amber);">${assignedProjText}</strong></td>
          <td><i class="fa-solid fa-phone" style="font-size:0.75rem; color:var(--text-muted); margin-right:0.35rem;"></i>${phoneText}</td>
          <td><span class="badge badge-present" style="font-size:0.78rem;">${allowedCount}</span></td>
          <td>
            <button class="btn btn-secondary btn-sm" onclick="editUser('${u.username}')"><i class="fa-solid fa-pen-to-square"></i> Edit</button>
            ${u.username !== currentUser.username ? `<button class="btn btn-danger btn-sm" onclick="deleteUser('${u.username}')"><i class="fa-solid fa-trash"></i></button>` : '<span style="font-size:0.75rem; color:var(--text-muted); margin-left:0.5rem;">Current</span>'}
          </td>
        </tr>
      `;
    });
  } catch (err) { console.error("Users load error", err); }
}

async function populateUserModalProjects(selectedProjId = '') {
  try {
    const projects = await apiFetch('/projects');
    const select = document.getElementById('newAssignedProject');
    if (!select) return;
    select.innerHTML = '<option value="">All / Unassigned</option>';
    projects.forEach(p => {
      const sel = p.id === selectedProjId ? 'selected' : '';
      select.innerHTML += `<option value="${p.id}" ${sel}>${p.name}</option>`;
    });
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

  const defaultTabs = ['dashboard', 'attendance', 'workers', 'projects', 'groups', 'reports'];
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

// Reports & CSV Export
async function loadReportTable() {
  const todayStr = getLocalDateString(new Date());
  const startEl = document.getElementById('reportStartDate');
  const endEl = document.getElementById('reportEndDate');
  if (startEl) {
    startEl.max = todayStr;
    if (startEl.value > todayStr) startEl.value = todayStr;
  }
  if (endEl) {
    endEl.max = todayStr;
    if (endEl.value > todayStr) endEl.value = todayStr;
  }

  const startDate = startEl?.value || '';
  const endDate = endEl?.value || '';
  const projectId = document.getElementById('reportProjectFilter')?.value || '';
  const groupId = document.getElementById('reportGroupFilter')?.value || '';

  try {
    const data = await apiFetch(`/reports/payroll?start_date=${startDate}&end_date=${endDate}&project_id=${projectId}&group_id=${groupId}`);
    const tbody = document.getElementById('reportTableBody');
    tbody.innerHTML = '';

    const summaryWorkersEl = document.getElementById('reportTotalWorkers');
    const summaryDaysEl = document.getElementById('reportTotalDays');
    const summaryHoursEl = document.getElementById('reportTotalHours');

    if (summaryWorkersEl) summaryWorkersEl.innerText = data.total_workers || 0;
    if (summaryDaysEl) summaryDaysEl.innerText = `${data.total_days_worked || 0} days`;
    if (summaryHoursEl) summaryHoursEl.innerText = `${data.total_hours || 0} hrs`;

    if (!data.records || data.records.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:2rem; color:var(--text-muted);">No construction workers found matching filters.</td></tr>`;
      return;
    }

    data.records.forEach(item => {
      const w = item.worker;
      const daysWorked = item.days_worked || 0;
      const totalHours = item.total_hours || 0;
      const statusClass = totalHours > 0 ? 'badge-present' : 'badge-pending';
      const statusLabel = totalHours > 0 ? `${daysWorked} Days Worked` : 'No Hours Logged';

      tbody.innerHTML += `
        <tr>
          <td>
            <div style="font-weight:600; color:var(--primary); font-size:0.95rem;">${w.name}</div>
            <div style="font-size:0.7rem; font-weight:500; color:var(--text-muted); opacity:0.85; margin-top:1px;"><i class="fa-solid fa-id-card" style="font-size:0.65rem;"></i> ${w.passport_number || 'N/A'}</div>
          </td>
          <td>
            <div style="font-size:0.85rem; font-weight:600;">${w.project_name || 'Unassigned'}</div>
            <div style="font-size:0.75rem; color:var(--text-muted);">${w.group_name || 'General'}</div>
          </td>
          <td><strong>${daysWorked} days</strong></td>
          <td><strong style="color:var(--accent-amber); font-size:1.05rem;">${totalHours} hrs</strong></td>
          <td><span style="font-size:0.85rem; font-weight:600; color:var(--primary);">${item.work_volume_summary || '<span style="color:var(--text-muted); font-weight:normal;">-</span>'}</span></td>
          <td><span class="badge ${statusClass}">${statusLabel}</span></td>
        </tr>
      `;
    });
  } catch (err) { console.error("Report load error", err); }
}

async function exportAttendanceCSV() {
  const startDate = document.getElementById('reportStartDate')?.value || '';
  const endDate = document.getElementById('reportEndDate')?.value || '';
  const projectId = document.getElementById('reportProjectFilter')?.value || '';
  const groupId = document.getElementById('reportGroupFilter')?.value || '';

  try {
    const data = await apiFetch(`/reports/payroll?start_date=${startDate}&end_date=${endDate}&project_id=${projectId}&group_id=${groupId}`);
    let csv = "Worker Name,Passport Number,Project Name,Group,Days Worked,Total Hours Worked,Total Work Volume,Status\n";

    data.records.forEach(item => {
      const w = item.worker;
      const daysWorked = item.days_worked || 0;
      const totalHours = item.total_hours || 0;
      const statusLabel = totalHours > 0 ? `${daysWorked} Days Worked` : 'No Hours Logged';

      csv += `"${(w.name || '').replace(/"/g, '""')}","${(w.passport_number || '').replace(/"/g, '""')}","${(w.project_name || '').replace(/"/g, '""')}","${(w.group_name || '').replace(/"/g, '""')}","${daysWorked}","${totalHours}","${(item.work_volume_summary || '').replace(/"/g, '""')}","${statusLabel}"\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    const fileName = (startDate && endDate) ? `Payroll_Summary_${startDate}_to_${endDate}.csv` : `Payroll_Summary_${startDate || endDate || 'export'}.csv`;
    link.setAttribute("download", fileName);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (err) {
    alert("Export failed: " + err.message);
  }
}

// Utility Modal Closes
function closeModal(modalId) {
  document.getElementById(modalId).classList.remove('show');
}
