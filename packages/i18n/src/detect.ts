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
    /**
     * Custom detectors placed at the FRONT of the chain (highest priority).
     * This is how non-web runtimes (lynx, terminal) inject a native locale source
     * through the same `Detector` interface — no renderer-specific fork.
     */
    detectors?: Detector[];
    /** Request/environment context (server passes headers/cookies/url here). */
    context?: DetectionContext;
}

const DEFAULT_ORDER: NonNullable<DetectionOptions['order']> = ['url', 'cookie', 'settings', 'browser'];

/** Build the ordered detector list from `DetectionOptions` (custom detectors first). */
export function createDetectors(options: DetectionOptions = {}): Detector[] {
    const order = options.order ?? DEFAULT_ORDER;
    const builtins = order.map(name => {
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
    return [...(options.detectors ?? []), ...builtins];
}

// ── Request adapters ────────────────────────────────────────────────────────
// Structural types rather than the DOM/undici globals: this module has to
// compile in a lynx/terminal build with no `Request` in lib, and the shapes
// below are equally satisfied by a WinterCG `Request` (workerd, Deno, Bun) and
// a Node `IncomingMessage`.

/** Minimal structural view of a `Headers`-like object. */
export interface HeadersLike {
    forEach(callback: (value: string, key: string) => void): void;
}

/** Anything carrying request headers and (optionally) a URL. */
export interface RequestLike {
    /** Absolute (`Request.url`) or path-only (`IncomingMessage.url`) — both resolve. */
    url?: string;
    headers: HeadersLike | Record<string, string | string[] | undefined>;
}

/**
 * Build a `DetectionContext` from a request. The `Accept-Language` and `Cookie`
 * headers reach the built-in detectors unchanged; `url` feeds `urlDetector`.
 */
export function detectionContextFromRequest(request: RequestLike): DetectionContext {
    const headers: Record<string, string | string[] | undefined> = {};
    const raw = request.headers as HeadersLike | Record<string, string | string[] | undefined>;
    if (raw && typeof (raw as HeadersLike).forEach === 'function') {
        (raw as HeadersLike).forEach((value, key) => {
            headers[key.toLowerCase()] = value;
        });
    } else if (raw) {
        for (const [key, value] of Object.entries(raw as Record<string, string | string[] | undefined>)) {
            headers[key.toLowerCase()] = value;
        }
    }
    return request.url ? { headers, url: request.url } : { headers };
}

/** Options for `resolveRequestLocale` — detection options plus the negotiation target. */
export interface RequestLocaleOptions extends DetectionOptions {
    /** Negotiation target set; empty/undefined accepts any locale. */
    supported?: readonly string[];
    /** Master locale, returned when nothing matches. */
    fallbackLocale: string;
}

/**
 * Resolve the locale for one request — the single call a platform entry or a
 * server function makes. An explicit `context` is layered ON TOP of the
 * request-derived one, so a caller can override (e.g. a session-stored locale
 * via `getStored`) without losing the headers.
 */
export function resolveRequestLocale(request: RequestLike, options: RequestLocaleOptions): string {
    const { supported, fallbackLocale, context, ...detection } = options;
    const ctx: DetectionContext = { ...detectionContextFromRequest(request), ...context };
    return detectLocale(createDetectors({ ...detection, context: ctx }), ctx, supported, fallbackLocale);
}

// ── Server-round-trip locale switching ──────────────────────────────────────
// The two primitives behind the zero-JS locale switch: a link that carries the
// locale, and the `Set-Cookie` that makes the choice stick for later requests.

/** Default cookie name — matches `cookieDetector()`'s default. */
export const LOCALE_COOKIE = 'locale';

export interface LocaleCookieOptions {
    /** Cookie name. Default `'locale'` (`LOCALE_COOKIE`). */
    name?: string;
    /** Lifetime in seconds. Default one year. */
    maxAge?: number;
    /** Cookie path. Default `'/'`. */
    path?: string;
    /** Default `'Lax'` — a top-level locale link must still send the cookie. */
    sameSite?: 'Lax' | 'Strict' | 'None';
    secure?: boolean;
    domain?: string;
    /**
     * Default **false** on purpose: `cookieDetector` reads `document.cookie` on
     * the client, so an httpOnly locale cookie would make the client detector
     * disagree with the server. Only set this if nothing client-side detects.
     */
    httpOnly?: boolean;
}

/** Build the `Set-Cookie` value that persists a locale choice across requests. */
export function localeCookie(locale: string, options: LocaleCookieOptions = {}): string {
    const {
        name = LOCALE_COOKIE,
        maxAge = 60 * 60 * 24 * 365,
        path = '/',
        sameSite = 'Lax',
        secure,
        domain,
        httpOnly
    } = options;
    const parts = [`${name}=${encodeURIComponent(locale)}`, `Path=${path}`, `Max-Age=${maxAge}`, `SameSite=${sameSite}`];
    if (domain) parts.push(`Domain=${domain}`);
    if (secure) parts.push('Secure');
    if (httpOnly) parts.push('HttpOnly');
    return parts.join('; ');
}

export interface LocaleSwitchOptions {
    /** Query param carrying the locale. Default `'lang'`; `false` to omit it. */
    param?: string | false;
    /** Also rewrite the leading path segment (`/en/…`), mirroring `pathLocale`. */
    path?: boolean;
    /** Locales recognised as a leading path segment; without it, a BCP-47-shaped segment is assumed. */
    supported?: readonly string[];
}

const LOCALE_SEGMENT = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

/**
 * The href for "switch to `locale`" — the whole zero-JS locale switch on the
 * client side. Everything else in the URL is preserved, so the user lands back
 * on the page they were reading.
 */
export function localeSwitchUrl(url: string | URL, locale: string, options: LocaleSwitchOptions = {}): string {
    const { param = 'lang', path = false, supported } = options;
    const relative = typeof url === 'string' && !/^[a-z][a-z0-9+.-]*:/i.test(url);
    const parsed = typeof url === 'string' ? new URL(url, 'http://localhost') : new URL(url.href);

    if (param) parsed.searchParams.set(param, locale);
    if (path) {
        const segments = parsed.pathname.split('/').filter(Boolean);
        const first = segments[0];
        const isLocale = first !== undefined && (supported ? supported.includes(first) : LOCALE_SEGMENT.test(first));
        if (isLocale) segments[0] = locale;
        else segments.unshift(locale);
        parsed.pathname = `/${segments.join('/')}`;
    }

    return relative ? `${parsed.pathname}${parsed.search}${parsed.hash}` : parsed.href;
}
