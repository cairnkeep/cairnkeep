import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { TeamError } from './team-errors.js';

export const teamPageSchema=z.object({size:z.number().int().min(1).max(100),cursor:z.string().min(1).max(2048).optional()}).strict();
const cursorSchema=z.object({v:z.literal(1),scope:z.string().regex(/^[a-f0-9]{64}$/),view:z.string().regex(/^[a-f0-9]{64}$/),offset:z.number().int().positive().max(100000),upper:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)}).strict();
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const mac=(key:string,value:string)=>createHmac('sha256',Buffer.from(key,'hex')).update(value).digest();
export function pageTeamItems(items:unknown[],secret:string,scope:string,page:z.infer<typeof teamPageSchema>,audit=false):{items:unknown[];next_cursor:string|null} {
    let offset=0,upper=audit ? Number((items[0] as {sequence?:number})?.sequence ?? 0) : 0;
    let decoded:z.infer<typeof cursorSchema>|undefined;
    if(page.cursor) {
        try {
            const match=/^([A-Za-z0-9_-]+)\.([a-f0-9]{64})$/.exec(page.cursor);
            if(!match || !timingSafeEqual(mac(secret,match[1]),Buffer.from(match[2],'hex'))) throw new Error();
            decoded=cursorSchema.parse(JSON.parse(Buffer.from(match[1],'base64url').toString('utf8')));
            if(decoded.scope!==hash(scope)) throw new Error();
            offset=decoded.offset;upper=decoded.upper;
        } catch { throw new TeamError('invalid'); }
    }
    if(audit) items=items.filter(row=>Number((row as {sequence:number}).sequence)<=upper);
    const view=hash(JSON.stringify(items));
    if(decoded && decoded.view!==view) throw new TeamError('conflict');
    if(offset>items.length) throw new TeamError('invalid');
    const selected=items.slice(offset,offset+page.size),next=offset+selected.length;
    let cursor:string|null=null;
    if(next<items.length) {
        const bytes=Buffer.from(JSON.stringify({v:1,scope:hash(scope),view,offset:next,upper})).toString('base64url');
        cursor=bytes+'.'+mac(secret,bytes).toString('hex');
    }
    return {items:selected,next_cursor:cursor};
}
