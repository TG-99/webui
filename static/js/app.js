// ==========================================================================
// SPA STATE MANAGEMENT & CONFIGS
// ==========================================================================

const API_BASE = "";

let state = {
    token: localStorage.getItem("mustdo_token") || null,
    user: null,
    todos: [],
    filter: "all",
    searchQuery: "",
    theme: localStorage.getItem("mustdo_theme") || "system",
    selectedTodoIds: [],
    showNextNotification: localStorage.getItem("mustdo_show_next_notification") === "true"
};

let _countdownInterval = null;
let _autoRefreshInterval = null;
let _toastQueue = [];
let _toastActive = false;

// ==========================================================================
// INITIALIZATION
// ==========================================================================

document.addEventListener("DOMContentLoaded", () => {
    initTheme();
    setupEventListeners();
    checkAuthSession();

    // Live countdown: update remaining time every 1s
    _countdownInterval = setInterval(() => {
        tickCountdowns();
    }, 1000);

    // Auto-refresh todos from server every 60s
    _autoRefreshInterval = setInterval(() => {
        if (state.token && state.user) loadTodos();
    }, 60000);
});

// ==========================================================================
// AUTHENTICATION & SESSION MANAGEMENT
// ==========================================================================

async function checkAuthSession() {
    if (!state.token) {
        showView("auth");
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/api/auth/me`, {
            headers: {
                "Authorization": `Bearer ${state.token}`
            }
        });

        if (response.ok) {
            state.user = await response.json();
            onLoginSuccess();
        } else {
            // Token expired or invalid
            logout();
        }
    } catch (err) {
        console.error("Session verification error:", err);
        showToast("Server offline. Using local session cached data.", "info");
        // Fallback or show auth
        showView("auth");
    }
}

function onLoginSuccess() {
    showView("dashboard");
    document.getElementById("username-badge").textContent = state.user.username;

    // Show Admin Button if user is admin
    const adminBtn = document.getElementById("admin-panel-btn");
    if (state.user.role === "admin") {
        adminBtn.classList.remove("hidden");
    } else {
        adminBtn.classList.add("hidden");
    }

    // Set chat ID and bot token in modal on load
    document.getElementById("profile-chat-id").value = state.user.telegram_chat_id || "";
    document.getElementById("profile-bot-token").value = state.user.telegram_bot_token || "";

    // Set toggle checkbox state
    document.getElementById("show-next-notification-toggle").checked = state.showNextNotification;

    loadTodos();
}

function logout() {
    localStorage.removeItem("mustdo_token");
    state.token = null;
    state.user = null;
    state.todos = [];
    state.selectedTodoIds = [];
    updateExportButtonText();
    showView("auth");
    showToast("Logged out successfully", "success");
}

// ==========================================================================
// ROUTER & VIEW CONTROLLER
// ==========================================================================

function showView(viewName) {
    const authView = document.getElementById("auth-screen");
    const dashboardView = document.getElementById("dashboard-screen");
    const floatingGroup = document.querySelector(".floating-action-group");

    if (viewName === "auth") {
        authView.classList.remove("hidden");
        dashboardView.classList.add("hidden");
        if (floatingGroup) floatingGroup.classList.add("hidden");
        resetAuthForms();
    } else if (viewName === "dashboard") {
        authView.classList.add("hidden");
        dashboardView.classList.remove("hidden");
        if (floatingGroup) floatingGroup.classList.remove("hidden");
    }
}

function resetAuthForms() {
    document.getElementById("login-form").reset();
    document.getElementById("register-form").reset();
    showLoginForm();
}

function showLoginForm() {
    document.getElementById("login-form").classList.remove("hidden");
    document.getElementById("register-form").classList.add("hidden");
}

function showRegisterForm() {
    document.getElementById("login-form").classList.add("hidden");
    document.getElementById("register-form").classList.remove("hidden");
}

// ==========================================================================
// THEME SWITCHER LOGIC
// ==========================================================================

function initTheme() {
    applyTheme(state.theme);

    // Listen for system theme changes in real-time
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
        if (state.theme === "system") {
            applyTheme("system");
        }
    });
}

function applyTheme(theme) {
    const html = document.documentElement;
    html.className = ""; // clear
    html.classList.add("theme-" + theme);

    if (theme === "system") {
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
            html.classList.add("theme-light");
        } else {
            html.classList.add("theme-dark");
        }
    } else if (theme === "white") {
        html.classList.add("theme-light");
    } else if (theme === "black") {
        html.classList.add("theme-dark");
    }

    state.theme = theme;
    localStorage.setItem("mustdo_theme", theme);

    // Update button visual active states
    document.getElementById("theme-system-btn").classList.toggle("active", theme === "system");
    document.getElementById("theme-white-btn").classList.toggle("active", theme === "white");
    document.getElementById("theme-black-btn").classList.toggle("active", theme === "black");
}

// ==========================================================================
// EVENT LISTENERS REGISTER
// ==========================================================================

function setupEventListeners() {
    // Auth Forms Switchers
    document.getElementById("to-register").addEventListener("click", showRegisterForm);
    document.getElementById("to-login").addEventListener("click", showLoginForm);

    // Auth Form Submits
    document.getElementById("login-form").addEventListener("submit", handleLogin);
    document.getElementById("register-form").addEventListener("submit", handleRegister);

    // Logout Click
    document.getElementById("logout-btn").addEventListener("click", logout);

    // Theme Selectors
    document.getElementById("theme-system-btn").addEventListener("click", () => applyTheme("system"));
    document.getElementById("theme-white-btn").addEventListener("click", () => applyTheme("white"));
    document.getElementById("theme-black-btn").addEventListener("click", () => applyTheme("black"));

    // Create Task Submit
    document.getElementById("create-task-form").addEventListener("submit", handleCreateTodo);

    // Filter controls
    document.querySelectorAll(".filter-tab").forEach(tab => {
        tab.addEventListener("click", (e) => {
            document.querySelectorAll(".filter-tab").forEach(t => t.classList.remove("active"));
            e.target.classList.add("active");
            state.filter = e.target.dataset.filter;
            renderTodos();
        });
    });

    // Search input with debounce
    let _searchTimer = null;
    document.getElementById("search-input").addEventListener("input", (e) => {
        clearTimeout(_searchTimer);
        _searchTimer = setTimeout(() => {
            state.searchQuery = e.target.value.toLowerCase();
            renderTodos();
        }, 250);
    });

    // Show next notification toggle
    document.getElementById("show-next-notification-toggle").addEventListener("change", (e) => {
        state.showNextNotification = e.target.checked;
        localStorage.setItem("mustdo_show_next_notification", state.showNextNotification);
        renderTodos();
    });

    // Profile Modal Toggles
    const profileModal = document.getElementById("profile-modal");
    document.getElementById("profile-settings-btn").addEventListener("click", () => {
        if (state.user) {
            document.getElementById("profile-chat-id").value = state.user.telegram_chat_id || "";
            document.getElementById("profile-bot-token").value = state.user.telegram_bot_token || "";
        }
        profileModal.classList.remove("hidden");
    });
    document.getElementById("close-profile-btn").addEventListener("click", () => profileModal.classList.add("hidden"));
    document.getElementById("cancel-profile-btn").addEventListener("click", () => profileModal.classList.add("hidden"));
    document.getElementById("profile-update-form").addEventListener("submit", handleProfileUpdate);

    // Admin Modal Toggles
    const adminModal = document.getElementById("admin-modal");
    document.getElementById("admin-panel-btn").addEventListener("click", openAdminPanel);
    document.getElementById("close-admin-btn").addEventListener("click", () => adminModal.classList.add("hidden"));
    document.getElementById("admin-settings-form").addEventListener("submit", handleAdminSettingsSubmit);

    // Create Task Modal Toggles
    const createTaskModal = document.getElementById("create-task-modal");
    document.getElementById("floating-add-btn").addEventListener("click", () => {
        createTaskModal.classList.remove("hidden");
        setTimeout(() => document.getElementById("task-title").focus(), 100);
    });
    document.getElementById("close-create-task-btn").addEventListener("click", () => createTaskModal.classList.add("hidden"));
    document.getElementById("cancel-create-task-btn").addEventListener("click", () => createTaskModal.classList.add("hidden"));
    createTaskModal.addEventListener("click", (e) => {
        if (e.target === createTaskModal) createTaskModal.classList.add("hidden");
    });

    // Edit Modal Task close
    const editModal = document.getElementById("edit-task-modal");
    document.getElementById("close-edit-task-btn").addEventListener("click", () => editModal.classList.add("hidden"));
    document.getElementById("cancel-edit-task-btn").addEventListener("click", () => editModal.classList.add("hidden"));
    document.getElementById("edit-task-form").addEventListener("submit", handleUpdateTodo);

    // Export Modal Toggles & Listeners
    const exportModal = document.getElementById("export-task-modal");
    document.getElementById("export-tasks-btn").addEventListener("click", openExportModal);
    document.getElementById("close-export-task-btn").addEventListener("click", () => exportModal.classList.add("hidden"));
    document.getElementById("cancel-export-task-btn").addEventListener("click", () => exportModal.classList.add("hidden"));
    exportModal.addEventListener("click", (e) => {
        if (e.target === exportModal) exportModal.classList.add("hidden");
    });
    document.getElementById("export-select-all").addEventListener("change", handleExportSelectAllToggle);
    document.getElementById("submit-export-task-btn").addEventListener("click", submitExportTasks);

    // Import task event listeners
    document.getElementById("import-tasks-btn").addEventListener("click", () => {
        document.getElementById("import-tasks-file").click();
    });
    document.getElementById("import-tasks-file").addEventListener("change", handleImportTasks);
}

// ==========================================================================
// CALL API REQUESTS (AUTH)
// ==========================================================================

async function handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById("login-username").value;
    const password = document.getElementById("login-password").value;

    try {
        const response = await fetch(`${API_BASE}/api/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();
        if (response.ok) {
            state.token = data.token;
            state.user = data.user;
            localStorage.setItem("mustdo_token", data.token);
            onLoginSuccess();
            showToast(`Welcome back, ${data.user.username}!`, "success");
        } else {
            showToast(data.detail || "Invalid login credentials", "error");
        }
    } catch (err) {
        console.error("Login Error:", err);
        showToast("Failed to connect to backend server.", "error");
    }
}

