/** Hauteurs à réserver avant et après les lignes montées d'une liste virtualisée. */
export function rowSpacers(rows: readonly { start: number; end: number }[], total: number) {
  return { before: rows[0]?.start ?? 0, after: total - (rows.at(-1)?.end ?? 0) };
}
