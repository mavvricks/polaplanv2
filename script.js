/**
 * Academic To-Do & Deadlines App
 * Core Application Logic
 */

// --- 1. State Management ---
// Default configurations removed as data now syncs directly from Google Sheets

// --- Google Sheets Sync ---
// PASTE YOUR DEPLOYED APPS SCRIPT WEB APP URL BELOW:
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxg25q8ED9qFbNMNQE9BvfujISWIaa5P1yu6M3JTs3xxS6ME9ztIqv83ZskuilWC9DO-w/exec'

const SheetsSync = {
    isEnabled() {
        return APPS_SCRIPT_URL && APPS_SCRIPT_URL.length > 10;
    },

    async pull() {
        if (!this.isEnabled()) return null;
        try {
            const res = await fetch(APPS_SCRIPT_URL + '?action=getAll');
            const json = await res.json();
            if (json.success) return json.data;
        } catch (e) {
            console.warn('Sheets pull failed:', e);
        }
        return null;
    },

    async pushAll(tasks, subjects) {
        if (!this.isEnabled()) return;
        try {
            await fetch(APPS_SCRIPT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({ action: 'syncAll', tasks, subjects })
            });
        } catch (e) {
            console.warn('Sheets push failed:', e);
        }
    },

    async post(payload) {
        if (!this.isEnabled()) return;
        try {
            await fetch(APPS_SCRIPT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify(payload)
            });
        } catch (e) {
            console.warn('Sheets post failed:', e);
        }
    }
};

class StateManager {
    constructor() {
        this.tasks = JSON.parse(localStorage.getItem('academic_tasks')) || [];
        this.subjects = JSON.parse(localStorage.getItem('academic_subjects')) || [];
        this.settings = JSON.parse(localStorage.getItem('academic_settings')) || { hideCompleted: false };
    }

    saveSettings() {
        localStorage.setItem('academic_settings', JSON.stringify(this.settings));
    }

    saveTasks() {
        localStorage.setItem('academic_tasks', JSON.stringify(this.tasks));
    }

    saveSubjects() {
        localStorage.setItem('academic_subjects', JSON.stringify(this.subjects));
    }

    addTask(task) {
        task.id = 'task-' + Date.now();
        task.completed = false;
        this.tasks.push(task);
        this.saveTasks();
        SheetsSync.post({ action: 'addTask', task });
        return task;
    }

    updateTask(updatedTask) {
        const index = this.tasks.findIndex(t => t.id === updatedTask.id);
        if (index !== -1) {
            this.tasks[index] = updatedTask;
            this.saveTasks();
            SheetsSync.post({ action: 'updateTask', task: updatedTask });
        }
    }

    deleteTask(id) {
        this.tasks = this.tasks.filter(t => t.id !== id);
        this.saveTasks();
        SheetsSync.post({ action: 'deleteTask', taskId: id });
    }

    addSubject(name, color) {
        const newSub = {
            id: 'sub-' + Date.now(),
            name,
            color
        };
        this.subjects.push(newSub);
        this.saveSubjects();
        SheetsSync.post({ action: 'addSubject', subject: newSub });
        return newSub;
    }

    getSubjectById(id) {
        return this.subjects.find(s => s.id === id);
    }

    // Full sync: push everything to Google Sheets
    async syncToSheets() {
        await SheetsSync.pushAll(this.tasks, this.subjects);
    }

    // Pull from Google Sheets and overwrite local
    async syncFromSheets() {
        const data = await SheetsSync.pull();
        if (data) {
            if (data.tasks) {
                // Sanitize dates to ensure YYYY-MM-DD strict matching for Calendar view
                this.tasks = data.tasks.map(t => {
                    if (t.date) {
                        if (t.date.includes('T')) {
                            // Google Sheets APIs might return ISO strings like 2026-03-10T16:00:00.000Z
                            // Use LOCAL date parts (not UTC) since the ISO timestamp represents
                            // a date that was stored relative to the spreadsheet/user timezone
                            const d = new Date(t.date);
                            const yyyy = d.getFullYear();
                            const mm = String(d.getMonth() + 1).padStart(2, '0');
                            const dd = String(d.getDate()).padStart(2, '0');
                            t.date = `${yyyy}-${mm}-${dd}`;
                        }
                        // Ensure the date string is always clean YYYY-MM-DD
                        t.date = t.date.trim().substring(0, 10);
                    }
                    return t;
                });
                this.saveTasks();
            }
            if (data.subjects) {
                this.subjects = data.subjects;
                this.saveSubjects();
            }
            return true;
        }
        return false;
    }
}

const Store = new StateManager();

// --- 2. UI Variables & State ---
let currentDate = new Date();
let currentView = 'list'; // 'calendar' or 'list'
let selectedDateStr = null; // YYYY-MM-DD for modal

let currentWeekOffset = 0; // Pagination state for list view

// --- Format Times Helper ---
function formatTime(timeStr) {
    if (!timeStr) return '';
    const [h, m] = timeStr.split(':');
    let hours = parseInt(h);
    const ampm = hours >= 12 ? 'pm' : 'am';
    hours = hours % 12;
    hours = hours ? hours : 12; // the hour '0' should be '12'
    return `${hours}:${m}${ampm}`;
}