async function handleRegister(e) {
    e.preventDefault();
    const username = document.getElementById("register-username").value;
    const password = document.getElementById("register-password").value;

    try {
        const response = await fetch(`${API_BASE}/api/auth/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();
        if (response.ok) {
            state.token = data.token;
            state.user = data.user;
            localStorage.setItem("mustdo_token", data.token);
            onLoginSuccess();
            showToast(`Account created successfully!`, "success");
        } else {
            showToast(data.detail || "Registration failed. Username might be taken.", "error");
        }
    } catch (err) {
        console.error("Registration Error:", err);
        showToast("Failed to connect to backend server.", "error");
    }
}

async function handleProfileUpdate(e) {
    e.preventDefault();
    const chat_id = document.getElementById("profile-chat-id").value;
    const bot_token = document.getElementById("profile-bot-token").value;
    const password = document.getElementById("profile-password").value;

    const payload = {
        telegram_chat_id: chat_id,
        telegram_bot_token: bot_token
    };
    if (password) {
        payload.password = password;
    }

    try {
        const response = await fetch(`${API_BASE}/api/auth/profile`, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${state.token}`
            },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            state.user = await response.json();
            document.getElementById("profile-modal").classList.add("hidden");
            document.getElementById("profile-password").value = "";
            showToast("Telegram credentials saved successfully!", "success");

            // Re-render list to reflect telegram notification capability
            renderTodos();
        } else {
            const errData = await response.json();
            showToast(errData.detail || "Failed to update settings", "error");
        }
    } catch (err) {
        console.error("Profile update error:", err);
        showToast("Database server offline", "error");
    }
}

