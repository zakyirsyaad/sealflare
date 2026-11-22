// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BondView, BountyView} from "./Types.sol";

/// Every BNB the protocol holds: challenger and juror stakes, warranty bonds, bounties, treasury.
/// Pull payments only. Dispute funds live in one escrow per challenge.
interface IVault {
    event BondDeposited(bytes32 indexed targetId, address indexed depositor, uint256 amount, uint256 total);
    event BondWithdrawalRequested(bytes32 indexed targetId, address indexed depositor, uint64 availableAt);
    event BondWithdrawn(bytes32 indexed targetId, address indexed depositor, uint256 amount);
    event BondLocked(
        uint256 indexed challengeId, bytes32 indexed targetId, address indexed depositor, uint256 amount
    );
    event BondSettled(
        uint256 indexed challengeId, bytes32 indexed targetId, address indexed depositor, uint256 slashed, uint256 released
    );
    event StakeDeposited(uint256 indexed challengeId, address indexed account, uint256 amount);
    event Distributed(uint256 indexed challengeId, address indexed recipient, uint256 amount);
    event BountyCreated(
        uint256 indexed id,
        bytes32 indexed targetId,
        address indexed requester,
        uint8 slots,
        uint256 amount,
        uint32 startIndex
    );
    /// `alignedVerdictMask` has bit n set when Verdict(n) was paid.
    event BountySettled(
        uint256 indexed id, uint8 alignedVerdictMask, uint8 filled, uint256 paidPerSlot, uint256 refunded, uint256 fee
    );
    /// Emitted for every amount added to a withdrawable balance, whatever its source.
    event BalanceCredited(address indexed account, uint256 amount);
    event Withdrawn(address indexed account, uint256 amount);

    error OnlyCourt();
    error TargetNotFound();
    error NotPublisher();
    error BondAboveCap();
    error BondIsLocked();
    error NoWithdrawalRequested();
    error WithdrawalNotReady(uint64 availableAt);
    error InvalidSlots();
    error BountyAboveCap();
    error BountyNotSettleable();
    error EscrowExceeded();
    error NothingToWithdraw();
    error TransferFailed();

    function core() external view returns (address);
    function treasury() external view returns (address);

    function depositBond(bytes32 targetId) external payable;
    function requestBondWithdrawal(bytes32 targetId) external;
    function finalizeBondWithdrawal(bytes32 targetId) external;
    function createBounty(bytes32 targetId, uint8 slots) external payable returns (uint256 id);
    function settleBounty(uint256 id) external;
    function withdraw() external;

    // Court only.
    function depositStake(uint256 challengeId, address account) external payable;
    /// Locks the current publisher's bond for this challenge. A locked bond cannot be withdrawn.
    function lockBond(uint256 challengeId, bytes32 targetId) external;
    /// Moves `slashBps` of the locked bond into the challenge escrow and releases the rest to its depositor.
    function settleBond(uint256 challengeId, uint16 slashBps) external returns (uint256 slashed, uint256 released);
    /// The sum of `amounts` can never exceed what this challenge's escrow holds.
    function distribute(uint256 challengeId, address[] calldata recipients, uint256[] calldata amounts) external;

    /// Bond of the target's current publisher of record (verified publisher or sponsor), and of
    /// nobody else. Zero once that publisher has requested withdrawal. A bond left behind by an
    /// earlier sponsor never counts.
    function activeBond(bytes32 targetId) external view returns (uint256);
    function bondOf(bytes32 targetId, address depositor) external view returns (BondView memory);
    function balanceOf(address account) external view returns (uint256);
    function escrowOf(uint256 challengeId) external view returns (uint256);
    function getBounty(uint256 id) external view returns (BountyView memory);
}
