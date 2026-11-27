import { beforeEach, expect, test, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mnemonicToAccount, privateKeyToAccount } from 'viem/accounts'
import { getContractAddress, toHex, type Hex } from 'viem'
import { canonicalBundleHash, targetIdOfContract, targetIdOfSkill } from '@sealflare/shared/rules'
import { ScanReport } from '@sealflare/shared/schemas'
import { copy } from '../lib/copy'
import { shortAddress } from '../lib/format'
import { bindTypedData, decodeRequest, encodeRequest, type BindRequest } from '../lib/publish/request'
import { findDeployNonce } from '../lib/publish/deployNonce'
import { decodeOwner } from '../lib/publish/owner'

const me = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const owner = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
const target = '0x60b9262456de011f7d15a54cdd8c48baaa8b022f'
const core = '0x5FbDB2315678afecb367f032d93F642f64180aa3'
const vault = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512'
// Keys of Anvil's public development mnemonic, derived here so no raw private key sits in the repository.
const ANVIL_MNEMONIC = 'test test test test test test test test test test test junk'
function anvilKey(addressIndex: number): Hex {
  const key = mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex }).getHdKey().privateKey
  if (key === null) throw new Error('The development account has no private key.')
  return toHex(key)
}
const ownerSigner = anvilKey(2)
const otherSigner = anvilKey(0)

const mocks = vi.hoisted(() => ({
  user: { kind: 'holder', address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', isLoading: false, isError: false, recheck: () => {} },
  ownerState: { status: 'owner', owner: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' } as { status: string; owner: string | null },
  targetRead: { publisherRole: 0, createdAt: 1_700_000_000 },
  nonce: 7n,
  findNonce: (async () => 3n) as (deployer: string, contract: string) => Promise<bigint | null>,
  signerHasCode: false,
  modulesLive: true,
  receipt: { status: 'success' },
  sign: vi.fn(),
  write: vi.fn(),
  scanSkill: vi.fn(),
  connection: { address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', isConnected: true, chainId: 56 },
}))

vi.mock('../lib/chain/userState', () => ({ useUserState: () => mocks.user }))
vi.mock('../lib/chain/config', () => ({
  get expectedChainId() {
    return 56
  },
  get modulesLive() {
    return mocks.modulesLive
  },
  agentIdUrl: 'https://agent-id.example/get',
}))
vi.mock('../lib/chain/addresses', () => ({
  addresses: () => ({ agentId: me, core, court: null, vault }),
  coreAddress: () => core,
  vaultAddress: () => vault,
  requireCoreAddress: () => core,
  coreAddressOrError: () => ({ core, error: null }),
}))
vi.mock('../lib/publish/useChainReads', () => ({
  useContractOwner: () => mocks.ownerState,
  useDeployNonceFinder: () => mocks.findNonce,
  useHasCode: () => mocks.signerHasCode,
}))
vi.mock('../lib/api/client', () => ({
  api: {
    scanSkill: (...args: unknown[]) => mocks.scanSkill(...args),
    scanContract: vi.fn(),
  },
}))
vi.mock('wagmi', () => ({
  useReadContract: (args: { functionName: string }) => {
    if (args.functionName === 'getTarget') return { data: mocks.targetRead }
    if (args.functionName === 'bindNonce') return { data: mocks.nonce }
    return { data: undefined }
  },
  usePublicClient: () => ({
    waitForTransactionReceipt: async () => ({ status: mocks.receipt.status }),
  }),
  useSignTypedData: () => ({ mutateAsync: mocks.sign }),
  useWriteContract: () => ({ mutateAsync: mocks.write }),
  useConnection: () => mocks.connection,
  useSwitchChain: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}))

import PublishPage from '../app/app/publish/page'
import SignRequestPage, { refusalReason } from '../app/app/publish/sign/[request]/page'

function shareLink(container: HTMLElement): string {
  const node = container.querySelector('.sf-share__link')
  if (node === null) throw new Error('The share link is not on the page.')
  return node.textContent ?? ''
}

function requestOf(container: HTMLElement): BindRequest {
  const link = shareLink(container)
  const fragment = link.slice(link.indexOf('#') + 1)
  const request = decodeRequest(fragment)
  if (request === null) throw new Error('The share link does not carry a request.')
  return request
}

async function signRequest(request: BindRequest, key: string): Promise<Hex> {
  const account = privateKeyToAccount(key as `0x${string}`)
  const typed = bindTypedData(request)
  return account.signTypedData({
    domain: typed.domain,
    types: typed.types,
    primaryType: typed.primaryType,
    message: typed.message,
  })
}

async function checkOwnership(address: string = target) {
  await userEvent.type(screen.getByLabelText(copy.publish.addressLabel), address)
  await userEvent.click(screen.getByRole('button', { name: copy.publish.checkOwnership }))
}

/** A signature is pasted, not typed, so the whole text arrives at once. */
async function pasteSignature(signature: string) {
  const field = screen.getByLabelText(copy.publish.pasteSignatureLabel)
  await userEvent.click(field)
  await userEvent.paste(signature)
}

/** The connected wallet is the owner, so it signs once and the binding is one transaction. */
async function bindAsOwner() {
  mocks.ownerState = { status: 'owner', owner: me }
  await checkOwnership()
  await userEvent.click(screen.getByRole('button', { name: copy.publish.proveOwnership }))
  await userEvent.click(screen.getByRole('button', { name: copy.publish.signAndBind }))
  await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1))
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.user = { kind: 'holder', address: me, isLoading: false, isError: false, recheck: () => {} }
  mocks.ownerState = { status: 'owner', owner }
  mocks.targetRead = { publisherRole: 0, createdAt: 1_700_000_000 }
  mocks.nonce = 7n
  mocks.findNonce = async () => 3n
  mocks.signerHasCode = false
  mocks.modulesLive = true
  mocks.receipt = { status: 'success' }
  mocks.connection = { address: me, isConnected: true, chainId: 56 }
  mocks.sign.mockResolvedValue(`0x${'11'.repeat(65)}` as Hex)
  mocks.write.mockResolvedValue(`0x${'22'.repeat(32)}` as Hex)
})

