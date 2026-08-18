// public/js/chat.js — shared client for both the user support widget and the
// admin/owner inbox. Talks to the WebSocket at /ws/chat with a REST fallback
// for initial history (server/routes/chat.js + server/ws.js).
(function () {
  const cfg = window.WGC_CHAT;
  const isStaff = cfg.isStaff;
  let currentUserId = cfg.watchUserId;

  const messagesEl = document.getElementById('chatMessages');
  const formEl = document.getElementById('chatForm');
  const inputEl = document.getElementById('chatInput');
  const threadsEl = document.getElementById('chatThreads');
  const fileInputEl = document.getElementById('chatFileInput');
  const attachBtnEl = document.getElementById('chatAttachBtn');
  const pendingImageEl = document.getElementById('chatPendingImage');

  let pendingImagePath = null;

  // --------------------------------------------------- connection status
  // Sends used to fail completely silently if the socket wasn't OPEN yet
  // (page just loaded) or had dropped and was mid-reconnect — the message
  // just vanished with no feedback, which is exactly what looked like a
  // "chat leads nowhere" bug. Now the form is locked with a visible reason
  // whenever it isn't actually safe to send.
  const statusEl = document.createElement('div');
  statusEl.id = 'chatConnStatus';
  statusEl.className = 'hint';
  statusEl.style.cssText = 'margin:0 0 8px;';
  formEl.parentNode.insertBefore(statusEl, formEl);
  function setConnected(isOpen) {
    const gateDisabled = inputEl.dataset.gateDisabled === '1'; // player hasn't set an Admin ID yet
    inputEl.disabled = !isOpen || gateDisabled;
    formEl.querySelector('button[type=submit]').disabled = !isOpen || gateDisabled;
    if (attachBtnEl) attachBtnEl.disabled = !isOpen || gateDisabled;
    statusEl.textContent = isOpen ? '' : 'Connecting…';
    statusEl.style.color = isOpen ? '' : 'var(--dim)';
  }
  // Remember whether the player-ID gate itself has the input disabled, so
  // reconnect logic doesn't accidentally re-enable a form that's supposed
  // to stay locked until an Admin ID is set.
  inputEl.dataset.gateDisabled = inputEl.disabled ? '1' : '0';
  setConnected(false);

  function bubble(m) {
    const mine = isStaff ? m.sender_role === 'admin' : m.sender_role === 'user';
    const div = document.createElement('div');
    div.className = 'chat-bubble ' + (mine ? 'mine' : 'theirs');
    // Show exactly who sent it — a staff member's Staff ID + name, or the
    // player's display name — never a generic "Support" label.
    const who = m.sender_role === 'admin'
      ? (m.sender_staff_id ? `${m.sender_staff_id} · ${escapeHtml(m.sender_display_name || '')}` : escapeHtml(m.sender_display_name || 'Support'))
      : escapeHtml(m.sender_display_name || 'Player');
    let html = '';
    if (m.image_path) html += `<a href="${m.image_path}" target="_blank" rel="noopener"><img src="${m.image_path}" class="chat-image" alt="Attached screenshot"></a>`;
    if (m.body) html += `<div>${escapeHtml(m.body)}</div>`;
    html += `<span class="meta">${mine ? 'You' : who} · ${new Date(m.ts).toLocaleTimeString()}</span>`;
    div.innerHTML = html;
    return div;
  }
  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  async function loadHistory(userId) {
    const res = await fetch(`/api/chat/${userId || ''}`);
    if (!res.ok) return;
    const { messages } = await res.json();
    messagesEl.innerHTML = '';
    messages.forEach((m) => messagesEl.appendChild(bubble(m)));
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  async function loadThreads() {
    if (!threadsEl) return;
    const res = await fetch('/api/chat');
    if (!res.ok) return;
    const { threads } = await res.json();
    threadsEl.innerHTML = '';
    if (threads.length === 0) {
      threadsEl.innerHTML = '<div class="chat-thread-item" style="color:var(--dim);cursor:default;">No conversations yet.</div>';
      return;
    }
    threads.forEach((t) => {
      const div = document.createElement('div');
      div.className = 'chat-thread-item' + (t.user_id === currentUserId ? ' active' : '');
      div.innerHTML = `<div class="name">${escapeHtml(t.display_name)}${t.unread > 0 ? `<span class="unread">${t.unread}</span>` : ''}</div>
        <div style="color:var(--dim);font-size:12px;">${escapeHtml(t.email)}</div>`;
      div.addEventListener('click', () => watchUser(t.user_id));
      threadsEl.appendChild(div);
    });
  }

  let ws;
  function connect() {
    setConnected(false);
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}/ws/chat`);
    ws.addEventListener('open', () => {
      if (isStaff && currentUserId) ws.send(JSON.stringify({ type: 'watch', userId: currentUserId }));
      setConnected(true);
    });
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'message' && (msg.message.user_id === currentUserId)) {
        messagesEl.appendChild(bubble(msg.message));
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }
      if (msg.type === 'inbox_update' && isStaff) loadThreads();
      if (msg.type === 'error') showChatError(msg.message);
    });
    ws.addEventListener('close', () => { setConnected(false); setTimeout(connect, 2000); });
  }

  function showChatError(text) {
    const p = document.createElement('p');
    p.style.color = 'var(--danger)';
    p.textContent = text;
    messagesEl.appendChild(p);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function watchUser(userId) {
    currentUserId = userId;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'watch', userId }));
    loadHistory(userId);
    loadThreads();
  }
  window.WGC_watchUser = watchUser; // used by admin/chat.ejs's initial-thread bootstrap

  // --------------------------------------------------- image attachments
  async function uploadImage(file) {
    if (!pendingImageEl) return; // page doesn't support attachments
    pendingImageEl.innerHTML = '<span class="hint">Uploading…</span>';
    pendingImageEl.classList.remove('hidden');
    const body = new FormData();
    body.append('image', file);
    try {
      const res = await fetch('/api/chat/upload', { method: 'POST', body });
      const data = await res.json();
      if (!res.ok) { pendingImageEl.innerHTML = `<span style="color:var(--danger);">${escapeHtml(data.error || 'Upload failed.')}</span>`; return; }
      pendingImagePath = data.path;
      pendingImageEl.innerHTML = `<img src="${data.path}" alt=""><button type="button" id="chatPendingRemove" title="Remove">&times;</button>`;
      document.getElementById('chatPendingRemove').addEventListener('click', clearPendingImage);
    } catch {
      pendingImageEl.innerHTML = '<span style="color:var(--danger);">Upload failed — check your connection.</span>';
    }
  }
  function clearPendingImage() {
    pendingImagePath = null;
    pendingImageEl.innerHTML = '';
    pendingImageEl.classList.add('hidden');
    if (fileInputEl) fileInputEl.value = '';
  }
  attachBtnEl?.addEventListener('click', () => fileInputEl?.click());
  fileInputEl?.addEventListener('change', () => { if (fileInputEl.files[0]) uploadImage(fileInputEl.files[0]); });
  // Paste a screenshot straight from the clipboard (Win+Shift+S / Cmd+Shift+4
  // then Ctrl/Cmd+V) directly into the message box.
  inputEl?.addEventListener('paste', (e) => {
    const item = [...(e.clipboardData?.items || [])].find((it) => it.type.startsWith('image/'));
    if (!item) return;
    e.preventDefault();
    const file = item.getAsFile();
    if (file) uploadImage(file);
  });

  formEl.addEventListener('submit', (e) => {
    e.preventDefault();
    const body = inputEl.value.trim();
    if (!body && !pendingImagePath) return;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      // Previously this just silently returned — the message vanished with
      // no feedback and nothing to explain why. Now it's visible and kept
      // in the box so nothing typed is lost.
      showChatError('Not connected yet — hang on a second and try again.');
      return;
    }
    ws.send(JSON.stringify({ type: 'send', body, imagePath: pendingImagePath, asSelf: cfg.asSelf === true }));
    inputEl.value = '';
    clearPendingImage();
  });

  // ------------------------------------------------------- admin-ID gate
  // Only present on the player-facing chat page (chat.ejs) for self-signed-up
  // players who haven't been assigned a staff member yet.
  const staffIdInput = document.getElementById('staffIdInput');
  const staffIdSubmit = document.getElementById('staffIdSubmit');
  const assignBar = document.getElementById('assignBar');
  const assignedNotice = document.getElementById('assignedNotice');
  const assignError = document.getElementById('assignError');
  const changeRouting = document.getElementById('changeRouting');

  async function submitStaffId() {
    const staffId = (staffIdInput.value || '').trim();
    if (!staffId) return;
    assignError.style.display = 'none';
    const res = await fetch('/api/chat/assign', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ staffId }),
    });
    const data = await res.json();
    if (!res.ok) { assignError.textContent = data.error || 'Could not connect to that Admin ID.'; assignError.style.display = 'block'; return; }
    assignBar.style.display = 'none';
    assignedNotice.style.display = 'block';
    document.getElementById('assignedStaffIdText').textContent = data.staffId;
    inputEl.dataset.gateDisabled = '0';
    setConnected(!!ws && ws.readyState === WebSocket.OPEN);
  }
  staffIdSubmit?.addEventListener('click', submitStaffId);
  staffIdInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submitStaffId(); } });
  changeRouting?.addEventListener('click', (e) => { e.preventDefault(); assignedNotice.style.display = 'none'; assignBar.style.display = 'block'; });

  if (currentUserId) loadHistory(currentUserId);
  if (isStaff) loadThreads();
  connect();
})();
