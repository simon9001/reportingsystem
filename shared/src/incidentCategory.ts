/** The catch-all category, where the person logging says in their own words what it is. */
export const isOtherCategory = (value: string) => /^\s*others?\s*$/i.test(value)

/** The category as shown to people: "Other: Fallen tree", or just the listed name. */
export function incidentCategory(i: { category: { value: string }; categoryText: string | null }): string {
  return i.categoryText ? `${i.category.value}: ${i.categoryText}` : i.category.value
}
