import { assertUninstallRetainsTeam } from './lib/team-retention.mjs';
try { assertUninstallRetainsTeam(process.argv.slice(2)); }
catch (error) { console.error(error.message); process.exitCode = 1; }