// ==========================================================================
// CALL API REQUESTS (TODOS CRUD)
// ==========================================================================

async function loadTodos() {
    try {
        const response = await fetch(`${API_BASE}/api/todos`, {
            headers: {
                "Authorization": `Bearer ${state.token}`
            }
        });

        if (response.ok) {
            state.todos = await response.json();
            renderTodos();
        } else {
            showToast("Failed to retrieve your task checklist", "error");
        }
    } catch (err) {
        console.error("Load todos error:", err);
        showToast("Backend connection offline", "error");
    }
}

async function handleCreateTodo(e) {
    e.preventDefault();
    const title = document.getElementById("task-title").value;
    const description = document.getElementById("task-desc").value;
    const deadline = document.getElementById("task-deadline").value;
    const priority = document.getElementById("task-priority").value;
    const notification_interval = parseInt(document.getElementById("task-interval").value);

    // Validate deadline date is set
    if (!deadline) {
        showToast("Please choose a task deadline", "error");
        return;
    }

    // Format to ISO
    const localDate = new Date(deadline);
    const isoDeadlineStr = localDate.toISOString();

    try {
        const response = await fetch(`${API_BASE}/api/todos`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${state.token}`
            },
            body: JSON.stringify({
                title,
                description,
                deadline: isoDeadlineStr,
                priority,
                notification_interval
            })
        });

        if (response.ok) {
            const newTodo = await response.json();
            state.todos.unshift(newTodo); // Add to beginning

            // Reset form and close modal
            document.getElementById("create-task-form").reset();
            document.getElementById("create-task-modal").classList.add("hidden");

            // Re-render and notify
            renderTodos();
            showToast("Task created successfully & alerts armed!", "success");

            // Warn if telegram is not set up
            if (!state.user.telegram_chat_id) {
                showToast("⚠️ Note: Configure your Telegram Chat ID in settings to receive reminders!", "info");
            }
        } else {
            const data = await response.json();
            showToast(data.detail || "Could not register task", "error");
        }
    } catch (err) {
        console.error("Create todo error:", err);
        showToast("Connection to backend server failed", "error");
    }
}

async function handleToggleTodo(todoId) {
    try {
        const response = await fetch(`${API_BASE}/api/todos/${todoId}/toggle`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${state.token}`
            }
        });

        if (response.ok) {
            const updatedTodo = await response.json();
            // Update local state
            state.todos = state.todos.map(t => t.id === todoId ? updatedTodo : t);
            renderTodos();

            if (updatedTodo.completed) {
                showToast("Task completed! Telegram alerts muted.", "success");
            } else {
                showToast("Task reopened. Telegram alerts re-armed.", "info");
            }
        } else {
            showToast("Failed to toggle status", "error");
        }
    } catch (err) {
        console.error("Toggle todo error:", err);
        showToast("Server offline", "error");
    }
}

function openEditModal(todoId) {
    const todo = state.todos.find(t => t.id === todoId);
    if (!todo) return;

    document.getElementById("edit-task-id").value = todo.id;
    document.getElementById("edit-task-title").value = todo.title;
    document.getElementById("edit-task-desc").value = todo.description || "";

    // Parse deadline back to local datetime string format for input value (YYYY-MM-DDTHH:MM)
    if (todo.deadline) {
        const d = new Date(todo.deadline);
        // Compensate for timezone offset to get local time string representation
        const pad = (num) => String(num).padStart(2, "0");
        const localISOStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
        document.getElementById("edit-task-deadline").value = localISOStr;
    } else {
        document.getElementById("edit-task-deadline").value = "";
    }

    document.getElementById("edit-task-priority").value = todo.priority;
    document.getElementById("edit-task-interval").value = todo.notification_interval;

    document.getElementById("edit-task-modal").classList.remove("hidden");
}

