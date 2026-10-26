export class TeamError extends Error {
    constructor(public readonly code: 'disabled' | 'invalid' | 'unauthorized' | 'denied' | 'conflict' | 'integrity') { super(`Team ${code}.`); }
}
