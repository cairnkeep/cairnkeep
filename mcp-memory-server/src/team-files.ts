import { closeSync,openSync,writeFileSync,fsyncSync } from 'node:fs';
import { dirname,resolve } from 'node:path';
import { hardenPrivatePath } from './platform-security.js';
import { prepareTeamPrivateDirectory } from './team-store.js';

export function writePrivateExclusive(path:string,bytes:string):void {
    path=resolve(path);prepareTeamPrivateDirectory(dirname(path),true);
    const fd=openSync(path,'wx',0o600);
    try {hardenPrivatePath(path);writeFileSync(fd,bytes,'utf8');fsyncSync(fd);}
    finally {closeSync(fd);}
    // Persist the new directory entry as well as its contents on POSIX.
    // Node cannot open/fsync a directory handle on Windows.
    if(process.platform!=='win32') {
        const parent=openSync(dirname(path),'r');
        try {fsyncSync(parent);} finally {closeSync(parent);}
    }
}