async function handleUpdateTodo(e) {
    e.preventDefault();
    const todoId = document.getElementById("edit-task-id").value;
    const title = document.getElementById("edit-task-title").value;
    const description = document.getElementById("edit-task-desc").value;
    const deadline = document.getElementById("edit-task-deadline").value;
    const priority = document.getElementById("edit-task-priority").value;
    const notification_interval = parseInt(document.getElementById("edit-task-interval").value);

    // Format to ISO
    const localDate = new Date(deadline);
    const isoDeadlineStr = localDate.toISOString();

    try {
        const response = await fetch(`${API_BASE}/api/todos/${todoId}`, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${state.token}`
            },
            body: JSON.stringify({
                title,
                description,
                deadline: isoDeadlineStr,
                priority,
                notification_interval
            })
        });

        if (response.ok) {
            const updatedTodo = await response.json();
            // Update local state
            state.todos = state.todos.map(t => t.id === todoId ? updatedTodo : t);

            document.getElementById("edit-task-modal").classList.add("hidden");
            renderTodos();
            showToast("Task edited and schedule updated!", "success");
        } else {
            const data = await response.json();
            showToast(data.detail || "Failed to update task", "error");
        }
    } catch (err) {
        console.error("Update todo error:", err);
        showToast("Database server connection offline", "error");
    }
}

async function handleDeleteTodo(todoId) {
    showConfirmModal(
        "Delete Task?",
        "This will permanently delete this task and stop all future Telegram notifications.",
        async () => {
            showLoading();
            try {
                const response = await fetch(`${API_BASE}/api/todos/${todoId}`, {
                    method: "DELETE",
                    headers: { "Authorization": `Bearer ${state.token}` }
                });
                if (response.ok) {
                    state.todos = state.todos.filter(t => t.id !== todoId);
                    renderTodos();
                    showToast("Task deleted successfully", "success");
                } else {
                    showToast("Failed to delete task", "error");
                }
            } catch (err) {
                console.error("Delete todo error:", err);
                showToast("Database server connection offline", "error");
            } finally {
                hideLoading();
            }
        }
    );
}

// ==========================================================================
// CALL API REQUESTS (ADMIN PANEL)
// ==========================================================================

async function openAdminPanel() {
    try {
        // Fetch Admin users registry
        const uResponse = await fetch(`${API_BASE}/api/admin/users`, {
            headers: { "Authorization": `Bearer ${state.token}` }
        });

        // Fetch global settings
        const sResponse = await fetch(`${API_BASE}/api/admin/settings`, {
            headers: { "Authorization": `Bearer ${state.token}` }
        });

        if (uResponse.ok && sResponse.ok) {
            const usersData = await uResponse.json();
            const settingsData = await sResponse.json();

            // Fill setting token
            document.getElementById("admin-bot-token").value = settingsData.telegram_bot_token || "";

            // Build Table
            const tbody = document.getElementById("admin-users-table-body");
            tbody.innerHTML = ""; // Clear

            usersData.forEach(item => {
                const tr = document.createElement("tr");
                const rate = item.stats.total_todos > 0
                    ? Math.round((item.stats.completed_todos / item.stats.total_todos) * 100)
                    : 0;

                tr.innerHTML = `
                    <td><b>${escapeHtml(item.user.username)}</b></td>
                    <td><span class="user-badge">${item.user.role}</span></td>
                    <td><code>${item.user.telegram_chat_id ? escapeHtml(item.user.telegram_chat_id) : 'Not configured'}</code></td>
                    <td>${item.stats.total_todos}</td>
                    <td>${item.stats.completed_todos}</td>
                    <td>
                        <span class="meta-badge ${rate >= 75 ? 'text-accent' : (rate >= 30 ? 'badge-urgent' : 'badge-overdue')}">
                            ${rate}% Complete
                        </span>
                    </td>
                `;
                tbody.appendChild(tr);
            });

            // Reveal Modal
            document.getElementById("admin-modal").classList.remove("hidden");
        } else {
            showToast("Access forbidden or server error loading stats", "error");
        }
    } catch (err) {
        console.error("Admin load error:", err);
        showToast("Failed to load admin telemetry dashboard", "error");
    }
}

async function handleAdminSettingsSubmit(e) {
    e.preventDefault();
    const token = document.getElementById("admin-bot-token").value;

    try {
        const response = await fetch(`${API_BASE}/api/admin/settings`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${state.token}`
            },
            body: JSON.stringify({ telegram_bot_token: token })
        });

        if (response.ok) {
            showToast("System Telegram Bot Token saved!", "success");
        } else {
            showToast("Failed to save credentials", "error");
        }
    } catch (err) {
        console.error("Admin settings save error:", err);
        showToast("Database server connection offline", "error");
    }
}

