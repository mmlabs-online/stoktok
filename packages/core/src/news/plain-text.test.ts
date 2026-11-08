import { describe, expect, test } from 'vitest';
import { capText, toPlainText } from './plain-text';

describe('toPlainText', () => {
  test('strips tags and keeps text', () => {
    expect(toPlainText('<p>Giá <b>VNM</b> tăng</p><br/>mạnh')).toBe('Giá VNM tăng mạnh');
  });
  test('drops <script> and <style> content entirely (incl. uppercase, attributes, unclosed)', () => {
    expect(toPlainText('a<script>alert(1)</script>b')).toBe('a b');
    expect(toPlainText('a<SCRIPT type="x">alert(1)</SCRIPT >b')).toBe('a b');
    expect(toPlainText('a<style>p{color:red}</style>b')).toBe('a b');
    expect(toPlainText('a<script>alert(1)')).toBe('a');
    expect(toPlainText('a<script src="x" onload="y()">bad</script>b')).toBe('a b');
  });
  test('removes event handlers / javascript: hrefs with their tag', () => {
    const out = toPlainText('<a href="javascript:alert(1)" onclick="x()">click</a><img src=x onerror=alert(1)>');
    expect(out).toBe('click');
    expect(out).not.toMatch(/javascript|onerror|onclick/i);
  });
  test('quoted ">" inside an attribute does not end the tag early', () => {
    expect(toPlainText('<a title="a>b" href="x">ok</a>')).toBe('ok');
  });
  test('decodes entities once: &amp;lt;b&amp;gt; stays text, not a tag', () => {
    expect(toPlainText('&amp;lt;b&amp;gt;')).toBe('&lt;b&gt;');
    expect(toPlainText('&lt;b&gt;x')).toBe('<b>x');
  });
  test('Vietstock-style escaped markup after XML decode is stripped', () => {
    expect(toPlainText('<p><img src="https://x/y.jpg" /></p><p>Nội dung</p>')).toBe('Nội dung');
  });
  test('numeric and named entities (&#7889; &nbsp; &quot;)', () => {
    expect(toPlainText('&#7889; &#x1F600;&nbsp;&quot;a&quot; &unknown; &#1114112; &#55357;')).toBe('ố 😀 "a" &unknown;');
  });
  test('Latin-1 and typographic named entities decode (Ph&aacute;t -> Phát, &Ecirc; -> Ê, &ndash; -> –)', () => {
    expect(toPlainText('Ph&aacute;t &Ecirc; &ecirc; &Agrave;&agrave; a &ndash; b &hellip; &foo;')).toBe('Phát Ê ê Àà a – b … &foo;');
  });
  test('CDATA is unwrapped', () => {
    expect(toPlainText('<![CDATA[<p>Hello</p>]]>')).toBe('Hello');
  });
  test('broken / nested tags, stray "<" in text ("P/E < 10")', () => {
    expect(toPlainText('P/E < 10 và 5 > 3')).toBe('P/E < 10 và 5 > 3');
    expect(toPlainText('<<b>>x')).toBe('< >x');
    expect(toPlainText('ok <b unclosed')).toBe('ok');
    expect(toPlainText('a<!-- hidden -->b')).toBe('a b');
    expect(toPlainText('a<!-- never closed')).toBe('a');
  });
  test('strips control and zero-width chars, collapses whitespace, NFC-normalizes', () => {
    expect(toPlainText('a\u0000b​c‮d﻿  \n\t e')).toBe('abcd e');
    expect(toPlainText('é')).toBe('é');
  });
});

describe('capText', () => {
  test('cuts on a code point and never splits a surrogate pair', () => {
    expect(capText('abcdef', 3)).toBe('abc');
    expect(capText('a😀b', 2)).toBe('a😀');
    expect(capText('short', 10)).toBe('short');
  });
});
