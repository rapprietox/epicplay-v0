// Test-only stand-in for src/lib/anthropic.ts -- the real module
// constructs `new Anthropic()` at import time (and imports "server-only",
// which throws outside a Server Component/Action), neither of which this
// test needs: none of the server actions exercised here
// (logQuickAtBat/logExtraOut/undoAtBat/syncGameState) ever call
// parseVoiceCommand.
export async function parseVoiceCommand(): Promise<never> {
  throw new Error("test stub: parseVoiceCommand should not be called by this test");
}
