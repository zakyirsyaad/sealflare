'use client'
import { useSwitchChain } from 'wagmi'
import { Button } from '../ui/Button'
import { expectedChainId } from '../../lib/chain/config'
import { copy } from '../../lib/copy'

export function WrongNetwork() {
  const { mutate, isPending } = useSwitchChain()
  return <Button disabled={isPending} onClick={() => mutate({ chainId: expectedChainId })}>{copy.wallet.switchNetwork}</Button>
}