test('Publish needs an Agent ID, not just a wallet', () => {
  mocks.user = { kind: 'no-agent-id', address: me, isLoading: false, isError: false, recheck: () => {} }
  render(<PublishPage />)
  expect(screen.getByText(copy.wallet.agentRequired)).toBeVisible()
  expect(screen.queryByLabelText(copy.publish.addressLabel)).toBeNull()
})

test('an owner who is the connected wallet signs once and binds in one transaction', async () => {
  mocks.ownerState = { status: 'owner', owner: me }
  render(<PublishPage />)
  await checkOwnership()
  await userEvent.click(screen.getByRole('button', { name: copy.publish.proveOwnership }))
  await userEvent.click(screen.getByRole('button', { name: copy.publish.signAndBind }))
  await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1))
  expect(mocks.sign).toHaveBeenCalledTimes(1)
  const call = mocks.write.mock.calls[0]![0]
  expect(call.functionName).toBe('bindByOwner')
  expect(call.args[0]).toBe(target)
  expect(call.args[1]).toBe(me)
})

test('an owner on another wallet gets a share link valid for 24 hours and a "Paste signature" field', async () => {
  const { container } = render(<PublishPage />)
  await checkOwnership()
  await userEvent.click(screen.getByRole('button', { name: copy.publish.proveOwnership }))
  expect(screen.getByLabelText(copy.publish.pasteSignatureLabel)).toBeInTheDocument()
  expect(screen.getByText(copy.publish.shareValid)).toBeInTheDocument()
  const request = requestOf(container)
  const seconds = Number(request.deadline) - Math.floor(Date.now() / 1000)
  expect(seconds).toBeGreaterThan(24 * 60 * 60 - 60)
  expect(seconds).toBeLessThanOrEqual(24 * 60 * 60)
})

