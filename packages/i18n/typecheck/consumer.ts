/**
 * Compile-time fixture proving the generated `Schema` types enforce real keys,
 * locales, targets, and params. Compiled by `typecheck/tsconfig.json` with the
 * generated `i18n.gen.d.ts` (emitted by the typing test) present.
 *
 * Each `@ts-expect-error` MUST produce an error — if the typing regresses so the
 * bad usage becomes valid, the unused directive fails the compile, which fails
 * the test. Not part of the package build or the main typecheck.
 */
import { useTranslation, useDynamicTranslation, useLocale } from '@sigx/i18n';

// The generated fixture Schema declares namespace 'cart' with keys:
//   title (no params), hi ({ name }), items ({ count }); locales en|sv.
const t = useTranslation('cart');

// String-key form: valid keys + params.
t('title');
t('hi', { name: 'Sam' });
t('items', { count: 3 });

// @ts-expect-error unknown key is a compile error
t('does.not.exist');

// Nested accessor form: fully typed per key.
t.title(); // no-param leaf
t.hi({ name: 'Sam' }); // typed param
t.items({ count: 3 }); // typed param (plural)

// @ts-expect-error unknown nested key is a compile error
t.nope;
// @ts-expect-error `title` takes no params
t.title({ x: 1 });
// @ts-expect-error `hi` requires its `name` param
t.hi();

// @ts-expect-error unknown namespace is a compile error
useTranslation('no-such-namespace');

const loc = useLocale();
loc.setLocale('sv'); // valid locale
void loc.retry();
const err: unknown = loc.error?.error;
void err;

// @ts-expect-error unknown locale is a compile error
loc.setLocale('zz');

// ── Runtime-sourced namespace: narrowed namespace, open keys ─────────────────
// `content` is declared in `runtimeNamespaces`, so it IS a known namespace but
// its catalog does not exist at build time — any key must type-check.
declare const runtimeKey: string;
const rt = useTranslation('content');
rt(runtimeKey);
rt('anything.at.all', { count: 2 });

// The typed namespace next to it keeps the full literal key union.
// @ts-expect-error a runtime namespace must not loosen the static ones
t('does.not.exist.either');

// ── The untyped escape hatch, for a dynamic key in a TYPED namespace ─────────
const dyn = useDynamicTranslation('cart');
dyn(runtimeKey);
dyn(runtimeKey, { name: 'Sam' });
dyn(runtimeKey, undefined, { default: 'Author text' });
const present: boolean = dyn.exists(runtimeKey);
void present;

// The namespace itself is still checked — only the keys are open.
// @ts-expect-error unknown namespace is a compile error
useDynamicTranslation('no-such-namespace');
