let currentUser = null;
let editingBugId = null;
let newBugFiles = [];
let newCommentFiles = [];

// ── Init ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('login-form').addEventListener('submit', login);
  const me = await api('/api/me').catch(() => null);
  if (me && me.id) setUser(me);
  else showScreen('login');
});

// ── Auth ──────────────────────────────────────────────────────────────────
async function login(e) {
  e.preventDefault();
  const err = document.getElementById('login-error');
  err.classList.add('hidden');
  try {
    const user = await api('/api/login', 'POST', {
      username: document.getElementById('login-username').value,
      password: document.getElementById('login-password').value
    });
    setUser(user);
  } catch (ex) {
    err.textContent = ex.message || 'שגיאת התחברות';
    err.classList.remove('hidden');
  }
}

async function logout() {
  await api('/api/logout', 'POST');
  currentUser = null;
  showScreen('login');
}

function setUser(user) {
  currentUser = user;
  document.getElementById('nav-username').textContent = user.username;
  const rb = document.getElementById('nav-role');
  rb.textContent = user.role === 'admin' ? 'מנהל' : 'משתמש';
  rb.className = `role-badge role-${user.role}`;
  if (user.role === 'admin') document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
  showScreen('app');
  showPage('bugs');
}

// ── Navigation ────────────────────────────────────────────────────────────
function showScreen(name) {
  document.getElementById('login-screen').classList.toggle('hidden', name !== 'login');
  document.getElementById('app-screen').classList.toggle('hidden', name !== 'app');
}

function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.page === name));
  document.getElementById(`page-${name}`).classList.remove('hidden');
  if (name === 'bugs') loadBugs();
  if (name === 'stats') loadStats();
  if (name === 'users') loadUsers();
}

// ── Bugs List ─────────────────────────────────────────────────────────────
async function loadBugs() {
  const params = new URLSearchParams({
    status: document.getElementById('filter-status').value,
    priority: document.getElementById('filter-priority').value,
    device_type: document.getElementById('filter-device').value,
    search: document.getElementById('filter-search').value
  });
  const bugs = await api(`/api/bugs?${params}`);
  const container = document.getElementById('bugs-list');

  if (!bugs.length) {
    container.innerHTML = `<div class="empty-state"><div class="icon">🎉</div><h3>אין באגים!</h3><p>לא נמצאו באגים עם הסינון הנוכחי</p></div>`;
    return;
  }

  container.innerHTML = bugs.map(bug => `
    <div class="bug-card priority-${bug.priority}" onclick="openBugDetail(${bug.id})">
      <div class="bug-card-header">
        <span class="bug-card-title">${esc(bug.title)}</span>
        <span class="bug-id">#${bug.id}</span>
      </div>
      <div class="bug-card-meta">
        <span class="badge status-${bug.status}">${bug.status}</span>
        <span class="badge priority-${bug.priority}">${bug.priority}</span>
        ${bug.device_type ? `<span class="badge" style="background:var(--gray-100);color:var(--gray-600)">📱 ${esc(bug.device_type)}</span>` : ''}
        ${bug.assignee ? `<span class="badge" style="background:#f0fdf4;color:#166534">👤 ${esc(bug.assignee)}</span>` : ''}
      </div>
      ${bug.description ? `<div style="color:var(--gray-500);font-size:.85rem;margin-bottom:4px">${esc(bug.description).substring(0,120)}${bug.description.length > 120 ? '...' : ''}</div>` : ''}
      <div class="bug-card-footer">
        <span>🕐 ${formatDate(bug.created_at)}</span>
        <span>👤 ${esc(bug.reporter_name || 'לא ידוע')}</span>
        ${bug.comment_count ? `<span>💬 ${bug.comment_count}</span>` : ''}
        ${bug.attachment_count ? `<span>📎 ${bug.attachment_count}</span>` : ''}
      </div>
    </div>
  `).join('');
}

