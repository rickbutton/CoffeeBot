/**
 * Map a DB spec string (e.g. `beast_mastery`) to the Title Case form
 * wowutils uses as the spec icon's `alt` attribute (e.g. `Beast Mastery`).
 *
 * Used only for the script's per-character log labels, not for matching —
 * a character may have been simmed for any spec, but wowutils only stores
 * one droptimizer per character so we match the row by class instead.
 */
export function specToWowutilsAlt(spec: string | null | undefined): string | null {
    if (!spec) return null;
    const trimmed = spec.trim();
    if (!trimmed) return null;
    return trimmed
        .split(/[_\s]+/)
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(" ");
}

/**
 * Map a DB class string (e.g. `death_knight`) to the form wowutils uses in
 * its spec-icon image paths (e.g. `deathknight`). The path looks like
 * `/spec-icons/<classKey>/<spec>.png`, so this is what we match against
 * when disambiguating two characters that share the same name.
 */
export function classNameToWowutilsKey(className: string | null | undefined): string | null {
    if (!className) return null;
    const trimmed = className.trim();
    if (!trimmed) return null;
    return trimmed.toLowerCase().replace(/[_\s-]+/g, "");
}
