// Test-only stand-in for src/lib/post-game-analysis.ts -- same reason as
// anthropic-stub.ts (constructs `new Anthropic()` + imports "server-only"
// at module scope). Not called by this test.
export async function generatePostGameAnalysis(): Promise<never> {
  throw new Error("test stub: generatePostGameAnalysis should not be called by this test");
}
