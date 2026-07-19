import { component } from 'sigx';
import { T, useTranslation, useLocale } from '@sigx/i18n';
import { DEMO } from './i18n';

/**
 * A real SignalX component tree — the same components render on the server (to
 * HTML) and on the client (hydration). Nothing here is SSR-specific: the store
 * resolves translations synchronously from the seeded catalogs, so the first
 * client render matches the server HTML exactly.
 *
 * JSX-child rule: use the call form `t.x()` (or `<T>`) as element children; the
 * bare accessor `t.x` is for attributes / template literals only.
 */

const LocaleSwitcher = component(() => {
    const t = useTranslation('home');
    const loc = useLocale();
    return () => (
        <div class="switcher">
            <span class="muted">{t.langLabel()}:</span>
            {/* Client-side switch — reactive, no reload (loads the other catalog on the fly). */}
            <button aria-pressed={loc.locale === 'en'} onClick={() => loc.setLocale('en')}>
                English
            </button>
            <button aria-pressed={loc.locale === 'sv'} onClick={() => loc.setLocale('sv')}>
                Svenska
            </button>
            {loc.loading ? <span class="muted">…</span> : null}
            {/* SSR switch — a full navigation the server renders in that locale. */}
            <a href="?lang=en">?lang=en</a>
            <a href="?lang=sv">?lang=sv</a>
        </div>
    );
});

// `app` namespace — not in the eager set, so it loads on first render. On the
// server that load is awaited before the shell emits; on the client it's already
// in the seed, so it renders immediately with no refetch.
const Stats = component(() => {
    const t = useTranslation('app');
    return () => (
        <section class="card">
            <h2>{t.heading()}</h2>
            <p>{t.users({ count: DEMO.users })}</p>
            <p>{t.revenue({ amount: DEMO.revenue })}</p>
            <p class="muted">{t.updated({ when: DEMO.updatedAt })}</p>
        </section>
    );
});

export const App = component(() => {
    const t = useTranslation('home');
    const loc = useLocale();
    return () => (
        <>
            <header>
                <strong>@sigx/i18n</strong>
                <LocaleSwitcher />
            </header>
            <main>
                <h1>{t.title()}</h1>
                <p class="lead">{t.subtitle()}</p>
                <p class="served">{t.servedBy({ locale: loc.locale })}</p>

                <Stats />

                <section class="card">
                    {/* Master fallback: this key exists only in en/home.json. */}
                    <p>
                        <T k="fallbackNote" ns="home" />
                    </p>
                    <a class="cta" href="https://github.com/signalxjs/i18n">
                        {t.cta()}
                    </a>
                </section>
            </main>
        </>
    );
});
