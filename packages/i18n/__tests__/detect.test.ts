/** Tests for @sigx/i18n locale detection. */
import { describe, it, expect } from 'vitest';
import {
    parseAcceptLanguage,
    parseCookie,
    findSupported,
    detectLocale,
    createDetectors,
    urlDetector,
    cookieDetector,
    browserDetector,
    settingsDetector,
    detectionContextFromRequest,
    resolveRequestLocale,
    localeCookie,
    localeSwitchUrl
} from '../src/detect.js';

describe('parseAcceptLanguage', () => {
    it('orders tags by descending q-value', () => {
        expect(parseAcceptLanguage('de;q=0.8,sv,en;q=0.9')).toEqual(['sv', 'en', 'de']);
    });
    it('drops wildcards and blanks', () => {
        expect(parseAcceptLanguage('*,en')).toEqual(['en']);
    });
});

describe('parseCookie', () => {
    it('extracts a named cookie and decodes it', () => {
        expect(parseCookie('a=1; locale=sv-SE; b=2', 'locale')).toBe('sv-SE');
        expect(parseCookie('a=1', 'locale')).toBeNull();
    });
});

describe('findSupported', () => {
    it('matches exact then primary subtag, else null', () => {
        expect(findSupported('sv', ['en', 'sv'])).toBe('sv');
        expect(findSupported('sv-FI', ['en', 'sv'])).toBe('sv');
        expect(findSupported('fr', ['en', 'sv'])).toBeNull();
    });
    it('accepts anything when no supported list is given', () => {
        expect(findSupported('xx', undefined)).toBe('xx');
        expect(findSupported('xx', [])).toBe('xx');
    });
});

describe('individual detectors (server context)', () => {
    it('urlDetector reads ?lang and path segment', () => {
        expect(urlDetector({ param: 'lang' }).detect({ url: 'https://x/y?lang=de' })).toBe('de');
        expect(urlDetector({ path: true }).detect({ url: 'https://x/sv/page' })).toBe('sv');
    });
    it('cookieDetector reads parsed cookies and the Cookie header', () => {
        expect(cookieDetector('locale').detect({ cookies: { locale: 'sv' } })).toBe('sv');
        expect(cookieDetector('locale').detect({ headers: { cookie: 'locale=de' } })).toBe('de');
    });
    it('browserDetector reads Accept-Language on the server', () => {
        expect(browserDetector.detect({ headers: { 'accept-language': 'sv,en;q=0.9' } })).toEqual([
            'sv',
            'en'
        ]);
    });
    it('settingsDetector reads the provided getStored', () => {
        expect(settingsDetector.detect({ getStored: () => 'sv' })).toBe('sv');
        expect(settingsDetector.detect({ getStored: () => null })).toBeNull();
    });
});

describe('detectLocale — ordered chain', () => {
    const supported = ['en', 'sv', 'de'];

    it('honours order: url wins over cookie/browser', () => {
        const ctx = {
            url: 'https://x/?lang=de',
            cookies: { locale: 'sv' },
            headers: { 'accept-language': 'en' }
        };
        expect(detectLocale(createDetectors({ urlParam: 'lang' }), ctx, supported, 'en')).toBe('de');
    });

    it('skips a detector whose candidate is unsupported and tries the next', () => {
        const ctx = {
            url: 'https://x/?lang=fr', // unsupported → skip
            cookies: { locale: 'sv' } // supported → win
        };
        expect(detectLocale(createDetectors({ urlParam: 'lang' }), ctx, supported, 'en')).toBe('sv');
    });

    it('negotiates by primary subtag (de-AT → de)', () => {
        expect(
            detectLocale(createDetectors({ order: ['cookie'] }), { cookies: { locale: 'de-AT' } }, supported, 'en')
        ).toBe('de');
    });

    it('falls back to the master when nothing matches', () => {
        expect(detectLocale(createDetectors(), { headers: { 'accept-language': 'fr' } }, supported, 'en')).toBe(
            'en'
        );
    });

    it('respects a custom order', () => {
        const ctx = { cookies: { locale: 'sv' }, headers: { 'accept-language': 'de' } };
        expect(detectLocale(createDetectors({ order: ['browser', 'cookie'] }), ctx, supported, 'en')).toBe('de');
    });

    it('places injected custom detectors first (native-runtime path)', () => {
        // e.g. a lynx app injects a detector reading its native device locale.
        const nativeDetector = { name: 'native', detect: () => 'de' };
        const ctx = { cookies: { locale: 'sv' } }; // built-in would say sv
        expect(detectLocale(createDetectors({ detectors: [nativeDetector] }), ctx, supported, 'en')).toBe('de');
    });
});