test('the signed message carries the current bindNonce of the target', async () => {
  const { container } = render(<PublishPage />)
  await checkOwnership()
  await userEvent.click(screen.getByRole('button', { name: copy.publish.proveOwnership }))
  expect(requestOf(container).bindNonce).toBe('7')
  mocks.ownerState = { status: 'owner', owner: me }
  const request = requestOf(container)
  expect(bindTypedData(request).message.bindNonce).toBe(7n)
})

test('a pasted signature is verified locally before the transaction is offered', async () => {
  const { container } = render(<PublishPage />)
  await checkOwnership()
  await userEvent.click(screen.getByRole('button', { name: copy.publish.proveOwnership }))
  const request = requestOf(container)
  const foreign = await signRequest(request, otherSigner)
  await pasteSignature(foreign)
  expect(await screen.findByText(copy.publish.signatureWrongSigner)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: copy.publish.bindAsPublisher })).toBeDisabled()
  const good = await signRequest(request, ownerSigner)
  await userEvent.clear(screen.getByLabelText(copy.publish.pasteSignatureLabel))
  await pasteSignature(good)
  await waitFor(() => expect(screen.getByRole('button', { name: copy.publish.bindAsPublisher })).toBeEnabled())
  await userEvent.click(screen.getByRole('button', { name: copy.publish.bindAsPublisher }))
  await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1))
  expect(mocks.write.mock.calls[0]![0].args[3]).toBe(good)
})

test('a contract with no owner asks for the deployer and finds the matching nonce', async () => {
  mocks.ownerState = { status: 'none', owner: null }
  render(<PublishPage />)
  await checkOwnership()
  expect(screen.getByText(copy.publish.noOwner)).toBeVisible()
  await userEvent.type(screen.getByLabelText(copy.publish.deployerLabel), me)
  await userEvent.click(screen.getByRole('button', { name: copy.publish.findNonce }))
  await userEvent.click(screen.getByRole('button', { name: copy.publish.proveOwnership }))
  await userEvent.click(screen.getByRole('button', { name: copy.publish.signAndBind }))
  await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1))
  const call = mocks.write.mock.calls[0]![0]
  expect(call.functionName).toBe('bindByDeployer')
  expect(call.args[1]).toBe(me.toLowerCase())
  expect(call.args[2]).toEqual(3n)
})

test('a skill binds only when the manifest publisher equals the connected wallet; otherwise it explains why', async () => {
  const contentHash = `0x${'55'.repeat(32)}` as Hex
  const bundle = canonicalBundleHash(contentHash, me)
  const report = ScanReport.parse({
    schemaVersion: 1,
    targetType: 'AI_SKILL_BUNDLE',
    targetId: targetIdOfSkill(bundle),
    source: {
      kind: 'skill',
      repo: 'sealflare/guard',
      commit: 'a'.repeat(40),
      path: 'skills/guard',
      contentHash,
      manifestPublisher: me,
      canonicalBundleHash: bundle,
      fileCount: 3,
      totalBytes: 2048,
    },
    scannedAt: '2026-11-25T03:00:00.000Z',
    checks: [{ id: 'bundle_hash', status: 'passed' }],
    findings: [],
    flags: 0,
    suggestedVerdict: null,
  })
  mocks.scanSkill.mockResolvedValue(report)
  render(<PublishPage />)
  await userEvent.click(screen.getByRole('button', { name: copy.publish.kindSkill }))
  await userEvent.type(screen.getByLabelText(copy.publish.repoLabel), 'https://github.com/sealflare/guard')
  await userEvent.click(screen.getByRole('button', { name: copy.publish.scanRepo }))
  expect(await screen.findByText(copy.publish.manifestMatch)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: copy.publish.bindSkill }))
  await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1))
  expect(mocks.write.mock.calls[0]![0].functionName).toBe('bindSkill')
  expect(mocks.write.mock.calls[0]![0].args[0]).toBe(contentHash)
})

