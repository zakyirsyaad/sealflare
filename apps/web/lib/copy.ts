// Exact UI strings from docs/ux.md, grouped by screen. Shared wording lives in common.
export const copy = {
  "common": {
    "retry": "Try again",
    "close": "Close",
    "loading": "Loading",
    "onChainSafe": "Your on-chain data is unaffected.",
    "onChainUnknown": "On-chain data could not be verified.",
    "waitingFinality": "Waiting for finality",
    "modulesNotLive": "Opens when the dispute and vault contracts go live.",
    "appLabel": "App",
    "skip": "Skip to content",
    "safe": "safe",
    "danger": "danger",
    "caution": "caution",
    "unrated": "unrated"
  },
  "nav": {
    "scan": "Scan",
    "explore": "Explore",
    "disputes": "Disputes",
    "bounties": "Bounties",
    "guardians": "Guardians",
    "connectWallet": "Connect wallet",
    "activity": "My activity",
    "publish": "Publish",
    "disconnect": "Disconnect",
    "theme": "Light theme"
  },
  "wallet": {
    "agentRequired": "You need an Agent ID.",
    "otherWallet": "I have one on another wallet",
    "getAgentId": "Get an Agent ID",
    "checkAgain": "Check again",
    "agentWhy": "Attestations are tied to an Agent ID, so every vote comes from a verified agent identity.",
    "agentIdLinkPending": "The official link has not been published yet.",
    "checkingAgentId": "Checking for an Agent ID",
    "switchNetwork": "Switch to BNB Smart Chain",
    "quotaExhausted": "You have used all 5 attestations for today.",
    "connectTitle": "Connect a wallet",
    "connectIntro": "Reading is open to everyone. A wallet is only needed to write on-chain.",
    "mobileQr": "Use a mobile wallet: WalletConnect shows a QR code to scan.",
    "walletConnect": "WalletConnect (QR)",
    "connecting": "Waiting for your wallet",
    "connectFailed": "Could not connect. Try again or choose another wallet.",
    "menuLabel": "Wallet menu",
    "pendingOne": "1 item needs action",
    "pendingMany": "{count} items need action"
  },
  "errors": {
    "unknown": "Something went wrong. Try again.",
    "AlreadyAttested": "You already attested this target.",
    "AlreadyVerifiedPublisher": "This target already has a verified publisher.",
    "CodeChangedSincePin": "The code changed since it was sealed, so this vote is closed.",
    "DailyLimitReached": "You have used all 5 attestations for today. The limit resets at {time}.",
    "DeployerMismatch": "The deployer address does not match this contract.",
    "InvalidFlags": "One or more flags are not valid.",
    "InvalidSignature": "That signature is not valid.",
    "ModuleMismatch": "The dispute and vault contracts do not belong to this registry.",
    "ModulesAlreadySet": "The dispute and vault contracts are already connected.",
    "NotAgentIdHolder": "This wallet does not hold an Agent ID.",
    "NothingToSettle": "There is nothing to settle for this target.",
    "OnlyCourt": "Only the dispute contract can do this.",
    "OnlyDeployer": "Only the deployer can do this.",
    "PublisherAlreadyBound": "A publisher is already bound to this target.",
    "SafeNotAllowedOnConfirmedDanger": "A target confirmed as dangerous cannot be attested as safe.",
    "ShortProofTooLong": "The evidence excerpt is too long. Shorten it and try again.",
    "SignatureExpired": "That signature has expired. Request a new one.",
    "TargetHasNoCode": "No contract is deployed at this address on BNB Chain.",
    "TargetHasOwner": "This contract has an owner, so it must be bound by that owner.",
    "TargetNotFound": "This target has not been recorded on-chain yet.",
    "AlreadyRevealed": "You already revealed your vote.",
    "ChallengeAlreadyActive": "A challenge is already open for this target (number {id}).",
    "ChallengeClosed": "This challenge is closed.",
    "CommitMismatch": "That reveal code does not match the vote you committed.",
    "InCooldown": "This target is in a cooldown after an expired challenge. You can challenge it again after {time}.",
    "NotEligibleJuror": "You cannot join this jury.",
    "NotPublisher": "Only the verified publisher of this target can do this.",
    "QuorumNotReached": "Fewer than three jurors revealed, so the challenge cannot be resolved yet.",
    "QuorumReached": "Enough jurors revealed, so the challenge can no longer expire.",
    "TargetAlreadyConfirmedDanger": "This target is already confirmed as dangerous.",
    "WrongPhase": "This action is not available right now ({phase}).",
    "WrongStake": "The stake must be exactly {amount} BNB.",
    "BondAboveCap": "That bond is above the 0.5 BNB limit.",
    "BondIsLocked": "The bond is locked while a withdrawal is pending or a dispute is open.",
    "BountyAboveCap": "That bounty is above the 0.2 BNB limit.",
    "BountyNotSettleable": "This bounty cannot be settled yet.",
    "EscrowExceeded": "That amount is more than the escrow holds.",
    "InvalidSlots": "Choose between 3 and 5 slots.",
    "NoWithdrawalRequested": "No withdrawal has been requested.",
    "NothingToWithdraw": "You have no balance to withdraw.",
    "TransferFailed": "The transfer failed. Try again.",
    "WithdrawalNotReady": "The withdrawal is not ready yet. It becomes available at {time}."
  },
  "jurorStatus": [
    "You can join this jury.",
    "You need an Agent ID to join this jury.",
    "Your Guardian profile was created after this challenge opened, so you cannot judge it.",
    "Your score is negative, so you cannot judge this challenge.",
    "You opened this challenge, so you cannot judge it.",
    "You are the publisher of this target, so you cannot judge it.",
    "You attested this target, so you cannot judge it.",
    "You already committed a vote in this challenge.",
    "The commit phase is over, so jurors can no longer join.",
    "The jury is full."
  ],
  "phases": ["no open challenge", "commit phase", "reveal phase", "closing step", "closed state"],
  "scan": {
    "title": "Scan",
    "intro": "Scan any BNB Chain contract or AI skill.",
    "notReady": "Scanning will be available when the scan service is connected.",
    "invalidInput": "That is not a contract address or a repository link.",
    "noContract": "No contract is deployed at this address on BNB Chain.",
    "privateRepo": "This repository is not public.",
    "noSkill": "No skill was found in this repository.",
    "tooLarge": "This skill is too large to scan.",
    "rateLimit": "Too many scans from your network. Try again in N minutes.",
    "rpcUnavailable": "BNB Chain could not be reached. No verdict was produced.",
    "expired": "This result is no longer cached.",
    "again": "Scan again"
  },
  "attest": {
    "action": "Attest",
    "alreadySafe": "You attested: Safe",
    "uploadFailed": "Evidence upload failed. Nothing was sent on-chain.",
    "permanent": "This vote is permanent. It cannot be changed or withdrawn.",
    "claimable": "XP becomes claimable after 48 hours.",
    "first": "Be the first Guardian",
    "safe": "Safe",
    "caution": "Caution",
    "danger": "Danger"
  },
  "sandbox": {
    "action": "Run sandbox",
    "cost": "Uses 1 of your 5 daily runs. A run that fails because of the skill's own content still counts.",
    "noViolation": "No violation observed",
    "paused": "Sandbox is paused for today. Layer 1 results are unaffected."
  },
  "target": {
    "findings": "Findings",
    "attestations": "Attestations",
    "publisher": "Publisher",
    "dispute": "Dispute",
    "bounty": "Bounty",
    "history": "History",
    "noScan": "This version has not been scanned yet.",
    "noAttestations": "No attestations yet. Be the first Guardian.",
    "noPublisher": "No publisher has claimed this target.",
    "noDisputes": "No disputes.",
    "noBounty": "No bounty.",
    "currentVersion": "Scan the current version",
    "flagProxy": "Flag as proxy on-chain",
    "proxyReason": "This is a proxy and cannot receive a safe firewall verdict.",
    "challenge": "Open a challenge",
    "fundBounty": "Fund an audit bounty",
    "newIds": "New IDs",
    "guardians": "Guardians",
    "communitySignal": "Community signal",
    "confirmedDanger": "Confirmed danger",
    "modified": "Modified since audit",
    "underDispute": "Under dispute",
    "unbonding": "Unbonding"
  },
  "dispute": {
    "action": "Open a challenge",
    "viewOpen": "View the open challenge",
    "submitReply": "Submit reply",
    "noPublisher": "No publisher is bound to this target, so no reply is possible.",
    "penalties": "Apply penalties (N pending)",
    "penaltyPending": "Penalty pending",
    "commit": "Commit",
    "reveal": "Reveal",
    "resolve": "Resolve",
    "expire": "Expire"
  },
  "jury": {
    "join": "Join the jury",
    "reveal": "Reveal my vote",
    "pasteCode": "Paste your reveal code",
    "uphold": "Uphold",
    "reject": "Reject"
  },
  "publish": {
    "title": "Publish",
    "share": "Share this request",
    "pasteSignature": "Paste signature",
    "alreadyPublisher": "This target already has a publisher.",
    "verifiedPublisher": "Verified publisher",
    "sponsor": "Third-party sponsor",
    "deposit": "Deposit bond",
    "requestWithdrawal": "Request withdrawal",
    "finalizeWithdrawal": "Finalize withdrawal"
  },
  "bounty": {
    "title": "Bounties",
    "settle": "Settle"
  },
  "activity": {
    "title": "My activity",
    "needsAction": "Needs action",
    "balance": "Balance",
    "standing": "Standing",
    "history": "History",
    "withdraw": "Withdraw",
    "claimXp": "Claim XP"
  },
  "explore": {
    "title": "Explore"
  },
  "guardians": {
    "title": "Guardians"
  },
  "site": {
    "launch": "Launch app",
    "docs": "Docs",
    "github": "GitHub"
  },
  "tiers": {
    "UNRATED": {
      "label": "Unrated",
      "reason": "There is not enough community signal to assign a safe verdict."
    },
    "COMMUNITY_SAFE": {
      "label": "Community safe",
      "reason": "The community signal meets the on-chain safe threshold."
    },
    "WARRANTY_BACKED_SAFE": {
      "label": "Warranty backed safe",
      "reason": "The safe community signal is backed by a verified publisher bond."
    },
    "CAUTION_FLAGGED": {
      "label": "Caution flagged",
      "reason": "The community signal or contract properties require caution."
    },
    "DISPUTED_CAUTION": {
      "label": "Under dispute",
      "reason": "A challenge is open and the result is not final."
    },
    "CONFIRMED_DANGER": {
      "label": "Confirmed danger",
      "reason": "The jury confirmed that this target is dangerous."
    },
    "STALE_CODEHASH_DRIFT": {
      "label": "Modified since audit",
      "reason": "The code changed and earlier votes do not apply to this version."
    }
  }
} as const
