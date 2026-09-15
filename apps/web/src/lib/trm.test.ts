/**
 * Tests for the TRM block (T024, HU-05).
 *
 * The done criterion is "the weekend state looks different from a working
 * day". Both fixtures below are the real ones T010 captured from the endpoint,
 * so the test is anchored to observed data rather than to invented dates.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bogotaToday, daysCovered, describeTrm, frozenNote } from './trm.ts';

/** Measured 2026-09-13 against datos.gov.co: a weekend record. */
const WEEKEND = { trm: 3109.3, trm_from: '2026-09-12', trm_to: '2026-09-14' };
/** And a working-day one, which is the contrast that makes the test mean something. */
const WEEKDAY = { trm: 3105.2, trm_from: '2026-09-11', trm_to: '2026-09-11' };

describe('the frozen indicator comes from the datum', () => {
  // There is no holiday calendar in this repository and there must not be one.
  // The record says how long it rules; T010 refused to infer it and so does this.

  it('counts a weekend record as three days', () => {
    assert.equal(daysCovered(WEEKEND.trm_from, WEEKEND.trm_to), 3);
  });

  it('counts a working day as one', () => {
    assert.equal(daysCovered(WEEKDAY.trm_from, WEEKDAY.trm_to), 1);
  });

  it('marks the weekend record frozen', () => {
    const display = describeTrm(WEEKEND, new Date('2026-09-13T15:00:00Z'));
    assert.equal(display.kind, 'current');
    assert.ok(display.kind === 'current');
    assert.equal(display.frozen, true);
    assert.equal(display.days, 3);
  });

  it('does NOT mark a working day frozen', () => {
    const display = describeTrm(WEEKDAY, new Date('2026-09-11T15:00:00Z'));
    assert.ok(display.kind === 'current');
    assert.equal(display.frozen, false);
  });

  it('the two states produce visibly different output — the criterion', () => {
    // A number with no explanation looks identical on a Saturday and a Tuesday.
    const weekend = describeTrm(WEEKEND, new Date('2026-09-13T15:00:00Z'));
    const weekday = describeTrm(WEEKDAY, new Date('2026-09-11T15:00:00Z'));

    const note = frozenNote(weekend);
    assert.ok(note !== undefined, 'the weekend must say something');
    assert.match(note, /3 días/);
    assert.match(note, /No es un dato viejo/);
    assert.equal(frozenNote(weekday), undefined, 'a working day must not');
  });
});

describe('which calendar day it is', () => {
  it('is a Colombian day, not a UTC one', () => {
    // 02:00Z on the 16th is still the 15th in Bogotá. Getting this wrong makes
    // the rate look expired for five hours every night.
    assert.equal(bogotaToday(new Date('2026-09-16T02:00:00Z')), '2026-09-15');
    assert.equal(bogotaToday(new Date('2026-09-16T06:00:00Z')), '2026-09-16');
  });

  it('a rate is still current at 02:00 UTC the day after its last day', () => {
    const display = describeTrm(WEEKDAY, new Date('2026-09-12T02:00:00Z'));
    assert.equal(display.kind, 'current', 'in Bogotá it is still the 11th');
  });
});

describe('three states, because two would hide one', () => {
  it('calls it stale once its last day has passed', () => {
    const display = describeTrm(WEEKDAY, new Date('2026-09-14T15:00:00Z'));
    assert.equal(display.kind, 'stale');
  });

  it('calls it missing when there is no rate at all', () => {
    // Not the same as a stale one, and a page that only asks "is there a
    // number?" shows them identically.
    assert.equal(describeTrm(undefined, new Date()).kind, 'missing');
    assert.equal(
      describeTrm({ trm: null, trm_from: null, trm_to: null }, new Date()).kind,
      'missing',
    );
  });

  it('treats a rate with no window as missing rather than guessing one', () => {
    assert.equal(
      describeTrm({ trm: 3109.3, trm_from: null, trm_to: null }, new Date()).kind,
      'missing',
    );
  });

  it('says nothing about freezing for a stale rate', () => {
    assert.equal(frozenNote(describeTrm(WEEKDAY, new Date('2026-09-14T15:00:00Z'))), undefined);
  });
});
