import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { parseTrustProxy } from '../../src/lib/trustProxy';

describe('parseTrustProxy', () => {
  it('trusts nothing when unset or empty', () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy('')).toBe(false);
    expect(parseTrustProxy('   ')).toBe(false);
  });

  it('reads a whole number as a hop count', () => {
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy(' 2 ')).toBe(2);
  });

  it('refuses a hop count of zero', () => {
    expect(() => parseTrustProxy('0')).toThrow();
  });

  it('reads a list of addresses, subnets and names', () => {
    expect(parseTrustProxy('loopback')).toBe('loopback');
    expect(parseTrustProxy('10.0.0.0/8, 192.168.1.5')).toBe('10.0.0.0/8,192.168.1.5');
  });

  it.each(['true', 'TRUE', 'false', '*', 'all', '0.0.0.0/0', '::/0', 'loopback,,10.0.0.1'])(
    'refuses %s',
    (value) => {
      expect(() => parseTrustProxy(value)).toThrow();
    },
  );
});

// What the parsed value does to req.ip in Express itself. supertest connects
// from loopback, so 'loopback' is the proxy here.
describe('trust proxy setting', () => {
  const ipWith = async (raw: string | undefined, forwardedFor: string): Promise<string> => {
    const app = express();
    app.set('trust proxy', parseTrustProxy(raw));
    app.get('/', (req, res) => {
      res.json({ ip: req.ip });
    });
    const res = await request(app).get('/').set('X-Forwarded-For', forwardedFor);
    return res.body.ip;
  };

  it('ignores X-Forwarded-For when unset', async () => {
    expect(await ipWith(undefined, '203.0.113.7')).not.toBe('203.0.113.7');
  });

  it('takes the client from a trusted proxy', async () => {
    expect(await ipWith('loopback', '203.0.113.7')).toBe('203.0.113.7');
    expect(await ipWith('1', '203.0.113.7')).toBe('203.0.113.7');
  });

  it('does not believe an address the client put in front of the real one', async () => {
    expect(await ipWith('1', '198.51.100.99, 203.0.113.7')).toBe('203.0.113.7');
  });

  it('ignores X-Forwarded-For from an address that is not the proxy', async () => {
    expect(await ipWith('10.0.0.0/8', '203.0.113.7')).not.toBe('203.0.113.7');
  });

  it('throws on an address Express cannot read', () => {
    const app = express();
    expect(() => app.set('trust proxy', parseTrustProxy('not-an-address'))).toThrow();
  });
});
