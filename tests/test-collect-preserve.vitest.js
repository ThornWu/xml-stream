import fs from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'
import XmlStream from '../lib/xml-stream'

describe('XmlStream', () => {
  it('should deal nicely with preserve and collect when reading from file', () => {
    return new Promise((resolve, reject) => {
      const stream = fs.createReadStream(path.resolve('./examples/collect-preserve.xml'))
      const fileExpected = fs.readFileSync(path.resolve('./tests/fixtures/collect-preserve.json'))
      const xml = new XmlStream(stream)
      const results = []

      xml.preserve('item', true)
      xml.collect('subitem')
      xml.on('endElement: item', (item) => {
        results.push(item)
      })

      xml.on('end', () => {
        const expected = JSON.parse(fileExpected)
        expect(results).toEqual(expected)
        resolve()
      })

      xml.on('error', (err) => {
        reject(err)
      })
    })
  })
})
