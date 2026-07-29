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
import { createServerT } from '@sigx/i18n/server';

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

// …and neither may it loosen the NO-ARGUMENT form, whose NS defaults to the
// whole KnownNamespace union. If `KeysForNamespace` distributed over that union,
// the runtime member would contribute `string` and absorb it, switching off key
// checking project-wide the moment one namespace is declared runtime-sourced.
const dflt = useTranslation();
dflt('title'); // a statically-known key still resolves
// @ts-expect-error the no-arg form must still reject an unknown key
dflt('totally.made.up.key');

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

// ── The server gets the SAME typed surface ───────────────────────────────────
// This is the load-bearing half of the client/server streamline: a mail template
// is key-checked against the generated Schema exactly like a component, so
// renaming a key in the catalog fails the build instead of the email.
const server = createServerT({ catalogs: {}, fallbackLocale: 'en', defaultNamespace: 'cart' });
const sv = server.forLocale('sv');
const svLocale: string = sv.locale;
void svLocale;

const mail = sv.forNamespace('cart');
mail.title(); // no-param leaf, typed
mail.hi({ name: 'Sam' }); // typed param
mail.items({ count: 3 }); // typed param (plural)
mail('title'); // string-key form, key validated

// @ts-expect-error unknown key through the server proxy is a compile error
mail('does.not.exist');
// @ts-expect-error unknown nested key through the server proxy is a compile error
mail.nope;
// @ts-expect-error `title` takes no params, on the server too
mail.title({ x: 1 });
// @ts-expect-error unknown namespace is a compile error
sv.forNamespace('no-such-namespace');

// A runtime-sourced namespace stays open-keyed on the server as well.
sv.forNamespace('content')(runtimeKey);

// The server dynamic form mirrors `useDynamicTranslation`.
const serverDyn = sv.dynamic('cart');
serverDyn(runtimeKey, undefined, { default: 'Author text' });
const serverPresent: boolean = serverDyn.exists(runtimeKey);
void serverPresent;
// @ts-expect-error unknown namespace is a compile error for the dynamic form too
sv.dynamic('no-such-namespace');

// The unbound one-off call is open-keyed by design (no namespace bound) — but the
// NAMESPACE is still checked, the same rule the dynamic form follows. Only the
// locale stays open, because a server locale is negotiated from a request.
declare const negotiated: string;
server.t(runtimeKey, { name: 'Sam' }, { locale: negotiated, namespace: 'cart', default: 'Author text' });
const serverExists: boolean = server.exists(runtimeKey, { locale: 'sv', namespace: 'cart' });
void serverExists;

// @ts-expect-error an unknown namespace in the options bag is a compile error
server.t(runtimeKey, undefined, { namespace: 'no-such-namespace' });
// @ts-expect-error …on the unbound existence probe too
server.exists(runtimeKey, { namespace: 'no-such-namespace' });
// @ts-expect-error …and on the locale-bound one
sv.exists(runtimeKey, { namespace: 'no-such-namespace' });
// @ts-expect-error …and on the locale-bound t
sv.t(runtimeKey, undefined, { namespace: 'no-such-namespace' });
