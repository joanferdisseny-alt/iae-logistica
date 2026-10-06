export async function readAllRows<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await query(from, from + 499);
    if (error || !data) throw Error("No se pudieron cargar los datos completos. Comprueba la conexión y las migraciones pendientes.");
    rows.push(...data);
    if (data.length < 500) return rows;
  }
}
