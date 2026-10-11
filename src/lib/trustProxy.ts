// What Express's `trust proxy` setting is given, read from TRUST_PROXY.
//
// The setting decides whose X-Forwarded-For is believed, and so what `req.ip`
// is: the rate limiters count per `req.ip` and Morgan logs it. Trusting too
// little makes every client behind the proxy one address; trusting too much
// lets a client pick its own address with a header.
//
// - unset or empty: nothing is trusted, `req.ip` is the socket's address. Right
//   when the server is reached directly, as in development and tests.
// - a whole number of 1 or more: that many proxies in front of the server.
// - a comma-separated list of addresses, subnets or Express's names
//   (`loopback`, `linklocal`, `uniquelocal`): only those are proxies. Write an
//   IPv4 subnet as IPv4 (`10.0.0.0/8`), not in IPv4-mapped IPv6 form.
//
// A plain "trust everything" is refused on purpose: it believes whatever the
// client sends.
export type TrustProxy = false | number | string;

export function parseTrustProxy(raw: string | undefined): TrustProxy {
  const value = raw?.trim() ?? '';
  if (value === '') return false;

  if (/^\d+$/.test(value)) {
    const hops = Number(value);
    if (!Number.isSafeInteger(hops) || hops < 1) {
      throw new Error('TRUST_PROXY as a number must be 1 or more');
    }
    return hops;
  }

  const entries = value.split(',').map((entry) => entry.trim());
  for (const entry of entries) {
    if (entry === '') throw new Error('TRUST_PROXY has an empty entry');
    if (/^(true|false|\*|all)$/i.test(entry) || /\/0$/.test(entry)) {
      throw new Error(
        'TRUST_PROXY must name the proxies: a number of hops, or a list of addresses and subnets',
      );
    }
  }
  return entries.join(',');
}
