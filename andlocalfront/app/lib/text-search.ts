/**
 * Texto comparable para buscar: sin tildes, sin mayúsculas y con los espacios
 * colapsados. «  José  PÉREZ » → «jose perez». Es lo mismo que hace el
 * servidor con `unaccent` + `ILIKE`, así que un buscador local y uno del
 * servidor encuentran lo mismo.
 */
export function searchableText(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * ¿Algún campo contiene la búsqueda? Los campos se unen con un espacio, como
 * hacían las pantallas: «codex jennifer» sigue encontrando nombre + correo.
 * Una búsqueda vacía lo encuentra todo.
 */
export function matchesSearch(query: string, ...fields: ReadonlyArray<string | null | undefined>): boolean {
  const needle = searchableText(query);
  return !needle || searchableText(fields.filter(Boolean).join(" ")).includes(needle);
}
