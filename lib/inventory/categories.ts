export type InventoryCategory = {
  code: string;
  name: string;
  parent_code: string | null;
};

export function categoryOptions(categories: InventoryCategory[]) {
  const byCode = new Map(categories.map(category => [category.code, category]));
  return categories.map(category => {
    const names: string[] = [];
    const visited = new Set<string>();
    let current: InventoryCategory | undefined = category;
    while (current && !visited.has(current.code)) {
      visited.add(current.code);
      names.unshift(current.name);
      current = current.parent_code ? byCode.get(current.parent_code) : undefined;
    }
    return { code: category.code, name: names.join(" / ") };
  }).sort((a, b) => a.name.localeCompare(b.name, "es") || a.code.localeCompare(b.code));
}

// Include the selected category itself, even when an old URL references a deleted code.
export function categoryBranch(code: string, categories: InventoryCategory[]) {
  const children = new Map<string, string[]>();
  for (const category of categories) {
    if (category.parent_code) {
      const siblings = children.get(category.parent_code) ?? [];
      siblings.push(category.code);
      children.set(category.parent_code, siblings);
    }
  }
  const branch = new Set([code]);
  for (const parent of branch) {
    for (const child of children.get(parent) ?? []) branch.add(child);
  }
  return [...branch];
}
