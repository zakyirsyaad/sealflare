'use client'
import type { Address, Hex } from 'viem'
import { PublisherBondWallet } from './PublisherBondWallet'
import { useUserState } from '../../lib/chain/userState'

export type PublisherBondPanelProps = {
  targetId: Hex
  publisher: Address | null
}

/**
 * The bond part of the Publisher tab. It only appears when a wallet is connected, so the page
 * never reaches for the chain on behalf of a visitor who has no wallet.
 */
export function PublisherBondPanel({ targetId, publisher }: PublisherBondPanelProps) {
  const user = useUserState()
  const address = 'address' in user ? user.address : null
  if (address === null) return null
  return <PublisherBondWallet targetId={targetId} publisher={publisher} address={address} />
}
