import { z } from 'zod'
import type { Address } from 'viem'
import { EIP712 } from '@sealflare/shared/abi'
import { AddressSchema, UintStringSchema } from '@sealflare/shared/schemas'

/**
 * A publish request is a message the owner or the deployer of a contract signs to name an Agent ID
 * holder as the publisher. The request travels in the fragment of the share link, so the server
 * never stores it and never receives it.
 */

/** A share request stays valid for 24 hours, as the Publish screen says. */
export const REQUEST_VALIDITY_SECONDS = 24 * 60 * 60

export const BindKindSchema = z.enum(['owner', 'deployer'])
export type BindKind = z.infer<typeof BindKindSchema>

const baseRequest = {
  v: z.literal(1),
  chainId: z.number().int().positive(),
  /** The Core contract the signature is verified against. */
  core: AddressSchema,
  target: AddressSchema,
  agentIdHolder: AddressSchema,
  /** The nonce the target had when the request was made. Every binding consumes it. */
  bindNonce: UintStringSchema,
  deadline: UintStringSchema,
}

/** The owner of the contract signs for it. */
const ownerRequest = z.object({
  ...baseRequest,
  kind: z.literal('owner'),
  /** The wallet that reported itself as the owner of the contract. */
  owner: AddressSchema,
})

/** The deployer of a contract without an owner signs for it. */
const deployerRequest = z.object({
  ...baseRequest,
  kind: z.literal('deployer'),
  deployer: AddressSchema,
  deployNonce: UintStringSchema,
})

/** Every request names the wallet that has to sign it. */
export const BindRequestSchema = z.union([ownerRequest, deployerRequest])

export type BindRequest = z.infer<typeof BindRequestSchema>

/** A request the owner of the contract has to sign. */
export type OwnerBindRequest = Extract<BindRequest, { kind: 'owner' }>

/** A request the deployer of the contract has to sign. */
export type DeployerBindRequest = Extract<BindRequest, { kind: 'deployer' }>

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}

/** The fragment of the share link. It holds the message and nothing else. */
export function encodeRequest(request: BindRequest): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(request)))
}

/** Reads the request out of a fragment. Anything that is not a request is refused. */
export function decodeRequest(fragment: string): BindRequest | null {
  try {
    const parsed = BindRequestSchema.safeParse(JSON.parse(new TextDecoder().decode(fromBase64Url(fragment))))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** The EIP-712 message the owner or the deployer signs. It mirrors BindTypes in the contracts. */
export function bindTypedData(request: BindRequest) {
  const domain = {
    name: EIP712.domain.name,
    version: EIP712.domain.version,
    chainId: request.chainId,
    verifyingContract: request.core,
  }
  const common = {
    target: request.target,
    agentIdHolder: request.agentIdHolder,
    bindNonce: BigInt(request.bindNonce),
    deadline: BigInt(request.deadline),
  }
  if (request.kind === 'owner') {
    return {
      domain,
      primaryType: 'BindByOwner' as const,
      types: { BindByOwner: [...EIP712.types.BindByOwner] },
      message: common,
    }
  }
  return {
    domain,
    primaryType: 'BindByDeployer' as const,
    types: { BindByDeployer: [...EIP712.types.BindByDeployer] },
    message: {
      ...common,
      deployer: request.deployer,
      deployNonce: BigInt(request.deployNonce),
    },
  }
}

/** The wallet that has to sign the request: the owner, or the deployer. */
export function signerOf(request: BindRequest): Address {
  return request.kind === 'owner' ? request.owner : request.deployer
}

/**
 * An opaque id for the share link. It says nothing about the request, so the path of the link
 * names no target, no holder and no nonce.
 */
export function requestId(): string {
  const bytes = new Uint8Array(16)
  const source = globalThis.crypto
  if (source !== undefined && typeof source.getRandomValues === 'function') source.getRandomValues(bytes)
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256)
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
