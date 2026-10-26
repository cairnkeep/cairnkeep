import {join} from 'node:path';

// Isolate synthetic clients without breaking Windows security utilities.
// No production routing, store location or provider secret is inherited.
export function teamLabEnvironment(home,overrides={},inherited=process.env) {
  const env={PATH:inherited.PATH ?? inherited.Path ?? '',HOME:home,USERPROFILE:home,TEMP:home,TMP:home,XDG_CONFIG_HOME:join(home,'.config')};
  for(const key of ['SystemRoot','WINDIR','ComSpec','PATHEXT','SystemDrive','OS','PROCESSOR_ARCHITECTURE']) {
    const entry=Object.entries(inherited).find(([name])=>name.toLowerCase()===key.toLowerCase());
    if(entry)env[key]=entry[1];
  }
  return {...env,...overrides};
}