test('a skill whose manifest names another wallet is not claimed, and the reason is given', async () => {
  const contentHash = `0x${'55'.repeat(32)}` as Hex
  const bundle = canonicalBundleHash(contentHash, owner)
  mocks.scanSkill.mockResolvedValue(
    ScanReport.parse({
      schemaVersion: 1,
      targetType: 'AI_SKILL_BUNDLE',
      targetId: targetIdOfSkill(bundle),
      source: {
        kind: 'skill',
        repo: 'sealflare/guard',
        commit: 'a'.repeat(40),
        path: 'skills/guard',
        contentHash,
        manifestPublisher: owner,
        canonicalBundleHash: bundle,
        fileCount: 3,
        totalBytes: 2048,
      },
      scannedAt: '2026-11-25T03:00:00.000Z',
      checks: [{ id: 'bundle_hash', status: 'passed' }],
      findings: [],
      flags: 0,
      suggestedVerdict: null,
    }),
  )
  render(<PublishPage />)
  await userEvent.click(screen.getByRole('button', { name: copy.publish.kindSkill }))
  await userEvent.type(screen.getByLabelText(copy.publish.repoLabel), 'https://github.com/sealflare/guard')
  await userEvent.click(screen.getByRole('button', { name: copy.publish.scanRepo }))
  expect(await screen.findByText(/names .* as its publisher/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: copy.publish.bindSkill })).toBeNull()
  expect(screen.getByRole('button', { name: copy.publish.becomeSponsor })).toBeInTheDocument()
})

test('a target that cannot be proven offers the sponsor role', async () => {
  mocks.ownerState = { status: 'none', owner: null }
  render(<PublishPage />)
  await checkOwnership()
  expect(screen.getByText(copy.publish.sponsorExplain)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: copy.publish.becomeSponsor }))
  await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1))
  expect(mocks.write.mock.calls[0]![0].functionName).toBe('sponsor')
})

test('a target that already has a publisher says "This target already has a publisher."', async () => {
  mocks.targetRead = { publisherRole: 2, createdAt: 1_700_000_000 }
  render(<PublishPage />)
  await checkOwnership()
  expect(screen.getByRole('status')).toHaveTextContent('This target already has a publisher.')
  expect(screen.queryByRole('button', { name: copy.publish.becomeSponsor })).toBeNull()
})

test('the bond step states the 0.5 BNB cap, the 7 day wait, that it can still be cut, and the half cut', async () => {
  render(<PublishPage />)
  await bindAsOwner()
  const text = screen.getByText(/Up to 0\.5 BNB\./).textContent ?? ''
  expect(text).toContain('It takes 7 days to withdraw')
  expect(text).toContain('can still be cut during that time')
  expect(text).toContain('Half is cut if a challenge proves a violation.')
  expect(screen.getByText(copy.publish.bondWindow.replace('{hours}', '12'))).toBeInTheDocument()
})

test('the bond step can be skipped', async () => {
  render(<PublishPage />)
  await bindAsOwner()
  await userEvent.click(screen.getByRole('button', { name: copy.publish.bondSkip }))
  expect(screen.getByLabelText(copy.publish.badgeTitle)).toBeInTheDocument()
})

test('the badge snippet links to /app/t/[id], never to the landing page', async () => {
  render(<PublishPage />)
  await bindAsOwner()
  await userEvent.click(screen.getByRole('button', { name: copy.publish.bondSkip }))
  const snippet = screen.getByLabelText(copy.publish.badgeTitle).textContent ?? ''
  expect(snippet).toContain(`/app/t/${targetIdOfContract(target as `0x${string}`)}`)
  expect(snippet).not.toContain('](/)')
})

test('the request of the share link is never sent to the server', async () => {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  const { container } = render(<PublishPage />)
  await checkOwnership()
  await userEvent.click(screen.getByRole('button', { name: copy.publish.proveOwnership }))
  const link = shareLink(container)
  expect(link).toContain('#')
  expect(fetchMock).not.toHaveBeenCalled()
  vi.unstubAllGlobals()
})

test('a request that is not a request is refused', () => {
  expect(decodeRequest('not-a-request')).toBeNull()
})

