// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ICore} from "./interfaces/ICore.sol";
import {IVault} from "./interfaces/IVault.sol";
import {BondView, BountyView, PublisherRole, TargetView} from "./interfaces/Types.sol";
import {Constants} from "./lib/Constants.sol";

/// Every BNB the protocol holds. Pull payments only: money moves out solely through `withdraw`,
/// and only up to what was credited to the caller. There is no `receive`, and no logic reads
/// `address(this).balance`.
///
/// Task 5 implements warranty bonds and balances. Escrow (Task 6) and bounties (Task 7) carry a
/// temporary `revert("not implemented")` body so the contract compiles; those tasks replace them.
contract Vault is IVault, ReentrancyGuard {
    address public immutable core;
    address public immutable treasury;

    mapping(bytes32 => mapping(address => BondView)) internal _bonds;
    mapping(address => uint256) public balanceOf;

    /// Zero for either address is rejected as TransferFailed: with no Core no publisher can ever
    /// be read, and with no treasury every fee would be credited to an account nobody controls (D16).
    constructor(address core_, address treasury_) {
        if (core_ == address(0) || treasury_ == address(0)) revert TransferFailed();
        core = core_;
        treasury = treasury_;
    }

    // ---- warranty bonds -----------------------------------------------------------------------

    /// Only the target's current publisher of record may deposit. A deposit cancels a pending
    /// withdrawal, and the depositor's total may never pass MAX_WARRANTY_BOND (D7).
    function depositBond(bytes32 targetId) external payable {
        if (msg.value == 0) revert TransferFailed();
        TargetView memory t = ICore(core).getTarget(targetId);
        if (t.publisherRole == PublisherRole.NONE || t.publisher != msg.sender) revert NotPublisher();
        BondView storage b = _bonds[targetId][msg.sender];
        uint256 total = b.amount + msg.value;
        if (total > Constants.MAX_WARRANTY_BOND) revert BondAboveCap();
        b.amount = total;
        b.withdrawalAvailableAt = 0;
        emit BondDeposited(targetId, msg.sender, msg.value, total);
    }

    /// The bond stops counting at once but stays slashable until it is finalized (architecture 4.4).
    function requestBondWithdrawal(bytes32 targetId) external {
        BondView storage b = _bonds[targetId][msg.sender];
        if (b.amount == 0) revert NothingToWithdraw();
        uint64 availableAt = uint64(block.timestamp) + Constants.BOND_UNBONDING;
        b.withdrawalAvailableAt = availableAt;
        emit BondWithdrawalRequested(targetId, msg.sender, availableAt);
    }

    /// Works for a former sponsor too: a bond always belongs to whoever deposited it.
    function finalizeBondWithdrawal(bytes32 targetId) external {
        BondView storage b = _bonds[targetId][msg.sender];
        uint64 availableAt = b.withdrawalAvailableAt;
        if (availableAt == 0) revert NoWithdrawalRequested();
        if (block.timestamp < availableAt) revert WithdrawalNotReady(availableAt);
        if (b.lockedByChallengeId != 0) revert BondIsLocked();
        uint256 amount = b.amount;
        delete _bonds[targetId][msg.sender];
        emit BondWithdrawn(targetId, msg.sender, amount);
        _credit(msg.sender, amount);
    }

    function activeBond(bytes32 targetId) external view returns (uint256) {
        TargetView memory t = ICore(core).getTarget(targetId);
        if (t.publisherRole == PublisherRole.NONE) return 0;
        BondView storage b = _bonds[targetId][t.publisher];
        return b.withdrawalAvailableAt == 0 ? b.amount : 0;
    }

    function bondOf(bytes32 targetId, address depositor) external view returns (BondView memory) {
        return _bonds[targetId][depositor];
    }

    // ---- balances -----------------------------------------------------------------------------

    /// Zeroes the balance before sending. A receiver that reverts gets its whole balance back,
    /// because the revert undoes the zeroing too.
    function withdraw() external nonReentrant {
        uint256 amount = balanceOf[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        balanceOf[msg.sender] = 0;
        emit Withdrawn(msg.sender, amount);
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    function _credit(address account, uint256 amount) internal {
        balanceOf[account] += amount;
        emit BalanceCredited(account, amount);
    }

    // ---- not implemented yet (temporary bodies, removed by Tasks 6 and 7) ---------------------

    function createBounty(bytes32, uint8) external payable returns (uint256) {
        revert("not implemented");
    }

    function settleBounty(uint256) external {
        revert("not implemented");
    }

    function depositStake(uint256, address) external payable {
        revert("not implemented");
    }

    function lockBond(uint256, bytes32) external {
        revert("not implemented");
    }

    function settleBond(uint256, uint16) external returns (uint256, uint256) {
        revert("not implemented");
    }

    function distribute(uint256, address[] calldata, uint256[] calldata) external {
        revert("not implemented");
    }

    function escrowOf(uint256) external view returns (uint256) {
        revert("not implemented");
    }

    function getBounty(uint256) external view returns (BountyView memory) {
        revert("not implemented");
    }
}
