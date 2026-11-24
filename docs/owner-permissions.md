# Owner permissions

This page lists every privilege anyone holds over the Sealflare contracts on BNB Smart Chain, and
the limits we know about. Read it before you depend on `IFirewall` from your own contract or put
BNB into Vault.

Addresses are filled in after the mainnet release. Until then they read "not deployed".

| Contract | Address | Holds BNB |
| :--- | :--- | :--- |
| Core | not deployed | No |
| Vault | not deployed | Yes, every BNB the protocol holds |
| Court | not deployed | No |
| Treasury account | not deployed | Withdraws through `Vault.withdraw()` |

## No owner, no proxy, no pause

- None of the three contracts has an owner, an admin role, or an `Ownable` base.
- None is a proxy. The code at each address cannot be replaced, and none of them uses
  `delegatecall` or `selfdestruct`.
- There is no pause and no emergency stop. Nobody can freeze withdrawals, votes or disputes.
- There is no token. Sealflare mints nothing and holds no token balances.
- Every rule and amount (stakes, bond cap, windows, XP) is a constant compiled into the code.
  Nobody can change them after deployment.

## The one privilege: `setModules`

Core records the account that deployed it as `deployer`. That account can call
`Core.setModules(court, vault)` exactly once:

- It only accepts a Court and a Vault that both point back at this Core, where the Court also
  points at that Vault, and where Court and Vault are two different contracts with code.
- After the call succeeds, `court()` and `vault()` are fixed for good. A second call reverts with
  `ModulesAlreadySet`, and the deployer has no other function to call.

### The window before `setModules`

Core is released first. Vault and Court follow, and only then is `setModules` called. Between
those two moments:

- Attestations, publisher binding, XP settlement, tiers and `IFirewall` work in full.
- Disputes, warranty bonds and bounties do not exist yet, so `warrantyBondActive` reads 0 and no
  target can be confirmed dangerous.
- The deployer key is the only privileged key in the system. It is kept on a hardware wallet.
  Whoever holds it in this window chooses which Court and Vault are wired in. Once
  `setModules` has run, the key has no power left.

When the window has closed, this page will show the transaction that called `setModules`.

## The treasury

Vault stores the treasury address as an immutable value set at deployment. The treasury
receives the 5% bounty fee, rounding remainders, the forfeited part of an expired challenger's
stake, and, in tied or expired disputes, the stakes of jurors who committed but did not reveal. Its balance sits in Vault like any other account's
balance and leaves only through `Vault.withdraw()`. The treasury has no other power: it cannot
move anyone else's balance, bond or escrow.

## Where your BNB can go

Vault pays out only by pull: each account withdraws its own credited balance with `withdraw()`.

- A warranty bond belongs to whoever deposited it. It can be withdrawn 7 days after a withdrawal
  request, unless a dispute has locked it. A bond can still be slashed while that request is
  pending, and a challenge that wins slashes half of it.
- Challenge and juror stakes go into an escrow for that one challenge. Court can only distribute
  what that escrow holds, so a fault in one dispute cannot reach another dispute's funds, any
  bond, or any bounty.
- A bounty pays the slot fillers whose verdict was in the majority, the 5% fee to the treasury,
  and returns unfilled slots to the requester after 7 days.

## Agent ID

Every write checks `balanceOf` on the SPACE ID Agent ID contract at
`0x60b9262456de011f7d15a54cdd8c48baaa8b022f`. Sealflare does not control that contract. Our fork
tests show that, at block 135,458,000, it is not an EIP-1967 proxy and its code contains no
reachable `DELEGATECALL`. Its tokens are soulbound: every transfer and approval reverts with
`Soulbound()`, also when the contract's owner sends it, so one Agent ID cannot be handed from
wallet to wallet. The contract has an owner, an externally owned account at
`0x457C1fd14750c6c30886A2f2B57F1eF44B095882`, which is also the signer that approves new
registrations. The owner cannot move or burn an Agent ID and cannot pause the contract, but it
can mint an Agent ID to any address with `adminRegister`. Sealflare counts every Agent ID as one
person, so whoever holds that key could create as many guardians and jurors as they like. This
is a trust assumption on SPACE ID that Sealflare cannot remove. At that block, ownership was
being handed to a Safe multisig (`0x082b3370974E3DA99c6e3572A7FcBd2222f9a350`, 3 of 6 signers)
that had not yet accepted it.

## Known limits

- Sealflare is only as sybil-resistant as Agent ID. Its owner can mint Agent IDs at will.
- A skill bundle without a manifest cannot be claimed by a publisher.
- A contract created by a factory or with `CREATE2` that has no `owner()` cannot prove who owns
  it, so it can only have a sponsor.
- Court and Vault cannot be replaced. If one of them is found faulty, a fixed version cannot be
  wired to the existing Core; it would need a new Core as well.
- Juror quorum will be hard to reach in the first weeks, so many disputes will expire.
- `IFirewall.verifyContract` sees changes to a target's own bytecode, but it cannot see an
  upgrade of a proxy's implementation. Use the Sealflare SDK for proxies.
- Running vote totals are visible during the reveal phase, so a juror can choose whether to
  reveal after seeing them, at the cost of the juror stake.
- A publisher whose bond withdrawal has already matured can finish withdrawing before a
  challenge locks the bond.

## Audit status

The contracts have not had a third-party audit. They are covered by unit, fuzz, invariant,
end-to-end and BSC fork tests in `contracts/test`, and by two internal reviews.
