/**
 * Compile-time fixture proving the generated `Schema` types enforce real keys,
 * locales, targets, and params. Compiled by `typecheck/tsconfig.json` with the
 * generated `i18n.gen.d.ts` (emitted by the typing test) present.
 *
 * Each `@ts-expect-error` MUST produce an error — if the typing regresses so the
 * bad usage becomes valid, the unused directive fails the compile, which fails
 * the test. Not part of the package build or the main typecheck.
 */
import { useTranslation, useLocale } from '@sigx/i18n';

// The generated fixture Schema declares namespace 'cart' with keys:
//   title (no params), hi ({ name }), items ({ count }); locales en|sv.
const t = useTranslation('cart');

// Valid keys + params.
t('title');
t('hi', { name: 'Sam' });
t('items', { count: 3 });

// @ts-expect-error unknown key is a compile error
t('does.not.exist');

// @ts-expect-error unknown namespace is a compile error
useTranslation('no-such-namespace');

const loc = useLocale();
loc.setLocale('sv'); // valid locale

// @ts-expect-error unknown locale is a compile error
loc.setLocale('zz');
