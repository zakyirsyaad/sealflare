// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ICore} from "./interfaces/ICore.sol";
import {IVault} from "./interfaces/IVault.sol";
import {AttestationView, BondView, BountyView, PublisherRole, TargetView, Verdict} from "./interfaces/Types.sol";
import {Constants} from "./lib/Constants.sol";

/// Every BNB the protocol holds. Pull payments only: money moves out solely through `withdraw`,
/// and only up to what was credited to the caller. There is no `receive`, and no logic reads
/// `address(this).balance`.
contract Vault is IVault, ReentrancyGuard {
    address public immutable core;
    address public immutable treasury;

    mapping(bytes32 => mapping(address => BondView)) internal _bonds;
    mapping(address => uint256) public balanceOf;
    mapping(uint256 => uint256) public escrowOf;

    struct BondLock {
        bytes32 targetId;
        address depositor;
    }

    mapping(uint256 => BondLock) internal _locks;
    mapping(uint256 => BountyView) internal _bounties;
    uint256 internal _bountyCount;

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

    // ---- dispute escrow (Court only) ----------------------------------------------------------

    /// Court is read from Core on every call, so these stay closed until setModules has run.
    modifier onlyCourt() {
        address court = ICore(core).court();
        if (court == address(0) || msg.sender != court) revert OnlyCourt();
        _;
    }

    function depositStake(uint256 challengeId, address account) external payable onlyCourt {
        if (msg.value == 0) revert TransferFailed();
        escrowOf[challengeId] += msg.value;
        emit StakeDeposited(challengeId, account, msg.value);
    }

    /// Locks the bond of the target's current publisher of record. No publisher or no bond is a
    /// silent no-op, so Court can call this without knowing whether a bond exists (D8).
    function lockBond(uint256 challengeId, bytes32 targetId) external onlyCourt {
        TargetView memory t = ICore(core).getTarget(targetId);
        if (t.publisherRole == PublisherRole.NONE) return;
        BondView storage b = _bonds[targetId][t.publisher];
        if (b.amount == 0) return;
        b.lockedByChallengeId = challengeId;
        _locks[challengeId] = BondLock(targetId, t.publisher);
        emit BondLocked(challengeId, targetId, t.publisher, b.amount);
    }

    /// Moves `slashBps` of the locked bond into this challenge's escrow, rounding down, and
    /// unlocks the rest, which stays a bond of its depositor. Without a lock it returns (0, 0).
    /// A slashBps above 10,000 underflows and reverts.
    function settleBond(uint256 challengeId, uint16 slashBps)
        external
        onlyCourt
        returns (uint256 slashed, uint256 released)
    {
        BondLock memory l = _locks[challengeId];
        if (l.depositor == address(0)) return (0, 0);
        delete _locks[challengeId];
        BondView storage b = _bonds[l.targetId][l.depositor];
        slashed = b.amount * slashBps / Constants.BPS;
        released = b.amount - slashed;
        b.amount = released;
        b.lockedByChallengeId = 0;
        escrowOf[challengeId] += slashed;
        emit BondSettled(challengeId, l.targetId, l.depositor, slashed, released);
    }

    /// Checks the whole sum against this challenge's escrow before crediting anyone, so a bad
    /// list changes nothing. A length mismatch is rejected as EscrowExceeded too (D17).
    function distribute(uint256 challengeId, address[] calldata recipients, uint256[] calldata amounts)
        external
        onlyCourt
    {
        if (recipients.length != amounts.length) revert EscrowExceeded();
        uint256 total;
        for (uint256 i = 0; i < amounts.length; ++i) {
            total += amounts[i];
        }
        if (total > escrowOf[challengeId]) revert EscrowExceeded();
        escrowOf[challengeId] -= total;
        for (uint256 i = 0; i < recipients.length; ++i) {
            emit Distributed(challengeId, recipients[i], amounts[i]);
            _credit(recipients[i], amounts[i]);
        }
    }

    // ---- bounties ---------------------------------------------------------------------------

    /// The slot fillers of one bounty, read from Core. The arrays are sized to the bounty's slots.
    struct Fill {
        uint8 filled;
        uint64 lastAt;
        address[] fillers;
        Verdict[] verdicts;
        uint8[3] counts;
    }

    /// Slots fill from the target's next attestation, so `startIndex` is Core's current count;
    /// a target Core has not recorded yet starts at 0 (D9).
    function createBounty(bytes32 targetId, uint8 slots) external payable returns (uint256 id) {
        if (slots < Constants.BOUNTY_MIN_SLOTS || slots > Constants.BOUNTY_MAX_SLOTS) revert InvalidSlots();
        if (msg.value == 0 || msg.value > Constants.MAX_BOUNTY) revert BountyAboveCap();
        uint32 startIndex = ICore(core).getTarget(targetId).attestationCount;
        id = ++_bountyCount;
        _bounties[id] = BountyView(targetId, msg.sender, slots, msg.value, startIndex, uint64(block.timestamp), false);
        emit BountyCreated(id, targetId, msg.sender, slots, msg.value, startIndex);
    }

    /// Settles once the slots are full and the last filler's 48 hours have passed, or once the
    /// bounty is 7 days old with whatever slots it has (architecture 4.9, D10).
    function settleBounty(uint256 id) external {
        BountyView storage b = _bounties[id];
        if (b.requester == address(0) || b.settled) revert BountyNotSettleable();
        Fill memory f = _fillersOf(b);
        if (!_isSettleable(b, f)) revert BountyNotSettleable();
        b.settled = true;
        _payOut(id, b, f);
    }

    function getBounty(uint256 id) external view returns (BountyView memory) {
        return _bounties[id];
    }

    /// The first `slots` attestations from `startIndex` by anyone but the requester. One address
    /// attests once per target, so this reads at most `slots + 1` attestations.
    function _fillersOf(BountyView storage b) internal view returns (Fill memory f) {
        uint32 count = ICore(core).getTarget(b.targetId).attestationCount;
        f.fillers = new address[](b.slots);
        f.verdicts = new Verdict[](b.slots);
        for (uint32 i = b.startIndex; i < count && f.filled < b.slots; ++i) {
            AttestationView memory a = ICore(core).getAttestation(b.targetId, i);
            if (a.guardian == b.requester) continue;
            f.fillers[f.filled] = a.guardian;
            f.verdicts[f.filled] = a.verdict;
            f.counts[uint8(a.verdict)] += 1;
            f.lastAt = a.timestamp;
            ++f.filled;
        }
    }

    function _isSettleable(BountyView storage b, Fill memory f) internal view returns (bool) {
        if (block.timestamp >= uint256(b.createdAt) + Constants.BOUNTY_TIMEOUT) return true;
        return f.filled == b.slots && block.timestamp >= uint256(f.lastAt) + Constants.SETTLE_DELAY;
    }

    /// Every verdict with the top count is aligned, so a tie pays all tied fillers.
    function _aligned(Fill memory f) internal pure returns (uint8 mask, uint8 alignedCount) {
        uint8 top;
        for (uint8 v = 0; v < 3; ++v) {
            if (f.counts[v] > top) top = f.counts[v];
        }
        if (top == 0) return (0, 0);
        for (uint8 v = 0; v < 3; ++v) {
            if (f.counts[v] == top) {
                mask |= uint8(1 << v);
                alignedCount += top;
            }
        }
    }

    /// Full slots pay out the whole amount. A timeout pays only the filled slots' share and
    /// refunds the rest. The 5% fee and every rounding remainder go to the treasury (D10, D13).
    function _payOut(uint256 id, BountyView storage b, Fill memory f) internal {
        (uint8 mask, uint8 alignedCount) = _aligned(f);
        uint256 pool = f.filled == b.slots ? b.amount : b.amount / b.slots * f.filled;
        uint256 fee = pool * Constants.BOUNTY_FEE_BPS / Constants.BPS;
        uint256 paidPerSlot = alignedCount == 0 ? 0 : (pool - fee) / alignedCount;
        uint256 refunded = b.amount - pool;
        for (uint256 i = 0; i < f.filled; ++i) {
            if (paidPerSlot != 0 && mask & (1 << uint8(f.verdicts[i])) != 0) _credit(f.fillers[i], paidPerSlot);
        }
        if (refunded != 0) _credit(b.requester, refunded);
        uint256 toTreasury = pool - paidPerSlot * alignedCount;
        if (toTreasury != 0) _credit(treasury, toTreasury);
        emit BountySettled(id, mask, f.filled, paidPerSlot, refunded, fee);
    }
}
