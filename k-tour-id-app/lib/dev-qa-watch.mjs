// Add only the generated QA subtree to webpack's existing watcher exclusions.
export function withQaOutputIgnored(ignored, directory) {
  const qaDirectory = directory.replaceAll("\\", "/")
  const qaPattern = "^" + qaDirectory.split("/").map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\\\/]") + "(?:[\\\\/]|$)"
  if (ignored instanceof RegExp) return new RegExp(`(?:${ignored.source})|(?:${qaPattern})`, ignored.flags)
  // Watchpack's glob compiler preserves regex hex escapes. These keep literal
  // checkout-name glob characters from widening the exclusion or missing QA.
  const qaGlob = qaDirectory.replace(/[?*\[\]{}]/g, character => `\\x${character.charCodeAt(0).toString(16)}`)
  const qaGlobs = [qaGlob, `${qaGlob}/**`]
  // Never mix a RegExp into an array: webpack permits only string arrays here.
  if (ignored === undefined) return qaGlobs
  if (typeof ignored === "string") return [ignored, ...qaGlobs]
  if (Array.isArray(ignored) && ignored.every(value => typeof value === "string")) return [...ignored, ...qaGlobs]
  throw new TypeError("Unsupported development watcher ignore configuration")
}
