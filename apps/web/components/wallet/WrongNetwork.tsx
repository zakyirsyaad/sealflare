'use client'
import { useSwitchChain } from 'wagmi'
import { Button } from '../ui/Button'
import { expectedChainId } from '../../lib/chain/config'
import { chainName } from '../../lib/chain/chains'
import { isUserRejection } from '../../lib/chain/errors'
import { copy } from '../../lib/copy'

export function WrongNetwork() {
  const { mutate, isPending, error } = useSwitchChain()
  const failed = error !== null && error !== undefined && !isUserRejection(error)
  return <>
    <Button disabled={isPending} onClick={() => mutate({ chainId: expectedChainId })}>
      {copy.wallet.switchNetwork.replace('{chain}', chainName(expectedChainId))}
    </Button>
    {failed && <p role="alert" className="sf-lead">{copy.wallet.switchFailed}</p>}
  </>
}
