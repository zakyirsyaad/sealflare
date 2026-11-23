import { describe, expect, test } from 'vitest'
import { decodeText, excerptAt, lineOf } from '../src/skill/text'

describe('decodeText', () => {
  test('decodeText returns null for bytes that are not UTF-8', () => {
    expect(decodeText(new Uint8Array([0xff, 0xfe]))).toBeNull()
    expect(decodeText(new Uint8Array([0xc0, 0x80]))).toBeNull()
    expect(decodeText(new Uint8Array([0xe2, 0x82]))).toBeNull()
  })

  test('decodeText returns the text for valid UTF-8, including empty input', () => {
    expect(decodeText(new TextEncoder().encode('hello'))).toBe('hello')
    expect(decodeText(new Uint8Array([]))).toBe('')
  })

  test('decodeText keeps a leading BOM as a visible character', () => {
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toBe('\uFEFFa')
  })
})

describe('lineOf and excerptAt', () => {
  test.each([['LF', '\n'], ['CRLF', '\r\n'], ['CR', '\r']])(
    'recognizes %s without counting the separator as a new line',
    (_name, separator) => {
      const text = `first${separator}second${separator}`
      const second = text.indexOf('second')
      expect(lineOf(text, second)).toBe(2)
      expect(excerptAt(text, second, 6)).toBe('second')
      for (let index = 5; index < second; index += 1) {
        expect(lineOf(text, index)).toBe(1)
        expect(excerptAt(text, index, 1)).toBe('first')
      }
      expect(lineOf(text, text.length)).toBe(3)
      expect(excerptAt(text, text.length, 0)).toBe('')
    },
  )

  test('lineOf and excerptAt point at the right line and never span lines', () => {
    const text = 'a\nbb MAX\ncc'
    expect(lineOf(text, text.indexOf('MAX'))).toBe(2)
    expect(excerptAt(text, text.indexOf('MAX'), 3)).toBe('bb MAX')
  })

  test('excerptAt keeps a long line under 160 characters', () => {
    expect(excerptAt('x'.repeat(1000), 500, 3).length).toBeLessThanOrEqual(160)
  })

  test('lineOf starts at 1 and stays within the text', () => {
    const text = 'a\nbb MAX\ncc'
    expect(lineOf(text, 0)).toBe(1)
    expect(lineOf(text, text.length)).toBe(3)
    expect(lineOf(text, -5)).toBe(1)
  })

  test('excerptAt on a long line still shows the match', () => {
    const text = `${'x'.repeat(500)}MAX${'y'.repeat(500)}`
    const excerpt = excerptAt(text, 500, 3)
    expect(excerpt).toContain('MAX')
    expect(excerpt.length).toBeLessThanOrEqual(160)
    expect(excerpt).not.toContain('\n')
  })
})
