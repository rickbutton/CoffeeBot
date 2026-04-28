export const WOW_CLASSES = [
    "death_knight",
    "demon_hunter",
    "druid",
    "evoker",
    "hunter",
    "mage",
    "monk",
    "paladin",
    "priest",
    "rogue",
    "shaman",
    "warlock",
    "warrior",
] as const;

type WowClass = (typeof WOW_CLASSES)[number];

export const WOW_REGIONS = ["us", "eu", "kr", "tw", "cn"] as const;
type WowRegion = (typeof WOW_REGIONS)[number];

const CLASS_DISPLAY: Record<WowClass, string> = {
    death_knight: "Death Knight",
    demon_hunter: "Demon Hunter",
    druid: "Druid",
    evoker: "Evoker",
    hunter: "Hunter",
    mage: "Mage",
    monk: "Monk",
    paladin: "Paladin",
    priest: "Priest",
    rogue: "Rogue",
    shaman: "Shaman",
    warlock: "Warlock",
    warrior: "Warrior",
};

// Older SimC-addon versions emit `deathknight` / `demonhunter` instead of the underscored form.
const CLASS_ALIASES: Record<string, WowClass> = {
    deathknight: "death_knight",
    demonhunter: "demon_hunter",
};

export type SimcCharacter = {
    className: WowClass;
    classDisplay: string;
    name: string;
    region: WowRegion;
    realm: string;
    spec: string | null;
    level: number | null;
    race: string | null;
};

const CLASS_LINE = new RegExp(
    `^(${[...WOW_CLASSES, ...Object.keys(CLASS_ALIASES)].join("|")})\\s*=\\s*"([^"\\n]+)"\\s*$`,
);
const KEY_VALUE = /^([a-z_][a-z0-9_]*)\s*=\s*(.*?)\s*$/;

export function parseSimc(
    input: string,
): { ok: true; character: SimcCharacter; raw: string } | { ok: false; error: string } {
    if (!input || !input.trim()) return { ok: false, error: "Empty input." };

    let className: WowClass | null = null;
    let name: string | null = null;
    const fields = new Map<string, string>();

    for (const rawLine of input.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;

        if (className === null) {
            const cm = CLASS_LINE.exec(line);
            if (cm) {
                className = (CLASS_ALIASES[cm[1]!] ?? cm[1]) as WowClass;
                name = cm[2]!.trim();
            }
            continue;
        }

        const kv = KEY_VALUE.exec(line);
        if (kv && !fields.has(kv[1]!)) fields.set(kv[1]!, kv[2]!);
    }

    if (className === null || name === null) {
        return {
            ok: false,
            error: 'Could not find a class declaration line (e.g. `hunter="Charname"`). Make sure you pasted the full simc export from the SimulationCraft addon.',
        };
    }

    const regionRaw = fields.get("region")?.toLowerCase();
    if (!regionRaw || !(WOW_REGIONS as readonly string[]).includes(regionRaw)) {
        return {
            ok: false,
            error: "Missing or unrecognized `region=` line (expected us, eu, kr, tw, or cn).",
        };
    }

    const realm = fields.get("server");
    if (!realm) return { ok: false, error: "Missing `server=` line for the character's realm." };

    const levelRaw = fields.get("level");
    const level = levelRaw ? Number.parseInt(levelRaw, 10) : null;

    return {
        ok: true,
        raw: input,
        character: {
            className,
            classDisplay: CLASS_DISPLAY[className],
            name,
            region: regionRaw as WowRegion,
            realm,
            spec: fields.get("spec") ?? null,
            level: level !== null && Number.isFinite(level) ? level : null,
            race: fields.get("race") ?? null,
        },
    };
}

export function looksLikeSimc(input: string): boolean {
    if (!input || input.length < 40) return false;
    for (const line of input.split(/\r?\n/, 40)) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        return CLASS_LINE.test(t);
    }
    return false;
}
