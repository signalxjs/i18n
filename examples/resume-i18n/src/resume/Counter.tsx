import { component } from 'sigx';
import { useTranslation } from '@sigx/i18n';
// Importing the config module is what makes this component upgradeable: its
// `provideI18nConfig()` side effect puts the config where an app-less client can
// find it. This import lives in THIS chunk, which loads only on upgrade.
import '../i18n';

/**
 * Rung 3: a translated boundary that genuinely needs i18n in the browser.
 *
 * The handler captures only `count` — a named signal — so the transform extracts
 * it into a QRL chunk and the first click runs without loading this file. The
 * label, though, is a PLURAL of the live count, so it cannot be pre-translated
 * into a prop: the first write upgrades this boundary, this chunk loads, setup
 * re-runs, and `useTranslation()` resolves against the seam config.
 *
 * The contrast with `<Blurb>` in App.tsx is the whole lesson: translated text
 * that doesn't depend on client state should be resolved in the render and cost
 * nothing, and only text that changes client-side pays for a chunk.
 */
export const Counter = component((ctx) => {
    const count = ctx.signal(0);
    const t = useTranslation('counter');

    return () => (
        <p>
            <button onClick={() => count.value++}>{t.hint()}</button>{' '}
            <strong>{t.label({ count: count.value })}</strong>
        </p>
    );
});