test('a request survives the round trip through the fragment', () => {
  const request: BindRequest = {
    v: 1,
    kind: 'owner',
    chainId: 56,
    core: core as `0x${string}`,
    target: target as `0x${string}`,
    agentIdHolder: me as `0x${string}`,
    bindNonce: '7',
    deadline: '1800000000',
    owner: owner as `0x${string}`,
  }
  expect(decodeRequest(encodeRequest(request))).toEqual({
    ...request,
    core: core.toLowerCase(),
    target: target.toLowerCase(),
    agentIdHolder: me.toLowerCase(),
    owner: owner.toLowerCase(),
  })
})

test('the deployment nonce is found by recreating the address of the deployer', async () => {
  const deployer = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as `0x${string}`
  const contract = getContractAddress({ from: deployer, nonce: 5n })
  await expect(findDeployNonce(deployer, contract, 10)).resolves.toEqual(5n)
})

test('a deployer whose only transaction made the contract is found at nonce 0', async () => {
  const deployer = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as `0x${string}`
  const contract = getContractAddress({ from: deployer, nonce: 0n })
  await expect(findDeployNonce(deployer, contract, 1)).resolves.toEqual(0n)
})

const requestForSigning: BindRequest = {
  v: 1,
  kind: 'owner',
  chainId: 56,
  core: core as `0x${string}`,
  target: target as `0x${string}`,
  agentIdHolder: me as `0x${string}`,
  bindNonce: '7',
  deadline: '1800000000',
  owner: owner as `0x${string}`,
}

test('the sign page reads the request from the fragment and sends it nowhere', async () => {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  window.location.hash = `#${encodeRequest(requestForSigning)}`
  render(<SignRequestPage />)
  expect(await screen.findByText(copy.publish.requestTitle)).toBeInTheDocument()
  expect(screen.getByText(shortAddress(target))).toBeInTheDocument()
  expect(fetchMock).not.toHaveBeenCalled()
  window.location.hash = ''
  vi.unstubAllGlobals()
})

test('the sign page refuses a request that another wallet has to sign', async () => {
  window.location.hash = `#${encodeRequest(requestForSigning)}`
  render(<SignRequestPage />)
  expect(await screen.findByRole('alert')).toHaveTextContent(copy.publish.requestWrongSigner)
  window.location.hash = ''
})

test('a text that is not a signature never enables the bind button', async () => {
  render(<PublishPage />)
  await checkOwnership()
  await userEvent.click(screen.getByRole('button', { name: copy.publish.proveOwnership }))
  await pasteSignature('0xdead')
  expect(await screen.findByText(copy.publish.signatureInvalid)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: copy.publish.bindAsPublisher })).toBeDisabled()
  expect(mocks.write).not.toHaveBeenCalled()
})

test('a write that the chain did not accept is not a success', async () => {
  mocks.receipt = { status: 'reverted' }
  mocks.ownerState = { status: 'owner', owner: me }
  render(<PublishPage />)
  await checkOwnership()
  await userEvent.click(screen.getByRole('button', { name: copy.publish.proveOwnership }))
  await userEvent.click(screen.getByRole('button', { name: copy.publish.signAndBind }))
  expect(await screen.findByText(copy.errors.txReverted)).toBeInTheDocument()
  expect(screen.queryByLabelText(copy.publish.badgeTitle)).toBeNull()
})

test('a deployer that does not match the contract says so', async () => {
  mocks.ownerState = { status: 'none', owner: null }
  mocks.findNonce = async () => null
  render(<PublishPage />)
  await checkOwnership()
  await userEvent.type(screen.getByLabelText(copy.publish.deployerLabel), me)
  await userEvent.click(screen.getByRole('button', { name: copy.publish.findNonce }))
  expect(await screen.findByText(copy.publish.deployerMismatch)).toBeInTheDocument()
  expect(mocks.write).not.toHaveBeenCalled()
})

test('with the modules off the bond is disabled with the fixed sentence and the badge still comes', async () => {
  mocks.modulesLive = false
  render(<PublishPage />)
  await bindAsOwner()
  expect(screen.getByRole('button', { name: copy.publish.deposit })).toBeDisabled()
  expect(screen.getByText(copy.common.modulesNotLive)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: copy.publish.bondSkip }))
  expect(screen.getByLabelText(copy.publish.badgeTitle)).toBeInTheDocument()
})

