const fs = require('fs')
const path = require('path')
const { describe, it, expect } = require('@jest/globals')
const XmlStream = require('../lib/xml-stream')
const { Readable } = require('stream')

function createStream(data) {
  const rs = new Readable()
  rs.push(data)
  rs.push(null)
  return rs
}

describe('XmlStream', () => {
  const filename = path.resolve('./examples/collect-preserve.xml')
  const file = fs.readFileSync(filename, { encoding: 'utf8' })

  it('should deal with fake streams', () => {
    return new Promise((resolve, reject) => {
      const stream = createStream(file)
      const results = []
      const xml = new XmlStream(stream)

      xml.preserve('item', true)
      xml.collect('subitem')
      xml.on('endElement: item', (item) => {
        results.push(item)
      })

      xml.on('end', () => {
        expect(results.length).toBeGreaterThan(0)
        resolve()
      })

      xml.on('error', (err) => {
        reject(err)
      })
    })
  })
})