function toLocalDateString(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseLocalDate(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
}

function formatEstimate(minutes) {
    if (!minutes) return '';
    const value = Number(minutes);
    if (!value) return '';
    if (value < 60) return `${value} min`;
    if (value === 60) return '1 hour';
    if (value % 60 === 0) return `${value / 60} hours`;
    return `${Math.floor(value / 60)}h ${value % 60}m`;
}

function getTaskUrgency(task) {
    if (task.completed) return 99;
    const today = toLocalDateString();
    if (task.date < today) return 0;
    if (task.date === today) return 1;
    if (task.type === 'due') return 2;
    return 3;
}

// Ensure the calendar modal checkboxes work immediately when rendered
document.addEventListener('change', (e) => {
    if (e.target.classList.contains('calendar-modal-checkbox')) {
        const taskId = e.target.dataset.id;
        const task = Store.tasks.find(t => t.id === taskId);
        if (task) {
            task.completed = e.target.checked;
            Store.updateTask(task);
            
            // Re-render the specific modal contents to show crossed-out style instantly
            refreshDayTasksInModal(task.date);
            // Re-render behind the modal so calendar grid syncs up
            renderAll();
        }
    }
});

let currentTaskId = null; // for editing tasks
let editMode = false;
let taskToDelete = null;
let subjectToDelete = null;

// Search & Filter state
let searchTerm = '';
let filterType = 'all';
let filterSubject = 'all';

document.addEventListener('DOMContentLoaded', async () => {
    lucide.createIcons();
    const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    document.getElementById('current-date-display').textContent = new Date().toLocaleDateString('en-US', dateOptions);

    // Attempt to pull from Google Sheets on load
    if (SheetsSync.isEnabled()) {
        const pulled = await Store.syncFromSheets();
        if (!pulled) {
            // Sheet is empty or unreachable — push local data up
            await Store.syncToSheets();
        }
    }

    populateSubjectDropdowns();
    renderAll();
    setupEventListeners();
});

function renderAll() {
    updateCounters();
    renderDashboard();
    if (currentView === 'calendar') {
        renderCalendar();
    } else {
        renderList();
    }
}

function updateCounters() {
    // Only count tasks that are NOT completed
    const todos = Store.tasks.filter(t => t.type === 'todo' && !t.completed);
    const dues = Store.tasks.filter(t => t.type === 'due' && !t.completed);
    
    const todoEl = document.getElementById('count-todo');
    const dueEl = document.getElementById('count-due');
    if(todoEl) todoEl.textContent = `${todos.length} To-Dos`;
    if(dueEl) dueEl.textContent = `${dues.length} Dues`;
}

function renderDashboard() {
    const todayStr = toLocalDateString();
    const { start, end } = getWeekRange(0);
    const startStr = toLocalDateString(start);
    const endStr = toLocalDateString(end);
    const openTasks = Store.tasks.filter(t => !t.completed);
    const completedCount = Store.tasks.filter(t => t.completed).length;
    const totalCount = Store.tasks.length;
    const overdue = openTasks.filter(t => t.date && t.date < todayStr).length;
    const dueToday = openTasks.filter(t => t.date === todayStr).length;
    const thisWeek = openTasks.filter(t => t.date >= startStr && t.date <= endStr).length;
    const progress = totalCount ? Math.round((completedCount / totalCount) * 100) : 0;

    const statOverdue = document.getElementById('stat-overdue');
    const statToday = document.getElementById('stat-today');
    const statWeek = document.getElementById('stat-week');
    const statProgress = document.getElementById('stat-progress');
    if (statOverdue) statOverdue.textContent = overdue;
    if (statToday) statToday.textContent = dueToday;
    if (statWeek) statWeek.textContent = thisWeek;
    if (statProgress) statProgress.textContent = `${progress}%`;

    const focusTask = [...openTasks]
        .filter(t => t.date)
        .sort((a, b) => {
            const urgency = getTaskUrgency(a) - getTaskUrgency(b);
            if (urgency !== 0) return urgency;
            if (a.date !== b.date) return a.date.localeCompare(b.date);
            const priorityScore = { high: 0, normal: 1, low: 2 };
            return (priorityScore[a.priority || 'normal'] ?? 1) - (priorityScore[b.priority || 'normal'] ?? 1);
        })[0];

    const focusTitle = document.getElementById('focus-title');
    const focusMeta = document.getElementById('focus-meta');
    const focusBtn = document.getElementById('btn-focus-complete');
    if (focusTitle && focusMeta && focusBtn) {
        if (focusTask) {
            const subject = Store.getSubjectById(focusTask.subject);
            const dateLabel = parseLocalDate(focusTask.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
            const time = focusTask.deadlineTime ? ` at ${formatTime(focusTask.deadlineTime)}` : '';
            focusTitle.textContent = focusTask.title;
            focusMeta.textContent = `${subject ? subject.name : 'No subject'} • ${dateLabel}${time} • ${focusTask.type === 'due' ? 'Due' : 'To-do'}`;
            focusBtn.disabled = false;
            focusBtn.dataset.id = focusTask.id;
        } else {
            focusTitle.textContent = 'No urgent tasks';
            focusMeta.textContent = 'Add tasks with dates to build your study plan.';
            focusBtn.disabled = true;
            delete focusBtn.dataset.id;
        }
    }

    renderSubjectChips();
}

function renderSubjectChips() {
    const chips = document.getElementById('subject-chips');
    if (!chips) return;
    chips.innerHTML = '';

    if (Store.subjects.length === 0) {
        chips.innerHTML = '<span class="empty-chip">Create subjects to unlock quick filters.</span>';
        return;
    }

    Store.subjects.forEach(subject => {
        const count = Store.tasks.filter(t => t.subject === subject.id && !t.completed).length;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `subject-chip ${filterSubject === subject.id ? 'active' : ''}`;
        button.style.setProperty('--chip-color', subject.color);
        button.dataset.subjectId = subject.id;
        button.textContent = `${subject.name} ${count}`;
        chips.appendChild(button);
    });
}

// --- 3. Event Listeners ---
function setupEventListeners() {
    // Top Bar (View toggle)
    document.getElementById('btn-calendar-view').addEventListener('click', (e) => {
        switchView('calendar', e.currentTarget);
    });
    document.getElementById('btn-list-view').addEventListener('click', (e) => {
        switchView('list', e.currentTarget);
    });

    // Top Bar (Settings & Export PDF)
    const exportBtn = document.getElementById('btn-export-pdf');
    if (exportBtn) {
        exportBtn.addEventListener('click', exportCurrentViewToPDF);
    }

    const copyBtn = document.getElementById('btn-copy-tasks');
    if (copyBtn) {
        copyBtn.addEventListener('click', copyTasksToClipboard);
    }

    const syncBtn = document.getElementById('btn-sync');
    if (syncBtn) {
        syncBtn.addEventListener('click', async () => {
            if (!SheetsSync.isEnabled()) {
                showToast('Google Sheets URL not configured', 'error');
                return;
            }
            syncBtn.style.animation = 'spin 1s linear infinite';
            showToast('Syncing with Google Sheets...', 'success');
            try {
                await Store.syncToSheets();
                showToast('Synced to Google Sheets!', 'success');
            } catch (e) {
                showToast('Sync failed', 'error');
            }
            syncBtn.style.animation = '';
        });
    }
    
    document.getElementById('btn-settings').addEventListener('click', openSettingsModal);
    document.querySelectorAll('.close-settings').forEach(btn => btn.addEventListener('click', closeSettingsModal));

    const dashboardAddBtn = document.getElementById('btn-dashboard-add-task');
    if (dashboardAddBtn) {
        dashboardAddBtn.addEventListener('click', () => {
            selectedDateStr = toLocalDateString();
            openDayModal(selectedDateStr);
        });
    }

    const focusCompleteBtn = document.getElementById('btn-focus-complete');
    if (focusCompleteBtn) {
        focusCompleteBtn.addEventListener('click', () => {
            const task = Store.tasks.find(t => t.id === focusCompleteBtn.dataset.id);
            if (!task) return;
            task.completed = true;
            Store.updateTask(task);
            showToast('Focus task completed', 'success');
            renderAll();
        });
    }

    document.querySelectorAll('.quick-filter').forEach(btn => {
        btn.addEventListener('click', () => {
            filterType = btn.dataset.filterType || 'all';
            document.getElementById('filter-type').value = filterType;
            renderAll();
        });
    });

    const subjectChips = document.getElementById('subject-chips');
    if (subjectChips) {
        subjectChips.addEventListener('click', (e) => {
            const chip = e.target.closest('.subject-chip');
            if (!chip) return;
            filterSubject = filterSubject === chip.dataset.subjectId ? 'all' : chip.dataset.subjectId;
            document.getElementById('filter-subject').value = filterSubject;
            renderAll();
        });
    }
    
    document.getElementById('setting-hide-completed').addEventListener('change', (e) => {
        Store.settings.hideCompleted = e.target.checked;
        Store.saveSettings();
        renderAll();
    });

    // Top Bar (Search & Filter)
    document.getElementById('search-input').addEventListener('input', (e) => {
        searchTerm = e.target.value.toLowerCase();
        renderAll();
    });
    document.getElementById('filter-type').addEventListener('change', (e) => {
        filterType = e.target.value;
        renderAll();
    });
    document.getElementById('filter-subject').addEventListener('change', (e) => {
        filterSubject = e.target.value;
        renderAll();
    });

    // Calendar Navigation
    document.getElementById('btn-prev-month').addEventListener('click', () => {
        currentDate.setMonth(currentDate.getMonth() - 1);
        renderCalendar();
    });
    document.getElementById('btn-next-month').addEventListener('click', () => {
        currentDate.setMonth(currentDate.getMonth() + 1);
        renderCalendar();
    });
    document.getElementById('btn-today').addEventListener('click', () => {
        currentDate = new Date();
        renderCalendar();
    });

    // List view add button
    document.getElementById('btn-add-task-list').addEventListener('click', () => {
        selectedDateStr = toLocalDateString();
        openDayModal(selectedDateStr);
    });

    // List View Pagination
    document.getElementById('btn-prev-week').addEventListener('click', () => {
        currentWeekOffset--;
        renderList();
    });
    document.getElementById('btn-next-week').addEventListener('click', () => {
        currentWeekOffset++;
        renderList();
    });
    document.getElementById('btn-today-list').addEventListener('click', () => {
        currentWeekOffset = 0;
        renderList();
    });

    // Calendar Grid clicks (Event Delegation)
    document.getElementById('calendar-grid').addEventListener('click', (e) => {
        const dayCell = e.target.closest('.calendar-day');
        if (dayCell) {
            selectedDateStr = dayCell.dataset.date; // e.g., "2023-10-15"
            openDayModal(selectedDateStr);
        }
    });

    // Modal Close
    const closeModalBtns = document.querySelectorAll('.close-modal');
    closeModalBtns.forEach(btn => btn.addEventListener('click', closeDayModal));
    
    // Task Form
    const taskForm = document.getElementById('task-form');
    taskForm.addEventListener('submit', (e) => {
        e.preventDefault();
        saveTaskFromForm();
    });
    document.getElementById('btn-cancel-task').addEventListener('click', resetTaskForm);

    // Subject Form
    document.getElementById('btn-new-subject').addEventListener('click', openSubjectModal);
    const closeSubjBtns = document.querySelectorAll('.close-subject-modal');
    closeSubjBtns.forEach(btn => btn.addEventListener('click', closeSubjectModal));
    document.getElementById('subject-form').addEventListener('submit', (e) => {
        e.preventDefault();
        saveNewSubject();
    });
    
    document.getElementById('settings-subjects-list').addEventListener('click', (e) => {
        const delBtn = e.target.closest('.delete-subject-btn');
        if (delBtn) {
            const subId = delBtn.dataset.id;
            window.executeSubjectDeletion(subId);
        }
    });

    // Hook up Add Subject in Settings
    const settingsAddSubjForm = document.getElementById('settings-add-subject-form');
    if (settingsAddSubjForm) {
        settingsAddSubjForm.addEventListener('submit', handleAddSubjectFromSettings);
    }

    // Delete Modal Actions
    document.getElementById('btn-cancel-delete').addEventListener('click', () => {
        closeConfirmModal();
    });
    document.getElementById('btn-confirm-delete').addEventListener('click', () => {
        if (taskToDelete) {
            Store.deleteTask(taskToDelete);
            taskToDelete = null;
            showToast('Task deleted successfully', 'success');
            closeConfirmModal();
            closeDayModal();
            renderAll();
        }
    });
    
    // Day tasks action clicks
    document.getElementById('day-tasks-list').addEventListener('click', (e) => {
        const editBtn = e.target.closest('.edit-btn');
        if (editBtn) {
            const taskId = editBtn.dataset.id;
            editTask(taskId);
            return;
        }
        const delBtn = e.target.closest('.delete-btn');
        if (delBtn) {
            const taskId = delBtn.dataset.id;
            confirmDeleteTask(taskId);
            return;
        }
    });
    
    // List view action clicks
    document.getElementById('task-list').addEventListener('click', (e) => {
        const checkbox = e.target.closest('.task-checkbox');
        if (checkbox) {
            e.stopPropagation(); // prevent opening the modal
            const taskId = checkbox.dataset.id;
            const task = Store.tasks.find(t => t.id === taskId);
            if(task) {
                task.completed = checkbox.checked;
                Store.updateTask(task);
                renderAll();
            }
            return;
        }
        
        // Clicking anywhere else on the item opens it for editing
        const listItem = e.target.closest('.list-item');
        if (listItem && !e.target.closest('.task-checkbox')) {
            const taskId = listItem.dataset.id;
            const task = Store.tasks.find(t => t.id === taskId);
            if(task) {
                selectedDateStr = task.date;
                openDayModal(selectedDateStr);
                editTask(taskId);
            }
            return;
        }
    });

    // Drag and Drop (List View) with Placeholders
    const taskListElement = document.getElementById('task-list');
    let dragPlaceholder = document.createElement('div');
    dragPlaceholder.className = 'list-item drag-placeholder';
    
    taskListElement.addEventListener('dragstart', (e) => {
        const item = e.target.closest('.list-item:not(.drag-placeholder)');
        if (item) {
            e.dataTransfer.setData('text/plain', item.dataset.id);
            setTimeout(() => item.classList.add('dragging-active'), 0);
        }
    });
    
    taskListElement.addEventListener('dragend', (e) => {
        const item = e.target.closest('.list-item');
        if (item) item.classList.remove('dragging-active');
        if (dragPlaceholder.parentNode) {
            dragPlaceholder.parentNode.removeChild(dragPlaceholder);
        }
    });
    
    taskListElement.addEventListener('dragover', (e) => {
        e.preventDefault(); 
        const itemsContainer = e.target.closest('.list-section-items') || e.target.closest('.list-date-group');
        if (!itemsContainer) return;
        
        let container = itemsContainer.classList.contains('list-section-items') ? itemsContainer : itemsContainer.querySelector('.list-section-items');
        if (!container) return;

        const siblings = [...container.querySelectorAll('.list-item:not(.dragging-active):not(.drag-placeholder)')];
        const nextSibling = siblings.find(sibling => {
            const box = sibling.getBoundingClientRect();
            return e.clientY <= box.top + box.height / 2;
        });

        if (nextSibling) {
            container.insertBefore(dragPlaceholder, nextSibling);
        } else {
            container.appendChild(dragPlaceholder);
        }
    });

    taskListElement.addEventListener('dragleave', (e) => {
        // Handled naturally by dragover overwriting position
    });
    
    taskListElement.addEventListener('drop', (e) => {
        e.preventDefault();
        const dropZone = e.target.closest('.list-date-group');
        if (dragPlaceholder.parentNode) {
            dragPlaceholder.parentNode.removeChild(dragPlaceholder);
        }
        if (dropZone) {
            const taskId = e.dataTransfer.getData('text/plain');
            const newDate = dropZone.dataset.date;
            
            const task = Store.tasks.find(t => t.id === taskId);
            if (task) {
                let currentPos = Store.tasks.findIndex(t => t.id === taskId);
                
                // Change date if dropped in a different date group
                if (task.date !== newDate) {
                    task.date = newDate;
                } 
                
                // Advanced reordering logic (insertion based on exact y-coordinate)
                const itemsContainer = e.target.closest('.list-section-items') || dropZone;
                const siblings = [...itemsContainer.querySelectorAll('.list-item:not(.dragging-active)')];
                
                const nextSibling = siblings.find(sibling => {
                    const box = sibling.getBoundingClientRect();
                    return e.clientY <= box.top + box.height / 2;
                });
                
                // Move item in array to roughly match visual order 
                Store.tasks.splice(currentPos, 1); // remove
                
                if (nextSibling) {
                    const nextId = nextSibling.dataset.id;
                    const nextPos = Store.tasks.findIndex(t => t.id === nextId);
                    Store.tasks.splice(nextPos, 0, task); // insert before
                } else {
                    Store.tasks.push(task); // append to end
                }

                Store.saveTasks();
                renderAll();
            }
        }
    });

    // Drag and Drop (Calendar View)
    const calendarGridElement = document.getElementById('calendar-grid');
    
    calendarGridElement.addEventListener('dragstart', (e) => {
        const item = e.target.closest('.task-indicator');
        if (item) {
            e.dataTransfer.setData('text/plain', item.dataset.id);
            setTimeout(() => item.classList.add('dragging-active'), 0);
        }
    });
    
    calendarGridElement.addEventListener('dragend', (e) => {
        const item = e.target.closest('.task-indicator');
        if (item) item.classList.remove('dragging-active');
    });
    
    calendarGridElement.addEventListener('dragover', (e) => {
        e.preventDefault();
        const dropZone = e.target.closest('.calendar-day');
        if(dropZone && dropZone.dataset.date) {
            dropZone.classList.add('drag-over-calendar');
        }
    });

    calendarGridElement.addEventListener('dragleave', (e) => {
        const dropZone = e.target.closest('.calendar-day');
        if(dropZone) dropZone.classList.remove('drag-over-calendar');
    });
    
    calendarGridElement.addEventListener('drop', (e) => {
        e.preventDefault();
        const dropZone = e.target.closest('.calendar-day');
        if (dropZone && dropZone.dataset.date) {
            dropZone.classList.remove('drag-over-calendar');
            const taskId = e.dataTransfer.getData('text/plain');
            const newDate = dropZone.dataset.date;
            
            const task = Store.tasks.find(t => t.id === taskId);
            if (task) {
                let currentPos = Store.tasks.findIndex(t => t.id === taskId);
                if (task.date !== newDate) {
                    task.date = newDate;
                }
                
                // Advanced reordering logic for Calendar
                const tasksContainer = dropZone.querySelector('.day-tasks-container');
                if (tasksContainer) {
                    const siblings = [...tasksContainer.querySelectorAll('.task-indicator:not(.dragging-active)')];
                    const nextSibling = siblings.find(sibling => {
                        const box = sibling.getBoundingClientRect();
                        return e.clientY <= box.top + box.height / 2;
                    });
                    
                    Store.tasks.splice(currentPos, 1);
                    if (nextSibling) {
                        const nextId = nextSibling.dataset.id;
                        const nextPos = Store.tasks.findIndex(t => t.id === nextId);
                        Store.tasks.splice(nextPos, 0, task);
                    } else {
                        Store.tasks.push(task);
                    }
                }
                
                Store.saveTasks();
                renderAll();
            }
        }
    });
}

function switchView(viewName, btnElement) {
    document.querySelectorAll('.toggle-btn').forEach(btn => btn.classList.remove('active'));
    btnElement.classList.add('active');
    
    document.querySelectorAll('.view-section').forEach(sec => sec.classList.remove('active'));
    document.getElementById(`${viewName}-view`).classList.add('active');
    
    currentView = viewName;
    renderAll();
}

function getFilteredTasks() {
    return Store.tasks.filter(task => {
        // Text search (title, description, and subject name)
        const subject = Store.getSubjectById(task.subject);
        const subjectName = subject ? subject.name.toLowerCase() : '';
        const matchesSearch = (task.title || '').toLowerCase().includes(searchTerm) || 
                              (task.desc || '').toLowerCase().includes(searchTerm) ||
                              subjectName.includes(searchTerm);
        // Type filter
        const matchesType = filterType === 'all' || task.type === filterType;
        // Subject filter
        const matchesSubject = filterSubject === 'all' || task.subject === filterSubject;
        // Settings filter
        const matchesSettings = !Store.settings.hideCompleted || !task.completed;
        
        return matchesSearch && matchesType && matchesSubject && matchesSettings;
    });
}

function renderCalendar() {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth(); // 0-11
    
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    document.getElementById('calendar-month-year').textContent = `${monthNames[month]} ${year}`;
    
    const grid = document.getElementById('calendar-grid');
    grid.innerHTML = '';
    
    const firstDayIndex = new Date(year, month, 1).getDay(); // 0(Sun) - 6(Sat)
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const prevMonthDays = new Date(year, month, 0).getDate();
    
    const today = new Date();
    const isCurrentMonth = today.getMonth() === month && today.getFullYear() === year;
    const todayDate = today.getDate();
    
    const filteredTasks = getFilteredTasks();
    
    // Previous month's trailing days
    for (let x = firstDayIndex; x > 0; x--) {
        const d = prevMonthDays - x + 1;
        const div = createDayCell(d, true);
        grid.appendChild(div);
    }
    
    // Current month days
    for (let i = 1; i <= daysInMonth; i++) {
        // Build an isometric local sort string ignoring time zones
        const mStr = String(month+1).padStart(2, '0');
        const dStr = String(i).padStart(2, '0');
        const dateStr = `${year}-${mStr}-${dStr}`;
        const isToday = isCurrentMonth && i === todayDate;
        
        const div = createDayCell(i, false, isToday, dateStr);
        
        // Find and sort tasks for this day (Dues first)
        const dayTasks = filteredTasks.filter(t => t.date === dateStr);
        dayTasks.sort((a, b) => {
            if (a.type === 'due' && b.type !== 'due') return -1;
            if (a.type !== 'due' && b.type === 'due') return 1;
            return Store.tasks.indexOf(a) - Store.tasks.indexOf(b); // stable sort for manual reordering
        });

        const tasksContainer = document.createElement('div');
        tasksContainer.className = 'day-tasks-container';
        
        dayTasks.forEach(t => {
            const subject = Store.getSubjectById(t.subject);
            const color = subject ? subject.color : '#ccc';
            const typeClass = t.type === 'due' ? 'due' : 'todo';
            
            const taskEl = document.createElement('div');
            taskEl.className = 'task-indicator';
            if (t.completed) {
                taskEl.classList.add('completed');
            }
            taskEl.style.backgroundColor = color;
            const deadlineLabel = t.deadlineTime ? ` • ${formatTime(t.deadlineTime)}` : '';
            taskEl.title = `${t.title}${deadlineLabel}`;
            // Drag and drop attributes
            taskEl.dataset.id = t.id;
            taskEl.draggable = true;
            // Display only subject name and the type icon
            const subjName = subject ? subject.name : 'Task';
            taskEl.innerHTML = `<i data-lucide="${t.type === 'due' ? 'bell' : 'square'}"></i> <span>${subjName}${deadlineLabel}</span>`;
            tasksContainer.appendChild(taskEl);
        });
        
        div.appendChild(tasksContainer);
        grid.appendChild(div);
    }
    
    // Next month's leading days
    const totalCells = grid.children.length;
    let nextMonthDay = 1;
    for (let j = totalCells; j < 42; j++) { // 6 rows * 7 days
        const div = createDayCell(nextMonthDay++, true);
        grid.appendChild(div);
    }
    
    lucide.createIcons();
}

function createDayCell(dayNumber, isOtherMonth = false, isToday = false, dateStr = null) {
    const div = document.createElement('div');
    div.className = 'calendar-day';
    if (isOtherMonth) div.classList.add('other-month');
    if (isToday) div.classList.add('today');
    if (dateStr) div.dataset.date = dateStr;
    
    const numDiv = document.createElement('div');
    numDiv.className = 'day-number';
    numDiv.textContent = dayNumber;
    div.appendChild(numDiv);
    
    return div;
}

function exportCurrentViewToPDF() {
    showToast('Generating PDF...', 'success');
    
    const exportDiv = document.createElement('div');
    exportDiv.style.fontFamily = "'Segoe UI', Arial, sans-serif";
    exportDiv.style.color = '#e2e8f0';
    exportDiv.style.lineHeight = '1.5';
    exportDiv.style.background = '#0a0f0d';
    exportDiv.style.padding = '0';
    
    let tasks = [...getFilteredTasks()].sort((a, b) => new Date(a.date) - new Date(b.date));
    
    const totalTasks = tasks.length;
    const completedTasks = tasks.filter(t => t.completed).length;
    const pendingDues = tasks.filter(t => t.type === 'due' && !t.completed).length;
    const pendingTodos = tasks.filter(t => t.type === 'todo' && !t.completed).length;
    const exportDate = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    
    // --- Header Banner ---
    let htmlContent = `
        <div style="background: linear-gradient(135deg, #064e3b 0%, #022c22 100%); padding: 30px 35px; border-bottom: 3px solid #f59e0b;">
            <h1 style="margin: 0 0 4px 0; font-size: 1.6rem; font-weight: 700; color: #ffffff; letter-spacing: -0.02em;">Academic To-Do & Deadlines</h1>
            <p style="margin: 0; font-size: 0.85rem; color: #8ba39a; letter-spacing: 0.03em;">Exported on ${exportDate}</p>
        </div>
    `;
    
    // --- Stats Bar ---
    htmlContent += `
        <div style="display: flex; gap: 0; background: #0d1b16; border-bottom: 1px solid rgba(16, 185, 129, 0.15);">
            <div style="flex: 1; padding: 14px 20px; text-align: center; border-right: 1px solid rgba(16, 185, 129, 0.1);">
                <div style="font-size: 1.4rem; font-weight: 700; color: #f59e0b;">${totalTasks}</div>
                <div style="font-size: 0.7rem; color: #8ba39a; text-transform: uppercase; letter-spacing: 0.08em;">Total</div>
            </div>
            <div style="flex: 1; padding: 14px 20px; text-align: center; border-right: 1px solid rgba(16, 185, 129, 0.1);">
                <div style="font-size: 1.4rem; font-weight: 700; color: #ef4444;">${pendingDues}</div>
                <div style="font-size: 0.7rem; color: #8ba39a; text-transform: uppercase; letter-spacing: 0.08em;">Dues</div>
            </div>
            <div style="flex: 1; padding: 14px 20px; text-align: center; border-right: 1px solid rgba(16, 185, 129, 0.1);">
                <div style="font-size: 1.4rem; font-weight: 700; color: #f59e0b;">${pendingTodos}</div>
                <div style="font-size: 0.7rem; color: #8ba39a; text-transform: uppercase; letter-spacing: 0.08em;">To-Dos</div>
            </div>
            <div style="flex: 1; padding: 14px 20px; text-align: center;">
                <div style="font-size: 1.4rem; font-weight: 700; color: #10b981;">${completedTasks}</div>
                <div style="font-size: 0.7rem; color: #8ba39a; text-transform: uppercase; letter-spacing: 0.08em;">Done</div>
            </div>
        </div>
    `;
    
    // --- Task Body ---
    htmlContent += `<div style="padding: 25px 35px;">`;
    
    if (tasks.length === 0) {
        htmlContent += `<p style="text-align: center; color: #8ba39a; padding: 40px 0; font-style: italic;">No tasks match the current filters.</p>`;
    } else {
        const groups = {};
        tasks.forEach(t => {
            if (!groups[t.date]) groups[t.date] = { dues: [], todos: [] };
            if (t.type === 'due') groups[t.date].dues.push(t);
            else groups[t.date].todos.push(t);
        });
        
        const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        
        for (const [dateStr, group] of Object.entries(groups)) {
            // Parse YYYY-MM-DD as local date to avoid UTC-offset day shift
            const [pY, pM, pD] = dateStr.split('-');
            const dateObj = new Date(parseInt(pY), parseInt(pM) - 1, parseInt(pD));
            const displayDate = dateObj.toLocaleDateString('en-US', dateOptions);
            
            htmlContent += `
                <div style="margin-bottom: 20px;">
                    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px; padding-bottom: 6px; border-bottom: 1px solid rgba(16, 185, 129, 0.15);">
                        <span style="font-size: 0.95rem; font-weight: 600; color: #f59e0b; letter-spacing: 0.01em;">${displayDate}</span>
                        <span style="font-size: 0.75rem; color: #8ba39a;">(${group.dues.length + group.todos.length} tasks)</span>
                    </div>
            `;
            
            const renderTaskCard = (task, typeLabel, typeColor) => {
                const subject = Store.getSubjectById(task.subject);
                const subjName = subject ? subject.name : 'Task';
                const subjColor = subject ? subject.color : '#6b7280';
                const completedBadge = task.completed 
                    ? `<span style="background: #10b981; color: #000; font-size: 0.65rem; font-weight: 700; padding: 2px 8px; border-radius: 9999px; text-transform: uppercase; letter-spacing: 0.05em;">Done</span>` 
                    : '';
                const titleStyle = task.completed ? 'text-decoration: line-through; opacity: 0.6;' : '';
                const descHtml = task.desc ? `<div style="font-size: 0.8rem; color: #8ba39a; margin-top: 4px; padding-left: 1px;">${task.desc}</div>` : '';
                
                return `
                    <div style="display: flex; align-items: flex-start; gap: 12px; padding: 10px 14px; margin-bottom: 6px; background: rgba(255,255,255,0.03); border-radius: 8px; border: 1px solid rgba(255,255,255,0.06);">
                        <div style="width: 4px; min-height: 32px; border-radius: 4px; background: ${subjColor}; flex-shrink: 0; margin-top: 2px;"></div>
                        <div style="flex: 1;">
                            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                                <span style="font-size: 0.65rem; font-weight: 600; color: ${typeColor}; text-transform: uppercase; letter-spacing: 0.08em; padding: 1px 6px; border: 1px solid ${typeColor}; border-radius: 4px;">${typeLabel}</span>
                                <span style="font-size: 0.75rem; color: ${subjColor}; font-weight: 600;">${subjName}</span>
                                ${completedBadge}
                            </div>
                            <div style="font-size: 0.9rem; font-weight: 500; color: #e2e8f0; margin-top: 4px; ${titleStyle}">${task.title}</div>
                            ${descHtml}
                        </div>
                    </div>
                `;
            };
            
            group.dues.forEach(t => { htmlContent += renderTaskCard(t, 'Due', '#ef4444'); });
            group.todos.forEach(t => { htmlContent += renderTaskCard(t, 'To-Do', '#f59e0b'); });
            
            htmlContent += `</div>`;
        }
    }
    
    htmlContent += `</div>`;
    
    // --- Footer ---
    htmlContent += `
        <div style="padding: 15px 35px; background: #0d1b16; border-top: 1px solid rgba(16, 185, 129, 0.15); display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 0.7rem; color: #8ba39a;">Academic To-Do App</span>
            <span style="font-size: 0.7rem; color: #8ba39a;">Generated ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
    `;
    
    exportDiv.innerHTML = htmlContent;
    
    const opt = {
        margin:       0,
        filename:     `AcademicTasks_${toLocalDateString()}.pdf`,
        image:        { type: 'jpeg', quality: 1.0 },
        html2canvas:  { scale: 2, backgroundColor: '#0a0f0d' },
        jsPDF:        { unit: 'in', format: 'letter', orientation: 'portrait' }
    };

    html2pdf().set(opt).from(exportDiv).save().then(() => {
        showToast('PDF Exported Successfully!', 'success');
    }).catch(err => {
        console.error("PDF Export Error: ", err);
        showToast('Failed to export PDF', 'error');
    });
}

function copyTasksToClipboard() {
    let tasks = [...getFilteredTasks()].sort((a, b) => new Date(a.date) - new Date(b.date));
    
    if (tasks.length === 0) {
        showToast('No tasks to copy', 'error');
        return;
    }
    
    // Group by date
    const groups = {};
    tasks.forEach(t => {
        if (!groups[t.date]) groups[t.date] = [];
        groups[t.date].push(t);
    });
    
    const dateOptions = { year: 'numeric', month: 'long', day: 'numeric' };
    let textOutput = '';
    
    for (const [dateStr, dateTasks] of Object.entries(groups)) {
        // Parse YYYY-MM-DD as local date to avoid UTC-offset day shift
        const [cpY, cpM, cpD] = dateStr.split('-');
        const corrected = new Date(parseInt(cpY), parseInt(cpM) - 1, parseInt(cpD));
        const dayName = corrected.toLocaleDateString('en-US', { weekday: 'long' });
        const displayDate = corrected.toLocaleDateString('en-US', dateOptions);
        
        textOutput += `${displayDate} (${dayName})\n`;
        
        dateTasks.forEach(t => {
            const subject = Store.getSubjectById(t.subject);
            const subjName = subject ? subject.name : 'Task';
            const done = t.completed ? ' ✅' : '';
            textOutput += `• ${subjName}: ${t.title}${done}\n`;
        });
        
        textOutput += '\n';
    }
    
    navigator.clipboard.writeText(textOutput.trim()).then(() => {
        showToast('Tasks copied to clipboard!', 'success');
    }).catch(() => {
        showToast('Failed to copy tasks', 'error');
    });
}

function adjustColor(color, amount) {
    return '#' + color.replace(/^#/, '').replace(/../g, color => ('0'+Math.min(255, Math.max(0, parseInt(color, 16) + amount)).toString(16)).substr(-2));
}

function getWeekRange(offset) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const distanceToMonday = today.getDay() === 0 ? 6 : today.getDay() - 1; 
    const currentMonday = new Date(today);
    currentMonday.setDate(today.getDate() - distanceToMonday);
    
    const targetMonday = new Date(currentMonday);
    targetMonday.setDate(currentMonday.getDate() + (offset * 7));
    
    const targetSunday = new Date(targetMonday);
    targetSunday.setDate(targetMonday.getDate() + 6);
    
    return { start: targetMonday, end: targetSunday };
}

function renderList() {
    const listBody = document.getElementById('task-list');
    listBody.innerHTML = '';
    
    let filteredTasks = getFilteredTasks();
    
    // Pagination by Week calculation
    const { start, end } = getWeekRange(currentWeekOffset);
    
    // Format range for display
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const dStart = `${monthNames[start.getMonth()]} ${start.getDate()}`;
    const dEnd = `${monthNames[end.getMonth()]} ${end.getDate()}`;
    const weekLabel = document.getElementById('list-week-range');
    if (weekLabel) {
        weekLabel.textContent = currentWeekOffset === 0 ? 'This Week' : `${dStart} - ${dEnd}`;
    }
    
    // Filter tasks within this date range using local ISO string format YYYY-MM-DD
    const startStr = `${start.getFullYear()}-${String(start.getMonth()+1).padStart(2,'0')}-${String(start.getDate()).padStart(2,'0')}`;
    const endStr = `${end.getFullYear()}-${String(end.getMonth()+1).padStart(2,'0')}-${String(end.getDate()).padStart(2,'0')}`;
    
    filteredTasks = filteredTasks.filter(t => t.date >= startStr && t.date <= endStr);
    
    // Sort chronologically
    filteredTasks.sort((a, b) => new Date(a.date) - new Date(b.date));
    
    if (filteredTasks.length === 0) {
        listBody.innerHTML = `<div class="empty-state">No upcoming tasks match your criteria.</div>`;
        return;
    }

    // Group by Date
    const grouped = {};
    filteredTasks.forEach(t => {
        if(!grouped[t.date]) grouped[t.date] = [];
        grouped[t.date].push(t);
    });

    for (const [dateStr, tasksForDate] of Object.entries(grouped)) {
        // Output date nicely
        const [y, m, d] = dateStr.split('-');
        const nicelyFormattedDate = new Date(parseInt(y), parseInt(m)-1, parseInt(d)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

        const dateGroupContainer = document.createElement('div');
        dateGroupContainer.className = 'list-date-group';
        dateGroupContainer.dataset.date = dateStr;
        
        const dateHeader = document.createElement('h3');
        dateHeader.className = 'list-date-header';
        dateHeader.innerHTML = `<i data-lucide="calendar-days"></i> ${nicelyFormattedDate}`;
        dateGroupContainer.appendChild(dateHeader);

        const tasksContainer = document.createElement('div');
        tasksContainer.className = 'list-date-tasks';

        const dues = tasksForDate.filter(t => t.type === 'due');
        const todos = tasksForDate.filter(t => t.type === 'todo');

        const createSection = (title, tasks) => {
            if (tasks.length === 0) return '';
            
            let html = `<div class="list-section">
                <h4 class="list-section-title">${title}</h4>
                <div class="list-section-items">`;
            
            tasks.forEach(task => {
                const subject = Store.getSubjectById(task.subject);
                const subjName = subject ? subject.name : 'Unknown';
                const subjColor = subject ? subject.color : '#ccc';

                const isCompleted = task.completed ? 'completed' : '';
                const isChecked = task.completed ? 'checked' : '';
                const priority = task.priority || 'normal';
                const priorityLabel = priority.charAt(0).toUpperCase() + priority.slice(1);
                const estimate = formatEstimate(task.estimate);
                const timeParts = [];
                if (task.startTime) timeParts.push(formatTime(task.startTime));
                if (task.deadlineTime) timeParts.push(`Due ${formatTime(task.deadlineTime)}`);
                const timeHtml = timeParts.length ? `<span class="meta-pill"><i data-lucide="clock"></i>${timeParts.join(' - ')}</span>` : '';
                const estimateHtml = estimate ? `<span class="meta-pill"><i data-lucide="timer"></i>${estimate}</span>` : '';
                const priorityHtml = `<span class="priority-pill ${priority}"><i data-lucide="flag"></i>${priorityLabel}</span>`;
                const descHtml = task.desc ? `<p class="list-item-desc">${task.desc}</p>` : '';

                html += `
                <div class="list-item compact clickable-item ${isCompleted}" draggable="true" data-id="${task.id}" title="Click to view/edit this task">
                    <div class="list-item-color" style="background-color: ${subjColor}"></div>
                    <div class="list-item-content">
                        <div class="list-item-title">
                            <span class="subject-label">${subjName}</span>
                            <span class="title-text">${task.title}</span>
                        </div>
                        <div class="list-item-meta">
                            <span class="meta-pill"><i data-lucide="${task.type === 'due' ? 'alarm-clock' : 'list-checks'}"></i>${task.type === 'due' ? 'Due' : 'To-do'}</span>
                            ${priorityHtml}
                            ${timeHtml}
                            ${estimateHtml}
                        </div>
                        ${descHtml}
                    </div>
                    <div class="list-item-actions">
                        <div class="checkbox-wrapper" title="Mark as completed">
                            <input type="checkbox" class="task-checkbox" data-id="${task.id}" ${isChecked}>
                        </div>
                    </div>
                </div>
                `;
            });
            
            html += `</div></div>`;
            return html;
        };

        tasksContainer.innerHTML = createSection('DUES:', dues) + createSection('TO-DOs', todos);
        
        dateGroupContainer.appendChild(tasksContainer);
        listBody.appendChild(dateGroupContainer);
    }
    
    lucide.createIcons();
}

// --- 5. Populating subjects ---
function populateSubjectDropdowns() {
    const taskSubSel = document.getElementById('task-subject');
    const filterSubSel = document.getElementById('filter-subject');
    
    // Maintain selected values
    const currTaskSubSel = taskSubSel.value;
    const currFilterSubSel = filterSubSel.value;
    
    // Clear existing
    taskSubSel.innerHTML = '<option value="" disabled selected>Select a subject...</option>';
    filterSubSel.innerHTML = '<option value="all">All Subjects</option>';
    
    Store.subjects.forEach(sub => {
        const tOp = document.createElement('option');
        tOp.value = sub.id;
        tOp.textContent = sub.name;
        taskSubSel.appendChild(tOp);
        
        const fOp = document.createElement('option');
        fOp.value = sub.id;
        fOp.textContent = sub.name;
        filterSubSel.appendChild(fOp);
    });
    
    if(currTaskSubSel) taskSubSel.value = currTaskSubSel;
    if(currFilterSubSel) filterSubSel.value = currFilterSubSel;
}

// --- 6. Modal Functions ---
function openDayModal(dateStr) {
    document.getElementById('task-date').value = dateStr;
    const [y, m, d] = dateStr.split('-');
    const nicelyFormattedDate = new Date(parseInt(y), parseInt(m)-1, parseInt(d)).toLocaleDateString('en-US', { weekday:'long', month: 'long', day: 'numeric', year: 'numeric' });
    document.getElementById('modal-date-title').textContent = nicelyFormattedDate;
    
    refreshDayTasksInModal(dateStr);
    resetTaskForm();
    
    document.getElementById('day-modal').classList.add('active');
    
    setTimeout(() => {
        const modalBody = document.querySelector('#day-modal .modal-body');
        if (modalBody) modalBody.scrollTop = 0;
    }, 10);
}

function refreshDayTasksInModal(dateStr) {
    const dayTasksList = document.getElementById('day-tasks-list');
    const tasksForDay = Store.tasks.filter(t => t.date === dateStr);
    const summary = document.getElementById('modal-day-summary');
    if (summary) {
        const openCount = tasksForDay.filter(t => !t.completed).length;
        const doneCount = tasksForDay.length - openCount;
        summary.textContent = tasksForDay.length
            ? `${openCount} open task${openCount === 1 ? '' : 's'}${doneCount ? ` • ${doneCount} done` : ''}`
            : 'No tasks scheduled yet';
    }
    
    dayTasksList.innerHTML = '';
    
    if (tasksForDay.length === 0) {
        dayTasksList.innerHTML = `<div class="empty-state">No tasks scheduled for this day</div>`;
        return;
    }
    
    tasksForDay.forEach(task => {
        const subject = Store.getSubjectById(task.subject);
        const sColor = subject ? subject.color : '#ccc';
        const typeCls = task.type === 'due' ? 'due' : 'todo';
        const isCompleted = task.completed ? 'completed' : '';
        const isChecked = task.completed ? 'checked' : '';
        
        let timeRangeHtml = '';
        if (task.startTime || task.deadlineTime) {
            const st = task.startTime ? formatTime(task.startTime) : '';
            const ed = task.deadlineTime ? formatTime(task.deadlineTime) : '';
            const timeText = (st && ed) ? `${st} - ${ed}` : (st || ed);
            timeRangeHtml = `<div class="modal-task-time"><i data-lucide="clock"></i> ${timeText}</div>`;
        }

        const descHtml = task.desc ? `<div class="modal-task-desc">${task.desc}</div>` : '';
        const estimate = formatEstimate(task.estimate);
        const estimateHtml = estimate ? `<span class="meta-pill"><i data-lucide="timer"></i>${estimate}</span>` : '';
        const priority = task.priority || 'normal';
        const priorityHtml = `<span class="priority-pill ${priority}"><i data-lucide="flag"></i>${priority}</span>`;

        const div = document.createElement('div');
        div.className = `modal-task-item ${typeCls} ${isCompleted}`;
        div.style.borderLeft = `6px solid ${sColor}`;
        div.innerHTML = `
            <div class="modal-task-content">
                <div class="modal-task-top">
                    <div>
                        <div class="modal-task-title" ${task.completed ? 'style="text-decoration: line-through;"' : ''}>${task.title}</div>
                        <div class="modal-task-subject" style="color: ${sColor};">${subject ? subject.name : ''}</div>
                    </div>
                    <div class="modal-task-actions">
                        <button class="icon-btn edit-btn" data-id="${task.id}" title="Edit task"><i data-lucide="edit-2"></i></button>
                        <button class="icon-btn delete-btn danger-text" data-id="${task.id}" title="Delete task"><i data-lucide="trash-2"></i></button>
                    </div>
                </div>
                <div class="list-item-meta">
                    <span class="meta-pill"><i data-lucide="${task.type === 'due' ? 'alarm-clock' : 'list-checks'}"></i>${task.type === 'due' ? 'Due' : 'To-do'}</span>
                    ${priorityHtml}
                    ${estimateHtml}
                </div>
                ${timeRangeHtml}
                ${descHtml}
                
                <div class="modal-task-footer">
                     <label class="radio-label">
                        <span>MARK AS DONE</span>
                        <input type="checkbox" class="task-checkbox calendar-modal-checkbox" data-id="${task.id}" ${isChecked}>
                     </label>
                </div>
            </div>
        `;
        dayTasksList.appendChild(div);
    });
    lucide.createIcons();
}

function closeDayModal() {
    document.getElementById('day-modal').classList.remove('active');
    resetTaskForm();
}

// Submit Task Form
function saveTaskFromForm() {
    const form = document.getElementById('task-form');
    
    // Basic validation
    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }
    
    const taskTitle = document.getElementById('task-title').value.trim();
    const taskSubj = document.getElementById('task-subject').value;
    
    if (!taskTitle || !taskSubj) {
        showToast('Please fill out required fields', 'error');
        if(!taskTitle) document.getElementById('task-title').classList.add('error');
        if(!taskSubj) document.getElementById('task-subject').classList.add('error');
        setTimeout(() => {
            document.getElementById('task-title').classList.remove('error');
            document.getElementById('task-subject').classList.remove('error');
        }, 2000);
        return;
    }

    const taskObj = {
        title: taskTitle,
        type: document.querySelector('input[name="task-type"]:checked').value,
        subject: taskSubj,
        date: document.getElementById('task-date').value,
        startTime: document.getElementById('task-start-time').value || null,
        deadlineTime: document.getElementById('task-deadline-time').value || null,
        priority: document.getElementById('task-priority').value || 'normal',
        estimate: document.getElementById('task-estimate').value || null,
        desc: document.getElementById('task-desc').value.trim()
    };
    
    if (editMode && currentTaskId) {
        const existingTask = Store.tasks.find(t => t.id === currentTaskId);
        taskObj.id = currentTaskId;
        taskObj.completed = existingTask ? !!existingTask.completed : false;
        Store.updateTask(taskObj);
        showToast('Task updated successfully', 'success');
    } else {
        Store.addTask(taskObj);
        showToast('Task added successfully', 'success');
    }
    
    // Ensure we refresh the correct day list
    selectedDateStr = document.getElementById('task-date').value;
    
    refreshDayTasksInModal(selectedDateStr);
    renderAll();
    resetTaskForm();
}

function resetTaskForm() {
    document.getElementById('task-form').reset();
    document.getElementById('task-id').value = '';
    document.getElementById('task-start-time').value = '';
    document.getElementById('task-deadline-time').value = '';
    document.getElementById('task-priority').value = 'normal';
    document.getElementById('task-estimate').value = '';
    document.getElementById('form-heading').textContent = 'Add New Task';
    
    if (selectedDateStr) {
        document.getElementById('task-date').value = selectedDateStr;
    } else {
        document.getElementById('task-date').value = toLocalDateString();
    }
    
    editMode = false;
    currentTaskId = null;
}

function editTask(id) {
    const task = Store.tasks.find(t => t.id === id);
    if (!task) return;
    
    editMode = true;
    currentTaskId = id;
    
    document.getElementById('form-heading').textContent = 'Edit Task';
    document.getElementById('task-id').value = task.id;
    document.getElementById('task-title').value = task.title;
    document.querySelector(`input[name="task-type"][value="${task.type}"]`).checked = true;
    document.getElementById('task-subject').value = task.subject;
    document.getElementById('task-date').value = task.date;
    document.getElementById('task-start-time').value = task.startTime || '';
    document.getElementById('task-deadline-time').value = task.deadlineTime || '';
    document.getElementById('task-priority').value = task.priority || 'normal';
    document.getElementById('task-estimate').value = task.estimate || '';
    document.getElementById('task-desc').value = task.desc || '';
    
    // Ensure form is scrolled into view in modal
    setTimeout(() => {
        const editor = document.querySelector('.task-editor-panel');
        if (editor) editor.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        document.getElementById('task-title').focus();
    }, 100);
}

function confirmDeleteTask(id) {
    taskToDelete = id;
    const task = Store.tasks.find(t => t.id === id);
    if(task) {
        document.getElementById('confirm-modal-title').textContent = 'Delete Task?';
        document.getElementById('confirm-modal-desc').innerHTML = `Are you sure you want to delete the task <strong>"${task.title}"</strong>? This action cannot be undone.`;
        document.getElementById('btn-confirm-delete').textContent = 'Delete Task';
    }
    document.getElementById('confirm-modal').classList.add('active');
}

function closeConfirmModal() {
    document.getElementById('confirm-modal').classList.remove('active');
    taskToDelete = null;
    subjectToDelete = null;
}

// Subject Modal
function openSubjectModal() {
    document.getElementById('subject-modal').classList.add('active');
    // Setup color hex display
    const colorInput = document.getElementById('new-subject-color');
    const hexDisp = document.getElementById('color-hex-display');
    
    // Avoid double event attaching by using input handler just once in init,
    // or replacing it cleanly here. Since it's light, we can do it via isolated handler setup:
    colorInput.oninput = (e) => {
        hexDisp.textContent = e.target.value;
    };
}

function closeSubjectModal() {
    document.getElementById('subject-modal').classList.remove('active');
    document.getElementById('subject-form').reset();
    document.getElementById('color-hex-display').textContent = '#3b82f6';
}

function saveNewSubject() {
    const nameInput = document.getElementById('new-subject-name');
    const name = nameInput.value.trim();
    const color = document.getElementById('new-subject-color').value;
    
    if (!name) {
        nameInput.classList.add('error');
        setTimeout(() => nameInput.classList.remove('error'), 2000);
        return;
    }
    
    const newSubj = Store.addSubject(name, color);
    
    populateSubjectDropdowns();
    // Auto-select the newly added subject in the active form
    document.getElementById('task-subject').value = newSubj.id;
    
    showToast('Subject added successfully', 'success');
    closeSubjectModal();
}

// --- 7. Toasts Engine ---
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = 'info';
    if(type === 'success') icon = 'check-circle';
    if(type === 'error') icon = 'alert-circle';

    toast.innerHTML = `<i data-lucide="${icon}"></i> <span>${message}</span>`;
    container.appendChild(toast);
    
    // We need to re-initialize uninitialized icons
    lucide.createIcons();

    setTimeout(() => {
        toast.classList.add('hiding');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// --- 8. Settings Modal ---
function openSettingsModal() {
    document.getElementById('settings-modal').classList.add('active');
    document.getElementById('setting-hide-completed').checked = Store.settings.hideCompleted;
    renderSettingsSubjects();
}

function closeSettingsModal() {
    document.getElementById('settings-modal').classList.remove('active');
}

function renderSettingsSubjects() {
    const list = document.getElementById('settings-subjects-list');
    list.innerHTML = '';
    
    if (Store.subjects.length === 0) {
        list.innerHTML = '<div style="color:var(--text-secondary); font-size: 0.9rem;">No subjects available.</div>';
        return;
    }
    
    Store.subjects.forEach(sub => {
        const item = document.createElement('div');
        item.style.display = 'flex';
        item.style.alignItems = 'center';
        item.style.justifyContent = 'space-between';
        item.style.padding = '0.5rem';
        item.style.background = 'rgba(255,255,255,0.05)';
        item.style.borderRadius = 'var(--radius-sm)';
        item.style.border = '1px solid var(--border-color)';
        
        item.innerHTML = `
            <div style="display:flex; align-items:center; gap: 0.75rem; flex: 1; margin-right: 1rem;">
                <input type="color" id="edit-color-${sub.id}" value="${sub.color}" disabled 
                    style="width: 24px; height: 24px; padding: 0; border: none; border-radius: 4px; background: transparent; cursor: pointer; flex-shrink: 0;" >
                <input type="text" id="edit-name-${sub.id}" class="subj-edit-input" value="${sub.name}" disabled>
            </div>
            <div style="display:flex; gap: 0.25rem;">
                <button class="icon-btn" id="btn-edit-${sub.id}" onclick="toggleSubjectEdit('${sub.id}')" title="Edit Subject">
                    <i data-lucide="edit-2" style="width:16px; height:16px;"></i>
                </button>
                <button class="icon-btn" id="btn-save-${sub.id}" onclick="saveSubjectEdits('${sub.id}')" title="Save Changes" style="display:none; color: var(--success);">
                    <i data-lucide="check" style="width:16px; height:16px;"></i>
                </button>
                <button class="icon-btn danger-text delete-subject-btn" data-id="${sub.id}" title="Delete Subject">
                    <i data-lucide="trash-2" style="width:16px; height:16px;"></i>
                </button>
            </div>
        `;
        list.appendChild(item);
    });
    
    lucide.createIcons();
}

window.toggleSubjectEdit = function(subId) {
    const nameInput = document.getElementById(`edit-name-${subId}`);
    const colorInput = document.getElementById(`edit-color-${subId}`);
    const editBtn = document.getElementById(`btn-edit-${subId}`);
    const saveBtn = document.getElementById(`btn-save-${subId}`);
    
    nameInput.disabled = false;
    colorInput.disabled = false;
    editBtn.style.display = 'none';
    saveBtn.style.display = 'flex';
    nameInput.focus();
};

window.saveSubjectEdits = function(subId) {
    const nameInput = document.getElementById(`edit-name-${subId}`);
    const colorInput = document.getElementById(`edit-color-${subId}`);
    
    const newName = nameInput.value.trim();
    const newColor = colorInput.value;
    
    if (!newName) {
        showToast('Subject name cannot be empty', 'error');
        return;
    }
    
    const subjectIndex = Store.subjects.findIndex(s => s.id === subId);
    if (subjectIndex !== -1) {
        Store.subjects[subjectIndex].name = newName;
        Store.subjects[subjectIndex].color = newColor;
        Store.saveSubjects();
        
        populateSubjectDropdowns();
        renderAll();
        showToast('Subject updated successfully', 'success');
        
        // Return UI to normal
        nameInput.disabled = true;
        colorInput.disabled = true;
        document.getElementById(`btn-save-${subId}`).style.display = 'none';
        document.getElementById(`btn-edit-${subId}`).style.display = 'flex';
    }
};

window.executeSubjectDeletion = function(subId) {
    // 1. Check if any tasks are currently using this subject
    const tasksUsingSubj = Store.tasks.filter(task => task.subject === subId);

    if (tasksUsingSubj.length > 0) {
        showToast(`Cannot delete: ${tasksUsingSubj.length} tasks are currently using this subject.`, 'error');
        return; // Stops the deletion
    }
    
    // 2. Remove the subject from local storage
    Store.subjects = Store.subjects.filter(s => s.id !== subId);
    Store.saveSubjects();
    
    // 3. Remove the subject from Google Sheets
    SheetsSync.post({ action: 'deleteSubject', subjectId: subId });
    
    // 4. Update the UI
    populateSubjectDropdowns();
    renderSettingsSubjects();
    renderAll();
    showToast('Subject deleted successfully', 'success');
};

function handleAddSubjectFromSettings(e) {
    e.preventDefault();
    const nameInput = document.getElementById('settings-new-subj-name');
    const colorInput = document.getElementById('settings-new-subj-color');
    
    const name = nameInput.value.trim();
    const color = colorInput.value;
    
    if (name) {
        Store.addSubject(name, color);
        populateSubjectDropdowns();
        renderSettingsSubjects();
        renderAll();
        
        // Reset form
        nameInput.value = '';
        colorInput.value = '#10b981'; // reset to default green
        showToast('Subject added successfully', 'success');
    }
}

// --- 5. PWA & Web Notifications Engine ---

const NotificationEngine = {
    async requestPermission() {
        if (!('Notification' in window)) {
            console.log('This browser does not support desktop notification');
            return false;
        }
        
        if (Notification.permission === 'granted') {
            return true;
        } else if (Notification.permission !== 'denied') {
            const permission = await Notification.requestPermission();
            return permission === 'granted';
        }
        return false;
    },

    async checkUpcomingTasksAndNotify() {
        const hasPermission = await this.requestPermission();
        if (!hasPermission) return;

        const today = new Date();
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
        const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth()+1).padStart(2,'0')}-${String(tomorrow.getDate()).padStart(2,'0')}`;

        // Get uncompleted tasks due today or tomorrow
        const upcomingTasks = Store.tasks.filter(t => !t.completed && (t.date === todayStr || t.date === tomorrowStr));
        
        // Group by date
        const dueToday = upcomingTasks.filter(t => t.date === todayStr);
        const dueTomorrow = upcomingTasks.filter(t => t.date === tomorrowStr);

        // Notify if there are tasks
        this.sendNotification(dueToday, dueTomorrow);
    },

    sendNotification(dueToday, dueTomorrow) {
        // To prevent spamming, we check if we already notified today
        const lastNotified = localStorage.getItem('last_notified_date');
        const todayStr = toLocalDateString();
        
        // Only notify once per day unless forced
        if (lastNotified === todayStr && (dueToday.length === 0 && dueTomorrow.length === 0)) {
            return;
        }

        if (dueToday.length > 0 || dueTomorrow.length > 0) {
            let body = '';
            if (dueToday.length > 0) body += `You have ${dueToday.length} task(s) due TODAY.\n`;
            if (dueTomorrow.length > 0) body += `You have ${dueTomorrow.length} task(s) due TOMORROW.\n`;
            body += 'Open UCANDOIT to review them.';

            if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
                // Use service worker to show a proper persistent notification
                navigator.serviceWorker.controller.postMessage({
                    type: 'SHOW_NOTIFICATION',
                    title: '⚠️ Upcoming Academic Tasks',
                    options: {
                        body: body,
                        icon: 'icons/icon-192.png',
                        badge: 'icons/icon-192.png',
                        vibrate: [200, 100, 200]
                    }
                });
            } else {
                new Notification('⚠️ Upcoming Academic Tasks', {
                    body: body,
                    icon: 'icons/icon-192.png'
                });
            }
            
            localStorage.setItem('last_notified_date', todayStr);
        }
    }
};

// Register Service Worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').then(registration => {
            console.log('SW registered: ', registration.scope);
            // Run notification check shortly after load
            setTimeout(() => {
                NotificationEngine.checkUpcomingTasksAndNotify();
            }, 3000);
        }).catch(registrationError => {
            console.log('SW registration failed: ', registrationError);
        });
    });
} else {
    // Run notification check anyway if SW is not supported but Notifications API is
    setTimeout(() => {
        NotificationEngine.checkUpcomingTasksAndNotify();
    }, 3000);
}