// ==========================================================================
// TELEGRAM NOTIFICATION SEND TIME CALCULATORS
// ==========================================================================

function getNextNotificationTime(todo) {
    if (todo.completed) return null;
    if (!todo.deadline) return null;

    const deadline = new Date(todo.deadline);
    const now = new Date();

    const isOverdue = now > deadline;
    const isApproaching = (deadline - now) <= 24 * 60 * 60 * 1000 && now < deadline;

    if (!todo.last_notified_at) {
        // Due immediately
        return new Date(now.getTime() - 1000);
    }

    const userInterval = todo.notification_interval || 60;
    let intervalMins = userInterval;

    if (isOverdue) {
        intervalMins = Math.min(userInterval, 1);
    } else if (isApproaching) {
        const diffMs = deadline - now;
        const diffHrs = diffMs / (1000 * 60 * 60);
        let autoInterval = 60;
        if (diffHrs <= 1) {
            autoInterval = 1;
        } else if (diffHrs <= 2) {
            autoInterval = 5;
        } else if (diffHrs <= 6) {
            autoInterval = 30;
        }
        intervalMins = Math.min(userInterval, autoInterval);
    } else {
        // More than 24 hours remaining: respect user manual interval
        intervalMins = userInterval;
    }

    const lastNotified = new Date(todo.last_notified_at);
    return new Date(lastNotified.getTime() + intervalMins * 60 * 1000);
}

function formatNextNotification(todo) {
    const nextTime = getNextNotificationTime(todo);
    if (!nextTime) return "";

    const now = new Date();
    if (nextTime <= now) {
        return "⚡ Immediate (Next run)";
    }

    const diffMs = nextTime - now;
    const diffMins = Math.ceil(diffMs / (60 * 1000));

    const exactStr = nextTime.toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });

    if (diffMins < 60) {
        return `in ${diffMins}m (${exactStr})`;
    } else {
        const diffHrs = Math.floor(diffMins / 60);
        const remainingMins = diffMins % 60;
        if (diffHrs < 24) {
            return `in ${diffHrs}h ${remainingMins}m (${exactStr})`;
        } else {
            const diffDays = Math.floor(diffHrs / 24);
            const remainingHrs = diffHrs % 24;
            return `in ${diffDays}d ${remainingHrs}h (${exactStr})`;
        }
    }
}

// ==========================================================================
// RENDERERS & CALCULATORS
// ==========================================================================

