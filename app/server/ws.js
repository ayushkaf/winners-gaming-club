// server/ws.js — live support chat over a plain WebSocket, generalized
// across the whole staff hierarchy (see server/routes/chat.js's MANAGES map
// for the full explanation): user->admin->developer->owner, each tier
// talking to whoever manages them and reading replies from their own thread.
//
// Rooms are keyed by the user_id (really: "whose thread") a message belongs
// to. Every socket always joins its OWN thread's room (so it sees replies
// live). A manager socket (admin/developer/owner) can ALSO watch a managed
// account's room by sending {type:'watch', userId} — the staff inbox does
// this when the staff member opens a different conversation. Sending a
// message needs an explicit `asSelf` flag from the client because a single
// admin/developer account plays BOTH parts (thread owner on their own /chat
// page, responder on their staff inbox) — role alone can't disambiguate.
import { WebSocketServer } from 'ws';
import { db, log } from './db.js';
import { userFromToken, SESSION_COOKIE_NAME } from './auth.js';

const MANAGES = { admin: 'user', developer: 'admin', owner: 'developer' };

function cookieFromHeader(header, name) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

const insertMsg = db.prepare(`
  INSERT INTO chat_messages (user_id, sender_role, sender_id, body, image_path, read_by_admin, read_by_user)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
// Joined so every broadcast message carries the actual sender's identity —
// a player needs to see which specific staff member (Staff ID + name) they're
// talking to, not a generic "Support" label.
const selectMsgWithSender = db.prepare(`
  SELECT c.*, u.display_name AS sender_display_name, u.staff_id AS sender_staff_id
  FROM chat_messages c JOIN users u ON u.id = c.sender_id
  WHERE c.id = ?
`);
// Only ever accepts a path this server itself generated via POST
// /api/chat/upload (server/routes/chat.js, which writes to data/uploads/chat
// with a random filename) — never an arbitrary client-supplied path/URL.
const isOwnUploadPath = (p) => typeof p === 'string' && /^\/uploads\/chat\/[a-f0-9-]{36}\.(png|jpe?g|gif|webp)$/i.test(p);

export function attachChat(server) {
  const wss = new WebSocketServer({ server, path: '/ws/chat' });
  const rooms = new Map(); // userId -> Set<ws>
  const staffSockets = new Set();

  const join = (userId, ws) => {
    if (!rooms.has(userId)) rooms.set(userId, new Set());
    rooms.get(userId).add(ws);
  };
  const leave = (userId, ws) => {
    rooms.get(userId)?.delete(ws);
    if (rooms.get(userId)?.size === 0) rooms.delete(userId);
  };
  const broadcastToRoom = (userId, payload) => {
    for (const client of rooms.get(userId) || []) {
      if (client.readyState === client.OPEN) client.send(JSON.stringify(payload));
    }
  };
  const broadcastToStaff = (payload) => {
    for (const client of staffSockets) if (client.readyState === client.OPEN) client.send(JSON.stringify(payload));
  };

  wss.on('connection', (ws, req) => {
    const token = cookieFromHeader(req.headers.cookie, SESSION_COOKIE_NAME);
    const user = userFromToken(token);
    if (!user) { ws.close(4001, 'unauthenticated'); return; }

    ws.user = user;
    const isManager = !!MANAGES[user.role]; // admin, developer, owner
    ws.watchingUserId = null;
    // Every account joins its OWN thread's room, so it sees replies live —
    // this applies to users AND to staff now that admin/developer also have
    // their own outbound thread to whoever manages them.
    join(user.id, ws);
    if (isManager) staffSockets.add(ws);

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      if (msg.type === 'watch' && isManager) {
        const targetId = Number(msg.userId);
        // Defense in depth: the REST inbox is already scoped, but a scoped
        // manager could otherwise hand-craft a watch frame for an account
        // that isn't actually assigned to them.
        const target = db.prepare('SELECT role, assigned_staff_id FROM users WHERE id = ?').get(targetId);
        if (!target || target.role !== MANAGES[user.role] || target.assigned_staff_id !== user.staff_id) {
          ws.send(JSON.stringify({ type: 'error', message: 'That account is not assigned to you.' }));
          return;
        }
        if (ws.watchingUserId) leave(ws.watchingUserId, ws);
        ws.watchingUserId = targetId;
        join(ws.watchingUserId, ws);
        return;
      }

      if (msg.type === 'send') {
        const body = String(msg.body || '').slice(0, 2000).trim();
        const imagePath = isOwnUploadPath(msg.imagePath) ? msg.imagePath : null;
        if (!body && !imagePath) return;
        // A user is always the thread-owner side. A manager (admin/developer/
        // owner) plays BOTH parts on different pages, so the client says
        // which one this send is: `asSelf` (their own outbound thread, e.g.
        // an admin messaging the developer who created them) vs the default
        // (responding as manager to whichever thread they're watching).
        const asSelf = user.role === 'user' || msg.asSelf === true;
        if (asSelf) {
          // Re-check from the DB, not the connection-time snapshot in `user`
          // — a player may have set their Admin ID after this socket opened
          // via POST /api/chat/assign, and staff assignment can be edited
          // by an owner at any time.
          const fresh = db.prepare('SELECT assigned_staff_id FROM users WHERE id = ?').get(user.id);
          if (!fresh.assigned_staff_id) {
            const noun = user.role === 'user' ? 'Admin ID' : 'manager';
            ws.send(JSON.stringify({ type: 'error', message: `No ${noun} assigned yet — nowhere to send this.` }));
            return;
          }
        }
        const targetUserId = asSelf ? user.id : ws.watchingUserId;
        if (!targetUserId) return;
        const info = insertMsg.run(targetUserId, asSelf ? 'user' : 'admin', user.id, body, imagePath, asSelf ? 0 : 1, asSelf ? 1 : 0);
        const row = selectMsgWithSender.get(info.lastInsertRowid);
        broadcastToRoom(targetUserId, { type: 'message', message: row });
        if (asSelf) broadcastToStaff({ type: 'inbox_update', userId: targetUserId });
        log('info', 'chat', 'message sent', { userId: targetUserId, from: user.role, asSelf, hasImage: !!imagePath });
      }
    });

    ws.on('close', () => {
      leave(user.id, ws);
      if (isManager) { staffSockets.delete(ws); if (ws.watchingUserId) leave(ws.watchingUserId, ws); }
    });
  });

  log('info', 'chat', 'WebSocket chat server attached at /ws/chat');
  return wss;
}
