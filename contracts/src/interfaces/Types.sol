// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Shared enums and structs. The order of every enum is part of the frozen ABI:
// shared/rules mirrors it in TypeScript and the vectors in shared/rules/vectors pin it.

enum TargetType {
    SMART_CONTRACT,
    AI_SKILL_BUNDLE
}

enum Verdict {
    SAFE,
    CAUTION,
    DANGER
}

enum TrustTier {
    UNRATED,
    COMMUNITY_SAFE,
    WARRANTY_BACKED_SAFE,
    CAUTION_FLAGGED,
    DISPUTED_CAUTION,
    CONFIRMED_DANGER,
    STALE_CODEHASH_DRIFT
}

enum PublisherRole {
    NONE,
    THIRD_PARTY_SPONSOR,
    VERIFIED_PUBLISHER
}

enum BindMethod {
    OWNER,
    DEPLOYER,
    SKILL,
    SPONSOR
}

enum ScoreReason {
    EARLY_SAFE,
    CONFIRMING_SAFE,
    DANGER_CONFIRMED,
    SAFE_ON_DANGER,
    JUROR_MAJORITY,
    CHALLENGER_WON,
    CHALLENGER_LOST
}

enum ChallengePhase {
    NONE,
    COMMIT,
    REVEAL,
    AWAITING_CLOSE,
    CLOSED
}

enum ChallengeOutcome {
    PENDING,
    UPHELD,
    REJECTED,
    TIED,
    EXPIRED
}

enum JurorStatus {
    ELIGIBLE,
    NOT_AGENT_ID_HOLDER,
    PROFILE_TOO_NEW,
    NEGATIVE_SCORE,
    IS_CHALLENGER,
    IS_PUBLISHER,
    HAS_ATTESTED,
    ALREADY_COMMITTED,
    NOT_IN_COMMIT_PHASE,
    JURY_FULL
}

struct TierInput {
    bool confirmedDanger;
    bool codehashDrift;
    bool activeDispute;
    uint32 safeWeight;
    uint32 cautionWeight;
    uint32 dangerWeight;
    bool proxyMarker;
    bool verifiedPublisherBond;
}

/// For a contract, `target` is bytes32(uint256(uint160(address))). For a skill it is the canonical bundle hash.
struct TargetView {
    TargetType targetType;
    bytes32 target;
    bytes32 pinnedCodehash;
    bool hasDelegatecall;
    address publisher;
    PublisherRole publisherRole;
    uint32 safeWeight;
    uint32 cautionWeight;
    uint32 dangerWeight;
    uint32 activeFlags;
    uint32 attestationCount;
    uint32 safeCount;
    bool confirmedDanger;
    uint256 activeChallengeId;
    uint64 createdAt;
}

struct AttestationView {
    address guardian;
    Verdict verdict;
    uint32 flags;
    uint8 weight;
    uint32 safeOrdinal;
    uint64 timestamp;
    bool settled;
    bool penalized;
    /// Cast while a challenge on the target was open. Such a vote earns no XP.
    bool castDuringDispute;
}

struct GuardianView {
    bool exists;
    int32 score;
    uint64 createdAtBlock;
    uint32 attestationCount;
    uint64 lastAttestDay;
    uint8 attestsToday;
}

struct ChallengeView {
    bytes32 targetId;
    address challenger;
    uint32 flags;
    bytes32 evidenceHash;
    string evidenceURI;
    string counterEvidenceURI;
    uint64 openedAt;
    uint64 openedAtBlock;
    uint64 commitEndsAt;
    uint64 revealEndsAt;
    uint32 commits;
    uint32 reveals;
    uint32 upholdWeight;
    uint32 rejectWeight;
    ChallengeOutcome outcome;
}

struct JurorView {
    bool committed;
    bool revealed;
    bool uphold;
    uint8 weight;
    bytes32 commitHash;
}

struct BondView {
    uint256 amount;
    uint64 withdrawalAvailableAt;
    uint256 lockedByChallengeId;
}

struct BountyView {
    bytes32 targetId;
    address requester;
    uint8 slots;
    uint256 amount;
    uint32 startIndex;
    uint64 createdAt;
    bool settled;
}
