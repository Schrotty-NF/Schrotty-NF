'use strict';

const { openDb } = require('./src/db');
const { createApp } = require('./src/app');

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '127.0.0.1';

const app = createApp(openDb());
app.listen(port, host, () => {
  console.log(`Schrotty-NF läuft auf http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
});
