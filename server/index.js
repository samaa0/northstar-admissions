import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createApp } from './app.js';
import { createDatabase } from './database.js';

const port = Number(process.env.PORT || 3001);
const here = path.dirname(fileURLToPath(import.meta.url));
const db = createDatabase(process.env.DATABASE_PATH);
const app = createApp(db);
const dist = path.resolve(here, '../dist');

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(dist));
  app.get('/{*splat}', (_request, response) => response.sendFile(path.join(dist, 'index.html')));
}

const server = app.listen(port, '127.0.0.1', () => {
  console.log(`Northstar API listening on http://127.0.0.1:${port}`);
});

function shutdown() {
  server.close(() => db.close());
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
