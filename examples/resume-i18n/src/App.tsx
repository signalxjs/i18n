import { component } from 'sigx';
import { useTranslation, useLocale, localeSwitchUrl } from '@sigx/i18n';
import { Counter } from './resume/Counter';
import { ServerGreeting } from './resume/ServerGreeting';
import { SUPPORTED } from './i18n';

/** Deterministic demo data — no `new Date()` at render time. */
const DEMO = { credits: 1280, updatedAt: new Date('2026-07-01T00:00:00Z') };

/**
 * Translated copy with no handlers. The transform makes no boundary out of this,
 * so the strings are resolved once on the server and stay plain HTML — the
 * cheapest kind of translation there is.
 */
const Blurb = component<{ heading: string; hint: string; body: string }>((ctx) => () => (
    <>
        <h3>{ctx.props.heading}</h3>
        <p class="hint">{ctx.props.hint}</p>
        <p>{ctx.props.body}</p>
    </>
));

/**
 * The zero-JS locale switch — the blessed path under resumability.
 *
 * A resumed QRL handler is runtime-free: it cannot call `useI18n()`, and even if
 * it could, every never-hydrated boundary on the page would keep its old-language
 * text. So switching locale is a real server round trip: an ordinary link, the
 * server negotiates and re-renders, and a cookie makes the choice stick.
 */
const LocaleSwitch = component<{ url: string }>((ctx) => {
    // NOT destructured: `locale` is a getter on the controls object, so reading
    // it inside the render is what keeps the read reactive.
    const i18n = useLocale();
    const t = useTranslation('page');

    return () => (
        <p>
            {SUPPORTED.map((code, i) => (
                <>
                    {i > 0 ? ' · ' : ''}
                    <a
                        href={localeSwitchUrl(ctx.props.url, code)}
                        aria-current={code === i18n.locale ? 'true' : undefined}
                        style={code === i18n.locale ? 'font-weight:700' : ''}
                    >
                        {code.toUpperCase()}
                    </a>
                </>
            ))}
            {' — '}
            <span data-testid="current-locale">{t.currentLocale({ locale: i18n.locale })}</span>
        </p>
    );
});

export const App = component<{ url: string }>((ctx) => {
    const t = useTranslation('page');

    return () => (
        <main>
            <h1 data-testid="title">{t.title()}</h1>
            <p class="hint">{t.intro()}</p>

            <div class="card">
                <h3>{t.switchHeading()}</h3>
                <p class="hint">{t.switchHint()}</p>
                <LocaleSwitch url={ctx.props.url} />
            </div>

            <div class="card">
                <Blurb
                    heading={t.staticHeading()}
                    hint={t.staticHint()}
                    body={t.staticBody({ credits: DEMO.credits, updated: DEMO.updatedAt })}
                />
            </div>

            <div class="card">
                <h3>{t.counterHeading()}</h3>
                <p class="hint">{t.counterHint()}</p>
                <Counter />
            </div>

            <div class="card">
                <h3>{t.serverFnHeading()}</h3>
                <p class="hint">{t.serverFnHint()}</p>
                {/* The button label doesn't depend on client state, so it is
                    translated HERE and travels as a serialized prop — the
                    boundary never needs a translator of its own. */}
                <ServerGreeting label={t.askServer()} />
            </div>

            <p class="hint">{t.footer()}</p>
        </main>
    );
});
