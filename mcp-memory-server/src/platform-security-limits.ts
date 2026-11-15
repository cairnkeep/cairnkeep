// Shared finite native-operation cap; tracked-worker startup budgets the
// identity lookup and both uncached Windows ACL batches from this same limit.
export const WINDOWS_SECURITY_COMMAND_TIMEOUT_MS = 10_000;