describe('detectionContextFromRequest', () => {
    it('lower-cases Headers into the detection context', () => {
        const ctx = detectionContextFromRequest(
            new Request('https://example.test/page?lang=sv', { headers: { 'Accept-Language': 'de' } })
        );
        expect(ctx.headers?.['accept-language']).toBe('de');
        expect(ctx.url).toBe('https://example.test/page?lang=sv');
    });

    it('accepts a Node-style header record and a path-only url', () => {
        const ctx = detectionContextFromRequest({ url: '/page', headers: { 'ACCEPT-LANGUAGE': 'sv' } });
        expect(ctx.headers?.['accept-language']).toBe('sv');
        expect(ctx.url).toBe('/page');
    });

    it('omits url when the request has none', () => {
        expect(detectionContextFromRequest({ headers: {} }).url).toBeUndefined();
    });
});

describe('resolveRequestLocale', () => {
    const opts = { supported: ['en', 'sv', 'de'], fallbackLocale: 'en' };

    it('runs the default chain over a request', () => {
        expect(
            resolveRequestLocale(new Request('https://x.test/', { headers: { 'accept-language': 'sv' } }), opts)
        ).toBe('sv');
    });

    it('lets an explicit context override the request-derived one', () => {
        const request = new Request('https://x.test/', { headers: { 'accept-language': 'sv' } });
        const locale = resolveRequestLocale(request, {
            ...opts,
            order: ['settings', 'browser'],
            context: { getStored: () => 'de' }
        });
        expect(locale).toBe('de');
    });
});

describe('localeCookie', () => {
    it('builds a Set-Cookie that the client detector can still read', () => {
        const cookie = localeCookie('sv');
        expect(cookie).toContain('locale=sv');
        expect(cookie).toContain('Path=/');
        expect(cookie).toContain('SameSite=Lax');
        expect(cookie).not.toContain('HttpOnly'); // cookieDetector reads document.cookie
    });

    it('honours name, lifetime and security flags', () => {
        const cookie = localeCookie('sv', { name: 'lang', maxAge: 60, secure: true, httpOnly: true });
        expect(cookie.startsWith('lang=sv')).toBe(true);
        expect(cookie).toContain('Max-Age=60');
        expect(cookie).toContain('Secure');
        expect(cookie).toContain('HttpOnly');
    });
});

describe('localeSwitchUrl', () => {
    it('sets the query param and preserves everything else', () => {
        expect(localeSwitchUrl('/docs?page=2#top', 'sv')).toBe('/docs?page=2&lang=sv#top');
    });

    it('replaces an existing locale param rather than appending', () => {
        expect(localeSwitchUrl('/docs?lang=en', 'sv')).toBe('/docs?lang=sv');
    });

    it('keeps an absolute URL absolute', () => {
        expect(localeSwitchUrl('https://x.test/a', 'sv')).toBe('https://x.test/a?lang=sv');
    });

    it('rewrites a leading locale segment in path mode', () => {
        expect(localeSwitchUrl('/en/docs', 'sv', { param: false, path: true, supported: ['en', 'sv'] })).toBe(
            '/sv/docs'
        );
    });

    it('prepends the locale when the path has none', () => {
        expect(localeSwitchUrl('/docs', 'sv', { param: false, path: true, supported: ['en', 'sv'] })).toBe(
            '/sv/docs'
        );
    });

    it('does not mistake a non-locale first segment for a locale', () => {
        expect(localeSwitchUrl('/documentation', 'sv', { param: false, path: true, supported: ['en', 'sv'] })).toBe(
            '/sv/documentation'
        );
    });
});
