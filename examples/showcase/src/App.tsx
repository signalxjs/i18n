import { component, signal } from 'sigx';
import { T, useTranslation, useLocale } from '@sigx/i18n';

/**
 * No `target` anywhere — each section just uses its own namespace, and a
 * namespace's JSON loads only when its component renders. The "app" section is
 * hidden behind a toggle so you can watch `en/app/dashboard.json` load in the
 * Network panel ONLY when it's revealed — never on the initial paint.
 *
 * JSX-child rule: use the call form `t.x()` (or `<T>`) as element children.
 */

const Nav = component(() => {
    const t = useTranslation('nav');
    const loc = useLocale();
    return () => (
        <header class="row" style="justify-content: space-between">
            <div>
                <h1>{t.brand()}</h1>
                <div class="muted">{t.greeting({ name: 'Andreas' })}</div>
            </div>
            <div class="row">
                <span class="muted">locale:</span>
                <button aria-pressed={loc.locale === 'en'} onClick={() => loc.setLocale('en')}>
                    EN
                </button>
                <button aria-pressed={loc.locale === 'sv'} onClick={() => loc.setLocale('sv')}>
                    SV
                </button>
                {loc.loading ? <span class="muted">loading…</span> : null}
            </div>
        </header>
    );
});

const MarketingPanel = component(() => {
    const t = useTranslation('marketing/home');
    return () => (
        <section class="card">
            <h2>marketing/home</h2>
            <strong>
                <T k="title" ns="marketing/home" />
            </strong>
            <p class="muted">{t.subtitle()}</p>
            <p>{t.users({ count: 1337 })}</p>
            <p>
                <T k="legal" ns="marketing/home" components={{ a: c => <a href="#terms">{c}</a> }} />
            </p>
            <button>{t.cta()}</button>
        </section>
    );
});

const AppPanel = component(() => {
    const t = useTranslation('app/dashboard');
    const now = new Date();
    return () => (
        <section class="card">
            <h2>app/dashboard</h2>
            <strong>
                <T k="title" ns="app/dashboard" />
            </strong>
            <p>{t.revenue({ amount: 42690 })}</p>
            <p>{t.updated({ when: now })}</p>
            <p>{t.items({ count: 3 })}</p>
        </section>
    );
});

/**
 * A translator pinned to a locale that is NOT the active one. The `sv` catalog
 * is fetched for this pane alone — no `setLocale`, no second store — and the
 * pane is deliberately inert when you toggle EN/SV in the header: it repaints
 * only when *its own* catalog lands.
 */
const PreviewPanel = component(() => {
    const t = useTranslation('marketing/home');
    const sv = useTranslation('marketing/home', { locale: 'sv' });
    return () => (
        <section class="card">
            <h2>side-by-side preview</h2>
            <p class="muted">active locale</p>
            <strong>{t.title()}</strong>
            <p>{t.users({ count: 1337 })}</p>
            <p class="muted">pinned to sv</p>
            <strong>{sv.title()}</strong>
            <p>{sv.users({ count: 1337 })}</p>
            <p class="muted">
                Switch EN/SV above: only the top half moves. <code>sv</code> loaded once, for
                this pane, without the app ever leaving its locale.
            </p>
        </section>
    );
});

export const App = component(() => {
    const showApp = signal(false);
    return () => (
        <>
            <Nav />
            <p class="muted">
                Each section uses only its own namespace, lazy-loaded on first render — no target
                axis. Reveal the app section and watch <code>app/dashboard</code> load then, not
                before.
            </p>
            <div class="panels">
                <MarketingPanel />
                {showApp.value ? (
                    <AppPanel />
                ) : (
                    <section class="card">
                        <h2>app/dashboard</h2>
                        <p class="muted">Not loaded yet.</p>
                        <button onClick={() => (showApp.value = true)}>Reveal app section</button>
                    </section>
                )}
                <PreviewPanel />
            </div>
        </>
    );
});
