import { hashTypedData, recoverAddress, type Address, type Hex } from 'viem'
import { SignatureSchema } from '@sealflare/shared/schemas'
import { bindTypedData, signerOf, type BindRequest } from './request'

/**
 * The signer of a pasted signature, read locally. Nothing is sent anywhere: the wallet that has to
 * sign is known from the request, so the signature is checked against it before any transaction is
 * offered.
 */
export async function signerOfSignature(request: BindRequest, signature: Hex): Promise<Address | null> {
  try {
    const typed = bindTypedData(request)
    const hash = hashTypedData({
      domain: typed.domain,
      types: typed.types,
      primaryType: typed.primaryType,
      message: typed.message,
    })
    return await recoverAddress({ hash, signature })
  } catch {
    return null
  }
}

/** Whether a pasted signature was made by the wallet that has to sign the request. */
export async function signatureMatches(request: BindRequest, signature: Hex): Promise<boolean> {
  const signer = await signerOfSignature(request, signature)
  return signer !== null && signer.toLowerCase() === signerOf(request).toLowerCase()
}

/** Whether a signature is an ordinary wallet signature that can be checked without the chain. */
export function isPlainSignature(signature: Hex): boolean {
  return /^0x[0-9a-fA-F]{130}$/.test(signature)
}

/** Whether the text is a signature at all. The shape comes from the shared schemas. */
export function isHexSignature(value: string): boolean {
  return SignatureSchema.safeParse(value).success
}
