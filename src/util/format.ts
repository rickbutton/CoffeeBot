export function truncate(s: string, n: number): string {
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export function groupBy<T, K>(arr: T[], key: (t: T) => K): Map<K, T[]> {
    const out = new Map<K, T[]>();
    for (const item of arr) {
        const list = out.get(key(item)) ?? [];
        list.push(item);
        out.set(key(item), list);
    }
    return out;
}
