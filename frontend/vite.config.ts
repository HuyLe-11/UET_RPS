import { defineConfig } from 'vite';
const paths = ['/api', '/auth', '/login', '/me', '/submit', '/test-bot', '/sample-bot-code', '/leaderboard', '/replays', '/champion', '/sample_bot.py', '/admin', '/live', '/static'];
const proxy = Object.fromEntries(paths.map(path => [path, 'http://127.0.0.1:8000']));
export default defineConfig({server:{proxy},preview:{proxy}});
