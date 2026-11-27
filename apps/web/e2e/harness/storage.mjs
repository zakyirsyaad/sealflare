// The storage of the evidence, for the end-to-end suite.
//
// The suite never reaches outside the machine, so the evidence of a vote is stored here instead of
// in a public IPFS service. The service answers the same shape the API of Pinata answers, so the
// app cannot tell the difference.

import { createHash } from 'node:crypto'
import { createServer } from 'node:http'

/**
 * Starts the storage and returns its address and the function that stops it.
 *
 * The hash of the bytes is the name of the file, so the same report always gets the same name.
 */
export async function startStorage() {
  const stored = new Map()
  const server = createServer((request, response) => {
    const chunks = []
    request.on('data', chunk => chunks.push(chunk))
    request.on('end', () => {
      const bytes = Buffer.concat(chunks)
      const hash = createHash('sha256').update(bytes).digest('hex')
      stored.set(hash, bytes.length)
      const body = JSON.stringify({ IpfsHash: hash, PinSize: bytes.length })
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(body)
    })
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  const url = `http://127.0.0.1:${port}/pinning/pinFileToIPFS`
  const stop = async () => {
    await new Promise(resolve => server.close(() => resolve(undefined)))
  }
  return { url, stop, stored }
}
