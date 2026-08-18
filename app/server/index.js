// server/index.js — Winners Gaming Club entry point. Demo-credit platform:
// no payment processing, no real-money rails, anywhere in this codebase.
import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { attachUser } from './auth.js';
import { log } from './db.js';
import { attachChat } from './ws.js';

import { router as siteRoutes } from './routes/site.js';
import { router as authRoutes } from './routes/auth.js';
import { router as playRoutes } from './routes/play.js';
import { router as userRoutes } from './routes/user.js';
import { router as chatRoutes, attachmentRouter as chatAttachmentRoutes } from './routes/chat.js';
import { router as adminRoutes } from './routes/admin.js';
import { router as ownerRoutes } from './routes/owner.js';
import { router as paymentsRoutes } from './routes/payments.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(ROOT, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
// attachUser runs BEFORE anything that can serve a file. It is what puts
// req.user on the request, so nothing registered above it can tell who is
// asking — which is exactly the hole the static mount used to sit in.
app.use(attachUser);
// Support-chat attachments, deliberately ahead of express.static. These are
// private uploads (real people's screenshots) released only to the parties to
// the thread they were posted in — see server/routes/chat.js. The static
// mount behind this router would happily hand any file under public/ to an
// anonymous visitor holding the URL, so the authenticated route has to claim
// the /uploads/ namespace first.
app.use(chatAttachmentRoutes);
app.use(express.static(path.join(ROOT, 'public')));

app.use(siteRoutes);
app.use(authRoutes);
app.use(playRoutes);
app.use(userRoutes);
app.use(chatRoutes);
app.use(adminRoutes);
app.use(ownerRoutes);
app.use(paymentsRoutes);

app.use((req, res) => {
  res.status(404).render('error', { title: 'Not found', message: "That page doesn't exist.", user: req.user });
});

app.use((err, req, res, next) => {
  log('error', 'http', err.message, { stack: err.stack, path: req.path });
  if (req.accepts('json') && !req.accepts('html')) return res.status(500).json({ error: 'internal error' });
  res.status(500).render('error', { title: 'Something went wrong', message: 'An unexpected error occurred. It has been logged.', user: req.user });
});

const PORT = process.env.PORT || 3000;
const server = http.createServer(app);
attachChat(server);
server.listen(PORT, () => {
  log('info', 'server', `Winners Gaming Club listening on http://localhost:${PORT}`);
  console.log(`Winners Gaming Club — http://localhost:${PORT}`);
});
