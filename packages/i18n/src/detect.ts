/**
 * Locale detection — an ordered resolver chain. Each detector reads a candidate
 * (or ordered candidates) from a source; the first candidate that matches the
 * `supported` set wins, else the master locale.
 *
 * Pure and isomorphic: server callers pass request data via `DetectionContext`
 * (`headers`/`cookies`/`url`); on the client the browser detectors read
 * `navigator`, `document.cookie`, and `location` when those globals exist.
 */

/** Request/environment inputs for detection. All optional; browser globals fill gaps client-side. */
export interface DetectionContext {
    /** Lower-cased header bag (server). `accept-language`, `cookie`, … */
    headers?: Record<string, string | string[] | undefined>;
    /** Parsed cookies (server), overrides `document.cookie`/`cookie` header. */
    cookies?: Record<string, string>;
    /** Current URL (server); the client falls back to `location`. */
    url?: string | URL;
    /** Explicit stored locale getter (e.g. app settings), for `settingsDetector`. */
    getStored?: () => string | null | undefined;
}

/** A single detection source. Returns one or more ordered candidates, or null. */
export interface Detector {
    name: string;
    detect(ctx: DetectionContext): string | string[] | null;
}

function getHeader(ctx: DetectionContext, name: string): string | undefined {
    const raw = ctx.headers?.[name];
    return Array.isArray(raw) ? raw[0] : raw;
}

/** Parse `Accept-Language` into tags ordered by descending q-value. */
export function parseAcceptLanguage(header: string): string[] {
    return header
        .split(',')
        .map(part => {
            const [tag, ...params] = part.trim().split(';');
            const q = params.find(p => p.trim().startsWith('q='));
            const weight = q ? parseFloat(q.split('=')[1]) : 1;
            return { tag: tag.trim(), weight: Number.isFinite(weight) ? weight : 1 };
        })
        .filter(e => e.tag && e.tag !== '*')
        .sort((a, b) => b.weight - a.weight)
        .map(e => e.tag);
}

/** Read one cookie value out of a `Cookie` header / `document.cookie` string. */
export function parseCookie(cookieString: string, name: string): string | null {
    for (const pair of cookieString.split(';')) {
        const idx = pair.indexOf('=');
        if (idx === -1) continue;
        if (pair.slice(0, idx).trim() === name) {
            return decodeURIComponent(pair.slice(idx + 1).trim());
        }
    }
    return null;
}

function resolveUrl(ctx: DetectionContext): URL | null {
    try {
        if (ctx.url) return typeof ctx.url === 'string' ? new URL(ctx.url, 'http://localhost') : ctx.url;
        if (typeof location !== 'undefined' && location.href) return new URL(location.href);
    } catch {
        /* malformed URL → no candidate */
    }
    return null;
}

// ── Built-in detectors ──────────────────────────────────────────────────────

/** Reads an explicitly stored locale (app settings), via `ctx.getStored`. */
export const settingsDetector: Detector = {
    name: 'settings',
    detect: ctx => ctx.getStored?.() ?? null
};

/** Reads `navigator.languages` (client) or the `Accept-Language` header (server). */
export const browserDetector: Detector = {
    name: 'browser',
    detect(ctx) {
        const header = getHeader(ctx, 'accept-language');
        if (header) return parseAcceptLanguage(header);
        if (typeof navigator !== 'undefined') {
            if (navigator.languages && navigator.languages.length) return [...navigator.languages];
            if (navigator.language) return navigator.language;
        }
        return null;
    }
};

/** Reads a locale cookie (SSR-readable so server and client agree). */
export function cookieDetector(name = 'locale'): Detector {
    return {
        name: 'cookie',
        detect(ctx) {
            if (ctx.cookies && ctx.cookies[name]) return ctx.cookies[name];
            const header =
                getHeader(ctx, 'cookie') ?? (typeof document !== 'undefined' ? document.cookie : undefined);
            return header ? parseCookie(header, name) : null;
        }
    };
}

/** Reads a locale from `?<param>=` and/or the first path segment (`/en/…`). */
export function urlDetector(options: { param?: string; path?: boolean } = {}): Detector {
    const { param = 'lang', path = false } = options;
    return {
        name: 'url',
        detect(ctx) {
            const url = resolveUrl(ctx);
            if (!url) return null;
            if (param) {
                const q = url.searchParams.get(param);
                if (q) return q;
            }
            if (path) {
                const seg = url.pathname.split('/').filter(Boolean)[0];
                if (seg) return seg;
            }
            return null;
        }
    };
}

// ── Resolution ──────────────────────────────────────────────────────────────

/** Find the supported locale for a candidate: exact, then primary subtag, else null. */
export function findSupported(candidate: string, supported: readonly string[] | undefined): string | null {
    if (!supported || supported.length === 0) return candidate;
    if (supported.includes(candidate)) return candidate;
    const primary = candidate.split('-')[0];
    return supported.find(s => s.split('-')[0] === primary) ?? null;
}

/**
 * Run detectors in order; return the first candidate that matches `supported`,
 * else `fallbackLocale`.
 */
export function detectLocale(
    detectors: readonly Detector[],
    ctx: DetectionContext,
    supported: readonly string[] | undefined,
    fallbackLocale: string
): string {
    for (const detector of detectors) {
        const raw = detector.detect(ctx);
        if (!raw) continue;
        for (const candidate of Array.isArray(raw) ? raw : [raw]) {
            const matched = findSupported(candidate, supported);
            if (matched) return matched;
        }
    }
    return fallbackLocale;
}

/** Detection options surfaced through i18n config. */
export interface DetectionOptions {
    /** Order of built-in detectors. Default: `['url','cookie','settings','browser']`. */
    order?: ('url' | 'cookie' | 'settings' | 'browser')[];
    /** Cookie name for the cookie detector. Default `'locale'`. */
    cookie?: string;
    /** Query param for the url detector. Default `'lang'`. */
    urlParam?: string;
    /** Also read the first path segment (`/en/…`) as a locale. Default false. */
    pathLocale?: boolean;
    /** Request/environment context (server passes headers/cookies/url here). */
    context?: DetectionContext;
}

const DEFAULT_ORDER: NonNullable<DetectionOptions['order']> = ['url', 'cookie', 'settings', 'browser'];

/** Build the ordered detector list from `DetectionOptions`. */
export function createDetectors(options: DetectionOptions = {}): Detector[] {
    const order = options.order ?? DEFAULT_ORDER;
    return order.map(name => {
        switch (name) {
            case 'url':
                return urlDetector({ param: options.urlParam, path: options.pathLocale });
            case 'cookie':
                return cookieDetector(options.cookie);
            case 'settings':
                return settingsDetector;
            case 'browser':
                return browserDetector;
        }
    });
}
