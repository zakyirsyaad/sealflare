// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TargetType, TierInput, TrustTier, Verdict} from "../interfaces/Types.sol";

/// Weight, tier, XP and flag rules. Mirrors shared/rules in TypeScript; both run against the
/// vectors in shared/rules/vectors.
library Rules {
    uint32 internal constant CONTRACT_FLAGS_MASK = 0x00ff;
    uint32 internal constant SKILL_FLAGS_MASK = 0xff00;

    uint32 internal constant SAFE_WEIGHT_THRESHOLD = 3;
    uint32 internal constant DANGER_WEIGHT_THRESHOLD = 3;

    uint32 internal constant EARLY_SAFE_SLOTS = 3;
    uint32 internal constant REWARDED_SAFE_SLOTS = 10;

    int32 internal constant XP_EARLY_SAFE = 2;
    int32 internal constant XP_CONFIRMING_SAFE = 1;
    int32 internal constant XP_DANGER_CONFIRMED = 5;
    int32 internal constant XP_SAFE_ON_DANGER = -15;
    int32 internal constant XP_JUROR_MAJORITY = 3;
    int32 internal constant XP_CHALLENGER_WON = 5;
    int32 internal constant XP_CHALLENGER_LOST = -5;

    /// Vote weight W(S). Negative scores carry no weight.
    function weightOf(int32 score) internal pure returns (uint8) {
        if (score < 0) return 0;
        if (score < 10) return 1;
        if (score < 25) return 2;
        if (score < 50) return 3;
        if (score < 100) return 4;
        return 5;
    }

    /// Eight rules in priority order, first match wins.
    function tierOf(TierInput memory i) internal pure returns (TrustTier) {
        if (i.confirmedDanger) return TrustTier.CONFIRMED_DANGER;
        if (i.codehashDrift) return TrustTier.STALE_CODEHASH_DRIFT;
        if (i.activeDispute) return TrustTier.DISPUTED_CAUTION;
        uint256 against = uint256(i.cautionWeight) + uint256(i.dangerWeight);
        if (i.dangerWeight >= DANGER_WEIGHT_THRESHOLD || (against > 0 && against >= i.safeWeight)) {
            return TrustTier.CAUTION_FLAGGED;
        }
        if (i.proxyMarker) return TrustTier.CAUTION_FLAGGED;
        if (i.safeWeight < SAFE_WEIGHT_THRESHOLD) return TrustTier.UNRATED;
        return i.verifiedPublisherBond ? TrustTier.WARRANTY_BACKED_SAFE : TrustTier.COMMUNITY_SAFE;
    }

    /// XP one attestation earns. `safeOrdinal` is its 1-based position among SAFE attestations
    /// on the target; `eligible` means it survived its 48 hour window.
    function attestationXp(Verdict verdict, uint32 safeOrdinal, bool eligible, bool confirmedDanger)
        internal
        pure
        returns (int32)
    {
        if (verdict == Verdict.CAUTION) return 0;
        if (verdict == Verdict.DANGER) return confirmedDanger ? XP_DANGER_CONFIRMED : int32(0);
        if (confirmedDanger) return XP_SAFE_ON_DANGER;
        if (!eligible || safeOrdinal == 0) return 0;
        if (safeOrdinal <= EARLY_SAFE_SLOTS) return XP_EARLY_SAFE;
        if (safeOrdinal <= REWARDED_SAFE_SLOTS) return XP_CONFIRMING_SAFE;
        return 0;
    }

    /// SAFE carries no flags; CAUTION and DANGER carry at least one, all inside the target type's mask.
    function isValidFlags(TargetType targetType, Verdict verdict, uint32 flags) internal pure returns (bool) {
        if (verdict == Verdict.SAFE) return flags == 0;
        uint32 mask = targetType == TargetType.SMART_CONTRACT ? CONTRACT_FLAGS_MASK : SKILL_FLAGS_MASK;
        return flags != 0 && flags & ~mask == 0;
    }
}
