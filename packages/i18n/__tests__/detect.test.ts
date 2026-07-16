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
    settingsDetector
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
});
