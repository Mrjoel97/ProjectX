/**
 * Normalize an entity name to a cross-doc dedup key: lowercase, trim, and collapse
 * internal whitespace runs (incl. tabs/newlines) to single spaces. The same entity
 * name written differently across two docs maps to ONE `graphNodes` key (VALT-02).
 */
export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}
