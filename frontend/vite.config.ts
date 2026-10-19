import { defineConfig } from 'vite';
const paths = ['/api', '/me', '/submit', '/leaderboard', '/replays', '/champion', '/sample_bot.py', '/admin', '/live', '/static'];
export default defineConfig({server:{proxy:Object.fromEntries(paths.map(path => [path, 'http://127.0.0.1:8000']))}});