// ── Bug Detail ─────────────────────────────────────────────────────────────
async function openBugDetail(id) {
  const bug = await api(`/api/bugs/${id}`);
  const modal = document.getElementById('detail-modal');
  document.getElementById('detail-modal-title').textContent = `#${bug.id} — ${bug.title}`;

  const canDelete = currentUser.role === 'admin';

  document.getElementById('detail-modal-body').innerHTML = `
    <div class="detail-grid">
      <div class="detail-main">
        <div class="detail-desc">${bug.description ? esc(bug.description) : '<em style="color:var(--gray-400)">אין תיאור</em>'}</div>

        ${bug.attachments.filter(a => !a.comment_id).length > 0 ? `
          <div style="margin-bottom:16px">
            <div class="detail-meta-label">קבצים מצורפים</div>
            <div class="attachment-grid">${renderAttachments(bug.attachments.filter(a => !a.comment_id))}</div>
          </div>
        ` : ''}

        <div class="comments-section">
          <h4>💬 תגובות (${bug.comments.length})</h4>
          <div id="comments-container">
            ${bug.comments.length ? bug.comments.map(c => renderComment(c)).join('') : '<p style="color:var(--gray-400);font-size:.9rem">אין תגובות עדיין</p>'}
          </div>
          <div class="comment-form">
            <div class="form-group">
              <textarea id="comment-text" placeholder="הוסף תגובה..." rows="3"></textarea>
            </div>
            <div class="form-group">
              <div class="upload-zone" onclick="document.getElementById('comment-files').click()">
                <div class="upload-zone-icon">📎</div>
                <div class="upload-zone-text">לחץ לצירוף קבצים, תמונות או וידאו</div>
                <input type="file" id="comment-files" multiple accept="image/*,video/*,.pdf,.doc,.docx,.txt,.zip" onchange="previewCommentFiles(event)">
              </div>
              <div id="comment-files-preview" class="preview-list"></div>
            </div>
            <button class="btn btn-primary" onclick="addComment(${bug.id})">שלח תגובה</button>
          </div>
        </div>
      </div>

      <div class="detail-sidebar">
        <div class="detail-meta-item">
          <div class="detail-meta-label">סטטוס</div>
          <select id="edit-status" class="form-control" onchange="quickUpdate(${bug.id})" style="padding:6px 10px;border:1px solid var(--gray-200);border-radius:var(--radius);font-family:inherit;width:100%">
            ${['פתוח','בטיפול','בבדיקה','נפתר','סגור'].map(s => `<option ${bug.status===s?'selected':''}>${s}</option>`).join('')}
          </select>
        </div>
        <div class="detail-meta-item">
          <div class="detail-meta-label">עדיפות</div>
          <select id="edit-priority" onchange="quickUpdate(${bug.id})" style="padding:6px 10px;border:1px solid var(--gray-200);border-radius:var(--radius);font-family:inherit;width:100%">
            ${['קריטי','גבוה','בינוני','נמוך'].map(p => `<option ${bug.priority===p?'selected':''}>${p}</option>`).join('')}
          </select>
        </div>
        <div class="detail-meta-item">
          <div class="detail-meta-label">סוג מכשיר</div>
          <div class="detail-meta-value">${bug.device_type ? esc(bug.device_type) : '—'}</div>
        </div>
        <div class="detail-meta-item">
          <div class="detail-meta-label">אחראי</div>
          <div class="detail-meta-value">${bug.assignee ? esc(bug.assignee) : '—'}</div>
        </div>
        <div class="detail-meta-item">
          <div class="detail-meta-label">דווח על ידי</div>
          <div class="detail-meta-value">${esc(bug.reporter_name || '—')}</div>
        </div>
        <div class="detail-meta-item">
          <div class="detail-meta-label">תאריך דיווח</div>
          <div class="detail-meta-value">${formatDate(bug.created_at)}</div>
        </div>
        <div class="detail-meta-item">
          <div class="detail-meta-label">עדכון אחרון</div>
          <div class="detail-meta-value">${formatDate(bug.updated_at)}</div>
        </div>
        <div style="margin-top:20px;display:flex;flex-direction:column;gap:8px">
          <button class="btn btn-outline" onclick="openEditBugModal(${bug.id})">✏️ ערוך באג</button>
          ${canDelete ? `<button class="btn btn-danger" onclick="deleteBug(${bug.id})">🗑️ מחק באג</button>` : ''}
        </div>
      </div>
    </div>
  `;

  newCommentFiles = [];
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function renderComment(c) {
  const canDelete = currentUser.role === 'admin' || currentUser.id === c.user_id;
  return `
    <div class="comment-item" id="comment-${c.id}">
      <div class="comment-header">
        <span class="comment-author">👤 ${esc(c.username)}</span>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="comment-date">${formatDate(c.created_at)}</span>
          ${canDelete ? `<button class="btn-icon" onclick="deleteComment(${c.id})" title="מחק תגובה">🗑️</button>` : ''}
        </div>
      </div>
      ${c.content ? `<div class="comment-content">${esc(c.content)}</div>` : ''}
      ${c.attachments && c.attachments.length ? `<div class="attachment-grid" style="margin-top:8px">${renderAttachments(c.attachments)}</div>` : ''}
    </div>
  `;
}

function renderAttachments(atts) {
  return atts.map(a => {
    if (a.file_type === 'image') {
      return `<div class="attachment-item" onclick="openLightbox('/uploads/${a.filename}','image')"><img src="/uploads/${a.filename}" alt="${esc(a.original_name)}" loading="lazy"></div>`;
    } else if (a.file_type === 'video') {
      return `<div class="attachment-item" onclick="openLightbox('/uploads/${a.filename}','video')"><video src="/uploads/${a.filename}" muted></video></div>`;
    } else {
      return `<a class="attachment-item attachment-file" href="/uploads/${a.filename}" download="${esc(a.original_name)}" onclick="event.stopPropagation()">📄<br>${esc(a.original_name).substring(0,20)}</a>`;
    }
  }).join('');
}

async function quickUpdate(bugId) {
  const bug = await api(`/api/bugs/${bugId}`);
  await api(`/api/bugs/${bugId}`, 'PUT', {
    ...bug,
    status: document.getElementById('edit-status').value,
    priority: document.getElementById('edit-priority').value
  });
}

async function addComment(bugId) {
  const text = document.getElementById('comment-text').value;
  if (!text.trim() && newCommentFiles.length === 0) return;

  const sendBtn = document.querySelector('.comment-form .btn-primary');
  if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = 'שולח...'; }

  try {
    const fd = new FormData();
    fd.append('content', text);
    newCommentFiles.forEach(f => fd.append('attachments', f));

    const comment = await apiFd(`/api/bugs/${bugId}/comments`, fd);
    newCommentFiles = [];
    document.getElementById('comment-text').value = '';
    document.getElementById('comment-files-preview').innerHTML = '';

    const container = document.getElementById('comments-container');
    if (container.querySelector('p')) container.innerHTML = '';
    container.insertAdjacentHTML('beforeend', renderComment(comment));
  } catch (ex) {
    alert('שגיאה בשליחת תגובה: ' + (ex.message || 'נסה שוב'));
  } finally {
    if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = 'שלח תגובה'; }
  }
}

