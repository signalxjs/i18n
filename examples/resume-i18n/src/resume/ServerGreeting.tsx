import { component } from 'sigx';
import { greet } from '../api.server';

/**
 * Rung 4: a server function that answers in the request's language.
 *
 * `greet` is a legal capture — in the browser it is a fetch stub, so the click
 * loads a tiny handler chunk and POSTs. The translation happens on the server,
 * over a namespace (`mail`) that is `serverOnly` and therefore not in the client
 * graph at all. The reply's language comes from the request, negotiated by
 * `createRequestT` exactly as the document render negotiated it.
 */
export const ServerGreeting = component<{ label: string }>((ctx) => {
    const reply = ctx.signal('');

    return () => (
        <p>
            <button
                onClick={async () => {
                    reply.value = await greet('Ada');
                }}
            >
                {ctx.props.label}
            </button>{' '}
            <em>{reply.value}</em>
        </p>
    );
});
