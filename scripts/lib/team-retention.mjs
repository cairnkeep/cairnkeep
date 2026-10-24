import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';

function canonical(path) {
  const absolute = resolve(path);
  if (existsSync(absolute)) return realpathSync(absolute);
  const parent = dirname(absolute);
  return parent === absolute ? absolute : join(canonical(parent), basename(absolute));
}

/** Uninstall never grants permission to purge the separate team store. */
export function assertUninstallRetainsTeam(targets, env = process.env, home = homedir()) {
  const stores = new Set([join(home, '.cairnkeep', 'team'), ...(env.CAIRN_TEAM_BASE_DIR ? [env.CAIRN_TEAM_BASE_DIR] : [])]);
  const normalized = path => {
    const value = canonical(path);
    return process.platform === 'win32' ? value.toLowerCase() : value;
  };
  for (const team of stores) {
    if (!existsSync(resolve(team))) continue;
    const protectedPath = normalized(team);
    for (const target of targets) {
      const path = normalized(target);
      if (path === protectedPath || protectedPath.startsWith(path.endsWith(sep) ? path : `${path}${sep}`)) {
        throw new Error('Uninstall refused: a removal target contains team data. Retain it, or relocate the team store with an explicitly verified backup first.');
      }
    }
  }
}