async function deleteComment(commentId) {
  if (!confirm('למחוק את התגובה?')) return;
  await api(`/api/comments/${commentId}`, 'DELETE');
  document.getElementById(`comment-${commentId}`)?.remove();
}

function closeDetailModal() {
  document.getElementById('detail-modal').classList.add('hidden');
  document.body.style.overflow = '';
  newCommentFiles = [];
  loadBugs();
}

// ── New/Edit Bug Modal ────────────────────────────────────────────────────
function openNewBugModal() {
  editingBugId = null;
  newBugFiles = [];
  document.getElementById('bug-modal-title').textContent = 'דיווח באג חדש';
  document.getElementById('bug-modal-body').innerHTML = bugFormHTML({});
  document.getElementById('bug-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

async function openEditBugModal(id) {
  const bug = await api(`/api/bugs/${id}`);
  editingBugId = id;
  newBugFiles = [];
  document.getElementById('bug-modal-title').textContent = `עריכת באג #${id}`;
  document.getElementById('bug-modal-body').innerHTML = bugFormHTML(bug);
  document.getElementById('bug-modal').classList.remove('hidden');
}

function bugFormHTML(bug) {
  return `
    <div class="modal-body">
      <div id="bug-error" class="error-msg hidden"></div>
      <div class="form-group">
        <label>כותרת *</label>
        <input type="text" id="f-title" value="${esc(bug.title||'')}" placeholder="תאר בקצרה את הבאג">
      </div>
      <div class="form-group">
        <label>תיאור מפורט</label>
        <textarea id="f-desc" rows="4" placeholder="תאר את הבאג, צעדים לשחזור, התנהגות צפויה...">${esc(bug.description||'')}</textarea>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>סטטוס</label>
          <select id="f-status">
            ${['פתוח','בטיפול','בבדיקה','נפתר','סגור'].map(s => `<option ${bug.status===s?'selected':''}>${s}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>עדיפות</label>
          <select id="f-priority">
            ${['קריטי','גבוה','בינוני','נמוך'].map(p => `<option ${bug.priority===p?'selected':''}>${p}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>סוג מכשיר</label>
          <select id="f-device">
            <option value="">בחר...</option>
            ${['דסקטופ','מובייל','טאבלט','ווב','אחר'].map(d => `<option ${bug.device_type===d?'selected':''}>${d}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>אחראי</label>
          <input type="text" id="f-assignee" value="${esc(bug.assignee||'')}" placeholder="שם האחראי">
        </div>
      </div>
      <div class="form-group">
        <label>קבצים מצורפים (תמונות, וידאו, קבצים)</label>
        <div class="upload-zone" onclick="document.getElementById('bug-files').click()">
          <div class="upload-zone-icon">📎</div>
          <div class="upload-zone-text">לחץ לבחירת קבצים</div>
          <input type="file" id="bug-files" multiple accept="image/*,video/*,.pdf,.doc,.docx,.txt,.zip" onchange="previewBugFiles(event)">
        </div>
        <div id="bug-files-preview" class="preview-list"></div>
      </div>
      <div class="form-actions">
        <button type="button" id="save-bug-btn" class="btn btn-primary" onclick="saveBug(this)">💾 שמור</button>
        <button type="button" class="btn btn-outline" onclick="closeBugModal()">ביטול</button>
      </div>
    </div>
  `;
}

async function saveBug(btn) {
  const titleEl = document.getElementById('f-title');
  const err = document.getElementById('bug-error');

  if (!titleEl) { console.error('f-title not found'); return; }

  const title = titleEl.value.trim();
  if (!title) {
    err.textContent = 'כותרת נדרשת';
    err.classList.remove('hidden');
    titleEl.focus();
    return;
  }
  err.classList.add('hidden');

  // Disable button to prevent double-submit
  if (btn) { btn.disabled = true; btn.textContent = 'שומר...'; }

  try {
    const fd = new FormData();
    fd.append('title', title);
    fd.append('description', document.getElementById('f-desc').value);
    fd.append('status', document.getElementById('f-status').value);
    fd.append('priority', document.getElementById('f-priority').value);
    fd.append('device_type', document.getElementById('f-device').value);
    fd.append('assignee', document.getElementById('f-assignee').value);
    newBugFiles.forEach(f => fd.append('attachments', f));

    if (editingBugId) {
      await api(`/api/bugs/${editingBugId}`, 'PUT', {
        title,
        description: document.getElementById('f-desc').value,
        status: document.getElementById('f-status').value,
        priority: document.getElementById('f-priority').value,
        device_type: document.getElementById('f-device').value,
        assignee: document.getElementById('f-assignee').value
      });
    } else {
      await apiFd('/api/bugs', fd);
    }

    closeBugModal();
    await loadBugs();
  } catch (ex) {
    console.error('saveBug error:', ex);
    const msg = ex instanceof Error ? ex.message
      : typeof ex === 'string' ? ex
      : JSON.stringify(ex);
    err.textContent = msg || 'שגיאה בשמירה — נסה שוב';
    err.classList.remove('hidden');
    if (btn) { btn.disabled = false; btn.innerHTML = '💾 שמור'; }
  }
}

async function deleteBug(id) {
  if (!confirm('למחוק את הבאג? פעולה זו אינה הפיכה.')) return;
  await api(`/api/bugs/${id}`, 'DELETE');
  closeDetailModal();
}

function closeBugModal() {
  document.getElementById('bug-modal').classList.add('hidden');
  document.body.style.overflow = '';
  newBugFiles = [];
}

// ── File Previews ─────────────────────────────────────────────────────────
function previewBugFiles(e) {
  newBugFiles = [...newBugFiles, ...e.target.files];
  renderFilePreviews(newBugFiles, 'bug-files-preview', 'bug');
}

function previewCommentFiles(e) {
  newCommentFiles = [...newCommentFiles, ...e.target.files];
  renderFilePreviews(newCommentFiles, 'comment-files-preview', 'comment');
}

function renderFilePreviews(files, containerId, prefix) {
  const container = document.getElementById(containerId);
  container.innerHTML = files.map((f, i) => {
    if (f.type.startsWith('image/')) {
      const url = URL.createObjectURL(f);
      return `<div class="preview-item"><img src="${url}" alt="${esc(f.name)}"><button class="preview-remove" onclick="removeFile('${prefix}',${i})">✕</button></div>`;
    } else if (f.type.startsWith('video/')) {
      const url = URL.createObjectURL(f);
      return `<div class="preview-item"><video src="${url}" muted></video><button class="preview-remove" onclick="removeFile('${prefix}',${i})">✕</button></div>`;
    } else {
      return `<div class="preview-item"><div class="file-preview">📄 ${esc(f.name).substring(0,15)}</div><button class="preview-remove" onclick="removeFile('${prefix}',${i})">✕</button></div>`;
    }
  }).join('');
}

function removeFile(prefix, idx) {
  if (prefix === 'bug') { newBugFiles.splice(idx, 1); renderFilePreviews(newBugFiles, 'bug-files-preview', 'bug'); }
  else { newCommentFiles.splice(idx, 1); renderFilePreviews(newCommentFiles, 'comment-files-preview', 'comment'); }
}

// ── Stats ─────────────────────────────────────────────────────────────────
async function loadStats() {
  const stats = await api('/api/stats');
  const statusColors = { 'פתוח':'#1d4ed8','בטיפול':'#d97706','בבדיקה':'#4338ca','נפתר':'#16a34a','סגור':'#9ca3af' };
  const priorityColors = { 'קריטי':'#dc2626','גבוה':'#ea580c','בינוני':'#d97706','נמוך':'#16a34a' };

  const maxStatus = Math.max(...stats.byStatus.map(s => s.c), 1);
  const maxPriority = Math.max(...stats.byPriority.map(s => s.c), 1);

  document.getElementById('stats-content').innerHTML = `
    <div class="stat-card">
      <h3>סה"כ באגים</h3>
      <div class="stat-total">${stats.total}</div>
      <div class="stat-label">דיווחים במערכת</div>
    </div>
    <div class="stat-card">
      <h3>לפי סטטוס</h3>
      ${stats.byStatus.map(s => `
        <div class="stat-bar-item">
          <span class="stat-bar-label">${s.status}</span>
          <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${(s.c/maxStatus*100).toFixed(0)}%;background:${statusColors[s.status]||'#6b7280'}"></div></div>
          <span class="stat-bar-count">${s.c}</span>
        </div>
      `).join('')}
    </div>
    <div class="stat-card">
      <h3>לפי עדיפות</h3>
      ${stats.byPriority.map(p => `
        <div class="stat-bar-item">
          <span class="stat-bar-label">${p.priority}</span>
          <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${(p.c/maxPriority*100).toFixed(0)}%;background:${priorityColors[p.priority]||'#6b7280'}"></div></div>
          <span class="stat-bar-count">${p.c}</span>
        </div>
      `).join('')}
    </div>
  `;
}

// ── Users ─────────────────────────────────────────────────────────────────
async function loadUsers() {
  const users = await api('/api/users');
  document.getElementById('users-list').innerHTML = `
    <div class="users-table">
      <table>
        <thead><tr><th>שם משתמש</th><th>תפקיד</th><th>תאריך הצטרפות</th><th>פעולות</th></tr></thead>
        <tbody>
          ${users.map(u => `
            <tr>
              <td>${esc(u.username)}</td>
              <td><span class="role-badge role-${u.role}">${u.role === 'admin' ? 'מנהל' : 'משתמש'}</span></td>
              <td>${formatDate(u.created_at)}</td>
              <td>${u.id !== currentUser.id ? `<button class="btn btn-danger btn-sm" onclick="deleteUser(${u.id},'${esc(u.username)}')">מחק</button>` : '<span style="color:var(--gray-400)">אתה</span>'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function openNewUserModal() {
  document.getElementById('user-error').classList.add('hidden');
  document.getElementById('new-username').value = '';
  document.getElementById('new-password').value = '';
  document.getElementById('new-role').value = 'user';
  document.getElementById('user-modal').classList.remove('hidden');
}

function closeUserModal() {
  document.getElementById('user-modal').classList.add('hidden');
}

async function createUser(e) {
  e.preventDefault();
  const err = document.getElementById('user-error');
  err.classList.add('hidden');
  try {
    await api('/api/users', 'POST', {
      username: document.getElementById('new-username').value,
      password: document.getElementById('new-password').value,
      role: document.getElementById('new-role').value
    });
    closeUserModal();
    loadUsers();
  } catch (ex) {
    err.textContent = ex.message || 'שגיאה ביצירת משתמש';
    err.classList.remove('hidden');
  }
}

async function deleteUser(id, name) {
  if (!confirm(`למחוק את המשתמש "${name}"?`)) return;
  await api(`/api/users/${id}`, 'DELETE');
  loadUsers();
}

// ── Lightbox ──────────────────────────────────────────────────────────────
function openLightbox(src, type) {
  const lb = document.createElement('div');
  lb.id = 'lightbox';
  lb.innerHTML = `
    <button id="lightbox-close" onclick="document.getElementById('lightbox').remove()">✕</button>
    ${type === 'image' ? `<img src="${src}">` : `<video src="${src}" controls autoplay></video>`}
  `;
  lb.addEventListener('click', e => { if (e.target === lb) lb.remove(); });
  document.body.appendChild(lb);
}

// ── Utils ─────────────────────────────────────────────────────────────────
function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('he-IL', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

async function api(url, method = 'GET', body) {
  const opts = { method, headers: {} };
  if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const r = await fetch(url, opts);
  let data;
  try { data = await r.json(); } catch { throw new Error(`שגיאת שרת (${r.status})`); }
  if (!r.ok) throw new Error(data.error || `שגיאה (${r.status})`);
  return data;
}

async function apiFd(url, formData) {
  let r;
  try {
    r = await fetch(url, { method: 'POST', body: formData });
  } catch (networkErr) {
    throw new Error('שגיאת רשת — בדוק את החיבור לשרת');
  }
  let data;
  try { data = await r.json(); } catch { throw new Error(`שגיאת שרת (${r.status}) — ייתכן שהקובץ גדול מדי`); }
  if (!r.ok) {
    const raw = data?.error;
    const msg = typeof raw === 'string' ? raw : raw ? JSON.stringify(raw) : `שגיאה (${r.status})`;
    throw new Error(msg);
  }
  return data;
}