function renderTodos() {
    const listContainer = document.getElementById("todos-list");
    listContainer.innerHTML = ""; // Clear

    // Sort logic: Overdue first, otherwise closest deadline first
    const now = new Date();
    const sortedTodos = [...state.todos].sort((a, b) => {
        // Active first, completed last
        if (a.completed !== b.completed) {
            return a.completed ? 1 : -1;
        }

        const aTime = new Date(a.deadline);
        const bTime = new Date(b.deadline);

        // Sorting active items
        return aTime - bTime;
    });

    // Filter logic
    let filteredTodos = sortedTodos.filter(t => {
        // Search filter
        const matchSearch = t.title.toLowerCase().includes(state.searchQuery) ||
            t.description.toLowerCase().includes(state.searchQuery);

        if (!matchSearch) return false;

        // Tab Filter
        if (state.filter === "active") return !t.completed;
        if (state.filter === "completed") return t.completed;
        if (state.filter === "overdue") {
            const isOverdue = new Date(t.deadline) < now;
            return !t.completed && isOverdue;
        }
        return true;
    });

    // Update stats summaries
    calculateStats();



    if (filteredTodos.length === 0) {
        listContainer.innerHTML = `
            <div class="empty-state glass-panel">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="m9 12 2 2 4-4"/></svg>
                <p>No tasks matched your search or filter requirements.</p>
            </div>
        `;
        return;
    }

    filteredTodos.forEach((todo, idx) => {
        const deadline = new Date(todo.deadline);
        const isOverdue = deadline < now && !todo.completed;
        const countdownStr = formatRemainingTime(todo.deadline, todo.completed);

        const card = document.createElement("div");
        card.className = `todo-card glass-panel todo-priority-${todo.priority} ${todo.completed ? 'todo-card-completed' : ''}`;
        card.style.animationDelay = `${idx * 0.05}s`;

        card.innerHTML = `
            <div class="todo-check-container">
                <div class="todo-checkbox ${todo.completed ? 'todo-checkbox-checked' : ''}" onclick="handleToggleTodo('${todo.id}')">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
            </div>
            <div class="todo-content">
                <h4 class="todo-title">${escapeHtml(todo.title)}</h4>
                ${todo.description ? `<p class="todo-desc">${escapeHtml(todo.description)}</p>` : ''}
                <div class="todo-meta">
                    <span class="meta-badge ${todo.completed ? '' : 'countdown-timer'} ${isOverdue ? 'badge-overdue' : ''}" data-deadline="${todo.deadline}" data-completed="${todo.completed}">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                        <span class="countdown-text">${countdownStr}</span>
                    </span>
                    <span class="meta-badge" title="Exact Task Deadline Date & Time">📅 ${formatExactDate(todo.deadline)}</span>
                    <span class="meta-badge">Priority: ${todo.priority.toUpperCase()}</span>
                    <span class="meta-badge badge-telegram" title="Current Active Telegram Alert Interval">Interval: ${getActiveInterval(todo)}</span>
                    ${todo.last_notified_at ? `<span class="meta-badge badge-telegram" title="Last Telegram notification dispatch timestamp">📢 Sent: ${new Date(todo.last_notified_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>` : ''}
                    ${state.showNextNotification && getNextNotificationTime(todo) ? `
                    <span class="meta-badge badge-telegram next-send-timer" 
                          data-id="${todo.id}"
                          data-deadline="${todo.deadline}" 
                          data-interval="${todo.notification_interval}" 
                          data-last-notified="${todo.last_notified_at || ''}" 
                          data-completed="${todo.completed}"
                          title="Next scheduled Telegram notification dispatch time">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                            <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                        </svg>
                        <span class="next-send-text">Next Alert: ${formatNextNotification(todo)}</span>
                    </span>` : ''}
                </div>
            </div>
            <div class="todo-actions">
                <button class="action-btn" onclick="openEditModal('${todo.id}')" title="Edit task properties">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
                <button class="action-btn action-btn-danger" onclick="handleDeleteTodo('${todo.id}')" title="Permanently delete task">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
            </div>
        `;
        listContainer.appendChild(card);
    });
}

function calculateStats() {
    const now = new Date();
    const total = state.todos.length;
    const completed = state.todos.filter(t => t.completed).length;
    const pending = total - completed;

    const overdue = state.todos.filter(t => {
        const deadline = new Date(t.deadline);
        return !t.completed && deadline < now;
    }).length;

    document.getElementById("stat-total").textContent = total;
    document.getElementById("stat-pending").textContent = pending;
    document.getElementById("stat-completed").textContent = completed;
    document.getElementById("stat-overdue").textContent = overdue;

    // Toggle active ringing bell on overdue icon if there are any overdue items
    const overdueIcon = document.querySelector(".icon-overdue");
    if (overdueIcon) {
        if (overdue > 0) {
            overdueIcon.classList.add("alert-bell");
        } else {
            overdueIcon.classList.remove("alert-bell");
        }
    }
}

function formatRemainingTime(deadlineStr, isCompleted) {
    if (isCompleted) return "Completed";

    const deadline = new Date(deadlineStr);
    const now = new Date();
    const diffMs = deadline - now;

    if (diffMs < 0) {
        const absMs = Math.abs(diffMs);
        const totalSecs = Math.floor(absMs / 1000);
        const secs = totalSecs % 60;
        const totalMins = Math.floor(totalSecs / 60);
        const mins = totalMins % 60;
        const totalHrs = Math.floor(totalMins / 60);
        const hrs = totalHrs % 24;
        const days = Math.floor(totalHrs / 24);

        let timeStr = "";
        if (days > 0) timeStr += `${days}d `;
        if (hrs > 0 || days > 0) timeStr += `${hrs}h `;
        if (mins > 0 || hrs > 0 || days > 0) timeStr += `${mins}m `;
        timeStr += `${secs}s`;
        return `⚠️ ${timeStr} Overdue`;
    } else {
        const totalSecs = Math.floor(diffMs / 1000);
        const secs = totalSecs % 60;
        const totalMins = Math.floor(totalSecs / 60);
        const mins = totalMins % 60;
        const totalHrs = Math.floor(totalMins / 60);
        const hrs = totalHrs % 24;
        const days = Math.floor(totalHrs / 24);

        let timeStr = "";
        if (days > 0) timeStr += `${days}d `;
        if (hrs > 0 || days > 0) timeStr += `${String(hrs).padStart(2, '0')}h `;
        if (mins > 0 || hrs > 0 || days > 0) timeStr += `${String(mins).padStart(2, '0')}m `;
        timeStr += `${String(secs).padStart(2, '0')}s`;
        return `${timeStr} remaining`;
    }
}

function tickCountdowns() {
    const now = new Date();
    document.querySelectorAll(".countdown-timer").forEach(el => {
        const deadlineStr = el.dataset.deadline;
        const isCompleted = el.dataset.completed === "true";
        if (isCompleted) return;

        const deadline = new Date(deadlineStr);
        const diffMs = deadline - now;
        const countdownTextEl = el.querySelector(".countdown-text");

        if (!countdownTextEl) return;

        if (diffMs < 0) {
            const absMs = Math.abs(diffMs);
            const totalSecs = Math.floor(absMs / 1000);
            const secs = totalSecs % 60;
            const totalMins = Math.floor(totalSecs / 60);
            const mins = totalMins % 60;
            const totalHrs = Math.floor(totalMins / 60);
            const hrs = totalHrs % 24;
            const days = Math.floor(totalHrs / 24);

            let timeStr = "";
            if (days > 0) timeStr += `${days}d `;
            if (hrs > 0 || days > 0) timeStr += `${hrs}h `;
            if (mins > 0 || hrs > 0 || days > 0) timeStr += `${mins}m `;
            timeStr += `${secs}s`;

            countdownTextEl.textContent = `⚠️ ${timeStr} Overdue`;
            el.classList.add("badge-overdue");
        } else {
            const totalSecs = Math.floor(diffMs / 1000);
            const secs = totalSecs % 60;
            const totalMins = Math.floor(totalSecs / 60);
            const mins = totalMins % 60;
            const totalHrs = Math.floor(totalMins / 60);
            const hrs = totalHrs % 24;
            const days = Math.floor(totalHrs / 24);

            let timeStr = "";
            if (days > 0) timeStr += `${days}d `;
            if (hrs > 0 || days > 0) timeStr += `${String(hrs).padStart(2, '0')}h `;
            if (mins > 0 || hrs > 0 || days > 0) timeStr += `${String(mins).padStart(2, '0')}m `;
            timeStr += `${String(secs).padStart(2, '0')}s`;

            countdownTextEl.textContent = `${timeStr} remaining`;
            el.classList.remove("badge-overdue");
        }
    });

    // Also tick next notification send timers
    if (state.showNextNotification) {
        document.querySelectorAll(".next-send-timer").forEach(el => {
            const todo = {
                id: el.dataset.id,
                deadline: el.dataset.deadline,
                notification_interval: parseInt(el.dataset.interval),
                last_notified_at: el.dataset.lastNotified || null,
                completed: el.dataset.completed === "true"
            };
            const textEl = el.querySelector(".next-send-text");
            if (textEl) {
                textEl.textContent = `Next Alert: ${formatNextNotification(todo)}`;
            }
        });
    }
}

function formatExactDate(deadlineStr) {
    if (!deadlineStr) return "No deadline";
    const d = new Date(deadlineStr);
    return d.toLocaleString([], {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function formatInterval(mins) {
    if (mins % 60 === 0) {
        return `${mins / 60}h`;
    }
    if (mins >= 60) {
        return `${Math.floor(mins / 60)}h ${mins % 60}m`;
    }
    return `${mins}m`;
}

function getActiveInterval(todo) {
    if (todo.completed) return formatInterval(todo.notification_interval || 60);
    if (!todo.deadline) return formatInterval(todo.notification_interval || 60);

    const deadline = new Date(todo.deadline);
    const now = new Date();
    const userInterval = todo.notification_interval || 60;

    if (deadline < now) {
        // Overdue: force 1m alerts (or faster if user configured)
        const active = Math.min(userInterval, 1);
        return active === userInterval ? formatInterval(userInterval) : `${formatInterval(active)} (Auto)`;
    }

    const diffMs = deadline - now;
    const diffHrs = diffMs / (1000 * 60 * 60);

    if (diffHrs <= 24) {
        let autoInterval = 60;
        if (diffHrs <= 1) {
            autoInterval = 1;
        } else if (diffHrs <= 2) {
            autoInterval = 5;
        } else if (diffHrs <= 6) {
            autoInterval = 30;
        }

        const active = Math.min(userInterval, autoInterval);
        return active === userInterval ? formatInterval(userInterval) : `${formatInterval(active)} (Auto)`;
    }

    return formatInterval(userInterval);
}

// ==========================================================================
// TOAST POPUPS (queued to prevent overlap)
// ==========================================================================

function showToast(message, type = "success") {
    _toastQueue.push({ message, type });
    if (!_toastActive) _processToastQueue();
}

function _processToastQueue() {
    if (_toastQueue.length === 0) { _toastActive = false; return; }
    _toastActive = true;
    const { message, type } = _toastQueue.shift();
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.className = "toast-hidden";
    // Force reflow for animation restart
    void toast.offsetWidth;
    toast.classList.add(`toast-${type}`);
    toast.classList.remove("toast-hidden");
    setTimeout(() => {
        toast.classList.add("toast-hidden");
        setTimeout(() => _processToastQueue(), 300);
    }, 4000);
}

// ==========================================================================
// LOADING SPINNER
// ==========================================================================

function showLoading() {
    if (document.getElementById("loading-overlay")) return;
    const el = document.createElement("div");
    el.id = "loading-overlay";
    el.className = "loading-overlay";
    el.innerHTML = '<div class="spinner"></div>';
    document.body.appendChild(el);
}

function hideLoading() {
    const el = document.getElementById("loading-overlay");
    if (el) el.remove();
}

// ==========================================================================
// CUSTOM CONFIRM MODAL (replaces native confirm())
// ==========================================================================

function showConfirmModal(title, text, onConfirm) {
    // Remove any existing
    const old = document.getElementById("confirm-modal");
    if (old) old.remove();

    const overlay = document.createElement("div");
    overlay.id = "confirm-modal";
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
        <div class="confirm-modal-card">
            <div class="confirm-icon">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </div>
            <h3 class="confirm-title">${title}</h3>
            <p class="confirm-text">${text}</p>
            <div class="confirm-actions">
                <button class="btn btn-secondary" id="confirm-cancel-btn">Cancel</button>
                <button class="btn btn-danger" id="confirm-ok-btn">Delete</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById("confirm-cancel-btn").addEventListener("click", () => overlay.remove());
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
    document.getElementById("confirm-ok-btn").addEventListener("click", () => {
        overlay.remove();
        onConfirm();
    });
}

// ==========================================================================
// TELEMETRY UTILITY SANITIZERS
// ==========================================================================

function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// ==========================================================================
// IMPORT / EXPORT SYSTEM
// ==========================================================================

function openExportModal() {
    if (state.todos.length === 0) {
        showToast("No tasks available to export", "info");
        return;
    }

    state.selectedTodoIds = []; // clear selection
    document.getElementById("export-select-all").checked = false;

    const listContainer = document.getElementById("export-tasks-list");
    listContainer.innerHTML = "";

    state.todos.forEach(todo => {
        const item = document.createElement("div");
        item.className = "export-task-item";
        item.onclick = (e) => {
            // If the user clicked the checkbox itself, don't double toggle
            if (e.target.tagName !== "INPUT") {
                const cb = item.querySelector(".export-task-checkbox");
                cb.checked = !cb.checked;
                cb.dispatchEvent(new Event("change"));
            }
        };

        item.innerHTML = `
            <input type="checkbox" class="export-task-checkbox" data-id="${todo.id}">
            <div class="export-task-info">
                <span class="export-task-title">${escapeHtml(todo.title)}</span>
                <span class="export-task-meta">Priority: ${todo.priority.toUpperCase()} | Deadline: ${formatExactDate(todo.deadline)}</span>
            </div>
        `;

        // Listen to change on the checkbox to track selection
        const checkbox = item.querySelector(".export-task-checkbox");
        checkbox.addEventListener("change", (e) => {
            const id = e.target.dataset.id;
            if (e.target.checked) {
                if (!state.selectedTodoIds.includes(id)) state.selectedTodoIds.push(id);
            } else {
                state.selectedTodoIds = state.selectedTodoIds.filter(x => x !== id);
            }
            // Update the Select All checkbox state
            const allChecked = state.selectedTodoIds.length === state.todos.length;
            document.getElementById("export-select-all").checked = allChecked;
        });

        listContainer.appendChild(item);
    });

    document.getElementById("export-task-modal").classList.remove("hidden");
}

function handleExportSelectAllToggle(e) {
    const isChecked = e.target.checked;
    state.selectedTodoIds = [];

    const checkboxes = document.querySelectorAll("#export-tasks-list .export-task-checkbox");
    checkboxes.forEach(cb => {
        cb.checked = isChecked;
        const id = cb.dataset.id;
        if (isChecked) {
            state.selectedTodoIds.push(id);
        }
    });
}

function submitExportTasks() {
    if (state.selectedTodoIds.length === 0) {
        showToast("Please select at least one task to export", "warning");
        return;
    }

    const tasksToExport = state.todos
        .filter(t => state.selectedTodoIds.includes(t.id))
        .map(t => ({
            title: t.title,
            description: t.description || "",
            deadline: t.deadline,
            priority: t.priority || "medium",
            notification_interval: t.notification_interval || 60,
            completed: t.completed || false
        }));

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(tasksToExport, null, 4));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `mustdo_selected_tasks_${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();

    document.getElementById("export-task-modal").classList.add("hidden");
    showToast(`Successfully exported ${state.selectedTodoIds.length} tasks!`, "success");
}

async function handleImportTasks(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async function(event) {
        try {
            const tasks = JSON.parse(event.target.result);
            if (!Array.isArray(tasks)) {
                showToast("Invalid import file format. Must be a JSON array.", "error");
                return;
            }

            if (tasks.length === 0) {
                showToast("No tasks found in the import file.", "info");
                return;
            }

            showLoading();
            let successCount = 0;
            let errorCount = 0;

            for (const task of tasks) {
                if (!task.title || !task.deadline) {
                    errorCount++;
                    continue;
                }

                try {
                    // Normalize deadline to ISO
                    const deadlineISO = new Date(task.deadline).toISOString();

                    const response = await fetch(`${API_BASE}/api/todos`, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "Authorization": `Bearer ${state.token}`
                        },
                        body: JSON.stringify({
                            title: task.title,
                            description: task.description || "",
                            deadline: deadlineISO,
                            priority: task.priority || "medium",
                            notification_interval: parseInt(task.notification_interval) || 60
                        })
                    });

                    if (response.ok) {
                        const newTodo = await response.json();
                        // Sync completed state if imported task was completed
                        if (task.completed) {
                            await fetch(`${API_BASE}/api/todos/${newTodo.id}/toggle`, {
                                method: "POST",
                                headers: { "Authorization": `Bearer ${state.token}` }
                            });
                        }
                        successCount++;
                    } else {
                        errorCount++;
                    }
                } catch (err) {
                    console.error("Error importing task:", err);
                    errorCount++;
                }
            }

            // Reset file input
            e.target.value = "";
            hideLoading();

            await loadTodos();

            if (successCount > 0) {
                showToast(`Successfully imported ${successCount} tasks!`, "success");
            }
            if (errorCount > 0) {
                showToast(`Failed to import ${errorCount} tasks.`, "error");
            }

        } catch (err) {
            console.error("JSON parsing error:", err);
            hideLoading();
            showToast("Failed to parse JSON file.", "error");
        }
    };
    reader.readAsText(file);
}
