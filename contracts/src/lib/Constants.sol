// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Protocol constants. Mirrors shared/rules/constants.ts; both are checked against
/// shared/rules/vectors/constants.json.
library Constants {
    uint256 internal constant CHALLENGE_STAKE = 0.01 ether;
    uint256 internal constant JURY_STAKE = 0.005 ether;
    uint256 internal constant MAX_WARRANTY_BOND = 0.5 ether;
    uint256 internal constant MAX_BOUNTY = 0.2 ether;

    uint64 internal constant COMMIT_WINDOW = 12 hours;
    uint64 internal constant REVEAL_WINDOW = 12 hours;
    uint64 internal constant SETTLE_DELAY = 48 hours;
    uint64 internal constant BOND_UNBONDING = 7 days;
    uint64 internal constant CHALLENGE_COOLDOWN = 7 days;
    uint64 internal constant EXPIRE_REPEAT_WINDOW = 30 days;
    uint64 internal constant BOUNTY_TIMEOUT = 7 days;

    uint8 internal constant DAILY_ATTEST_LIMIT = 5;
    uint32 internal constant MIN_REVEALS = 3;
    uint32 internal constant MAX_JURORS = 21;
    uint8 internal constant BOUNTY_MIN_SLOTS = 3;
    uint8 internal constant BOUNTY_MAX_SLOTS = 5;
    uint16 internal constant BOUNTY_FEE_BPS = 500;
    uint16 internal constant BOND_SLASH_BPS = 5000;
    uint16 internal constant BPS = 10_000;
    uint256 internal constant SHORT_PROOF_MAX_BYTES = 512;

    /// Share of the challenger stake forfeited when a challenge expires, by how many challenges
    /// on the same target already expired inside EXPIRE_REPEAT_WINDOW: 20%, then 50%, then 100%.
    function expireForfeitBps(uint256 priorExpiries) internal pure returns (uint16) {
        if (priorExpiries == 0) return 2000;
        if (priorExpiries == 1) return 5000;
        return 10_000;
    }
}