test('the sign page refuses a request whose nonce is no longer the current one', async () => {
  mocks.nonce = 8n
  window.location.hash = `#${encodeRequest(requestForSigning)}`
  render(<SignRequestPage />)
  expect(await screen.findByRole('alert')).toHaveTextContent(copy.publish.requestStale)
  window.location.hash = ''
})

test('the sign page refuses a request made for another chain than the one of the app', async () => {
  window.location.hash = `#${encodeRequest({ ...requestForSigning, chainId: 97 })}`
  render(<SignRequestPage />)
  expect(await screen.findByRole('alert')).toHaveTextContent(copy.publish.requestWrongChain)
  window.location.hash = ''
})

test('a visitor without a wallet is asked to connect, not told that the link is broken', async () => {
  mocks.connection = { address: undefined as never, isConnected: false, chainId: undefined as never }
  window.location.hash = `#${encodeRequest(requestForSigning)}`
  render(<SignRequestPage />)
  expect(await screen.findByRole('alert')).toHaveTextContent(copy.wallet.connectTitle)
  expect(screen.queryByText(copy.publish.requestWrongChain)).toBeNull()
  window.location.hash = ''
})

test('a wallet on another network is told so and can switch', async () => {
  mocks.connection = { address: me, isConnected: true, chainId: 97 }
  window.location.hash = `#${encodeRequest(requestForSigning)}`
  render(<SignRequestPage />)
  expect(await screen.findByRole('alert')).toHaveTextContent(copy.publish.walletWrongChain)
  expect(screen.getByRole('button', { name: /^Switch to / })).toBeEnabled()
  expect(screen.queryByRole('button', { name: copy.publish.requestSign })).toBeNull()
  window.location.hash = ''
})

test('a link for another chain is refused even before a wallet is connected', async () => {
  mocks.connection = { address: undefined as never, isConnected: false, chainId: undefined as never }
  window.location.hash = `#${encodeRequest({ ...requestForSigning, chainId: 97 })}`
  render(<SignRequestPage />)
  expect(await screen.findByRole('alert')).toHaveTextContent(copy.publish.requestWrongChain)
  window.location.hash = ''
})

test('a request is refused when the Core address of the app is unknown', () => {
  expect(refusalReason(requestForSigning, me, 56, null, 0)).toBe(copy.publish.requestWrongCore)
})

test('a request with a deadline too large to show is not a request', () => {
  expect(decodeRequest(encodeRequest({ ...requestForSigning, deadline: '9'.repeat(30) }))).toBeNull()
})

test('a 65 byte signature is left to the chain when the signer is a contract wallet', async () => {
  mocks.signerHasCode = true
  const { container } = render(<PublishPage />)
  await checkOwnership()
  await userEvent.click(screen.getByRole('button', { name: copy.publish.proveOwnership }))
  const safeSignature = await signRequest(requestOf(container), otherSigner)
  await pasteSignature(safeSignature)
  await waitFor(() => expect(screen.getByRole('button', { name: copy.publish.bindAsPublisher })).toBeEnabled())
  expect(screen.getByText(copy.publish.signatureOnChain)).toBeInTheDocument()
  expect(screen.queryByText(copy.publish.signatureWrongSigner)).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: copy.publish.bindAsPublisher }))
  await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1))
  expect(mocks.write.mock.calls[0]![0].args[3]).toBe(safeSignature)
})

test('an owner answer must be exactly one clean address word', () => {
  const word = (address: string) => `0x${'00'.repeat(12)}${address.slice(2).toLowerCase()}`
  expect(decodeOwner(word(owner))).toBe(owner)
  expect(decodeOwner(`${word(owner)}${'00'.repeat(32)}`)).toBeNull()
  expect(decodeOwner(`0xff${'00'.repeat(11)}${owner.slice(2).toLowerCase()}`)).toBeNull()
  expect(decodeOwner(word('0x0000000000000000000000000000000000000000'))).toBeNull()
  expect(decodeOwner('0x')).toBeNull()
})
