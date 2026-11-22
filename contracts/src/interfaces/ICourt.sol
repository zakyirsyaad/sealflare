// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ChallengeOutcome, ChallengePhase, ChallengeView, JurorStatus, JurorView} from "./Types.sol";

/// Disputes: challenge, counter evidence, commit, reveal, verdict, expiry. Holds no funds.
interface ICourt {
    event ChallengeOpened(
        uint256 indexed id,
        bytes32 indexed targetId,
        address indexed challenger,
        uint32 flags,
        bytes32 evidenceHash,
        bytes shortProof,
        string evidenceURI,
        uint64 commitEndsAt,
        uint64 revealEndsAt
    );
    event CounterEvidenceSubmitted(uint256 indexed id, address indexed publisher, string uri);
    /// The direction of the vote is not part of this event. `weight` is frozen at commit.
    event VoteCommitted(uint256 indexed id, address indexed juror, uint8 weight);
    event VoteRevealed(uint256 indexed id, address indexed juror, bool uphold, uint8 weight);
    event ChallengeResolved(uint256 indexed id, ChallengeOutcome outcome, uint32 upholdWeight, uint32 rejectWeight);
    event ChallengeExpired(uint256 indexed id, uint32 reveals, uint16 forfeitBps);

    error NotAgentIdHolder();
    error InvalidFlags();
    error ShortProofTooLong();
    error TargetNotFound();
    error WrongStake(uint256 expected);
    error ChallengeAlreadyActive(uint256 id);
    error InCooldown(uint64 endsAt);
    error TargetAlreadyConfirmedDanger();
    error NotPublisher();
    error WrongPhase(ChallengePhase current);
    error NotEligibleJuror(JurorStatus status);
    error CommitMismatch();
    error AlreadyRevealed();
    error QuorumReached();
    error QuorumNotReached();
    error ChallengeClosed();

    function core() external view returns (address);
    function vault() external view returns (address);

    function openChallenge(
        bytes32 targetId,
        uint32 flags,
        bytes32 evidenceHash,
        bytes calldata shortProof,
        string calldata evidenceURI
    ) external payable returns (uint256 id);
    function submitCounterEvidence(uint256 id, string calldata uri) external;
    function commitVote(uint256 id, bytes32 commitHash) external payable;
    function revealVote(uint256 id, bool uphold, bytes32 salt) external;
    function resolve(uint256 id) external;
    function expire(uint256 id) external;

    /// keccak256(abi.encode(id, juror, uphold, salt)). The juror address is part of the hash, so a
    /// commitment cannot be copied by another juror.
    function commitHashOf(uint256 id, address juror, bool uphold, bytes32 salt) external pure returns (bytes32);
    function getChallenge(uint256 id) external view returns (ChallengeView memory);
    function phaseOf(uint256 id) external view returns (ChallengePhase);
    function activeChallengeOf(bytes32 targetId) external view returns (uint256);
    function getJuror(uint256 id, address juror) external view returns (JurorView memory);
    function jurorStatus(uint256 id, address account) external view returns (JurorStatus);
    function cooldownEndsAt(address challenger, bytes32 targetId) external view returns (uint64);
    function nextExpireForfeitBps(bytes32 targetId) external view returns (uint16);
}
