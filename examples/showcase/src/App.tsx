import { component } from 'sigx';
import { T, useTranslation, useLocale } from '@sigx/i18n';

/**
 * Renders TWO targets at once (`marketing` + `app`), both sharing the `common`
 * base — each lazy-loads only its own JSON. Shows every binding form, plurals,
 * number/date formatting, master fallback, detection and persistence.
 */
export const App = component(() => {
    const loc = useLocale();
    const nav = useTranslation('nav'); // default target 'common'
    const home = useTranslation('home', { target: 'marketing' }); // concurrent target
    const dash = useTranslation('dashboard', { target: 'app' }); // concurrent target

    const now = new Date();

    return () => (
        <>
            <header class="row" style="justify-content: space-between">
                <div>
                    <h1>{nav.brand}</h1>
                    {/* accessor call form with a param */}
                    <div class="muted">{nav.greeting({ name: 'Andreas' })}</div>
                </div>
                <div class="row">
                    <span class="muted">locale:</span>
                    <button aria-pressed={loc.locale === 'en'} onClick={() => loc.setLocale('en')}>
                        EN
                    </button>
                    <button aria-pressed={loc.locale === 'sv'} onClick={() => loc.setLocale('sv')}>
                        SV
                    </button>
                    {loc.loading && <span class="muted">loading…</span>}
                </div>
            </header>

            <p class="muted">
                Two targets rendered together — <code>marketing</code> + <code>app</code> — each
                downloads only its own catalog, both falling back through the shared{' '}
                <code>common</code> base and the master locale (English).
            </p>

            <div class="panels">
                <section class="card">
                    <h2>marketing target</h2>
                    {/* <T> component — universal (works on DOM + lynx) */}
                    <strong>
                        <T k="title" ns="home" target="marketing" />
                    </strong>
                    <p class="muted">{home.subtitle}</p>
                    <p>{home.users({ count: 1337 })}</p>
                    {/* rich interpolation via components (function form) */}
                    <p>
                        <T
                            k="legal"
                            ns="home"
                            target="marketing"
                            components={{ a: c => <a href="#terms">{c}</a> }}
                        />
                    </p>
                    <button>{home.cta}</button>
                </section>

                <section class="card">
                    <h2>app target</h2>
                    {/* use:t directive (DOM-only convenience) */}
                    <strong use:t={['title', undefined, { ns: 'dashboard', target: 'app' }]} />
                    <p>{dash.revenue({ amount: 42690 })}</p>
                    <p>{dash.updated({ when: now })}</p>
                    <p>{dash.items({ count: 3 })}</p>
                    {/* nav.home resolved from the `app` target via `extends: common` */}
                    <p class="muted">
                        nav via extends: <span use:t={['home', undefined, { target: 'app' }]} />
                    </p>
                </section>
            </div>

            <p class="muted" style="margin-top:1.5rem">
                Accessor forms all resolve the same key: bare <b>{nav.home}</b>, call{' '}
                <b>{nav.home()}</b>, string-key <b>{nav('home')}</b>.
            </p>
        </>
    );
}, { name: 'App' });
