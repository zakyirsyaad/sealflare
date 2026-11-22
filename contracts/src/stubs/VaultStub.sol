// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ICore} from "../interfaces/ICore.sol";
import {IVault} from "../interfaces/IVault.sol";
import {BondView, BountyView} from "../interfaces/Types.sol";
import {Constants} from "../lib/Constants.sol";

/// @dev Local development only. Never deploy to a public network.
/// Emits the final Vault events and pays out credited balances. It enforces no cap, no unbonding
/// delay and no caller check, and the Court-only functions are open.
contract VaultStub is IVault {
    address public immutable core;
    address public immutable treasury;

    mapping(bytes32 => mapping(address => BondView)) internal _bonds;
    mapping(bytes32 => uint256) public activeBond;
    mapping(address => uint256) public balanceOf;
    mapping(uint256 => uint256) public escrowOf;
    mapping(uint256 => BountyView) internal _bounties;
    uint256 internal _bountyCount;

    constructor(address core_, address treasury_) {
        core = core_;
        treasury = treasury_;
    }

    /// Test setter: credits a withdrawable balance backed by the BNB sent with the call.
    function stubCredit(address account) external payable {
        balanceOf[account] += msg.value;
    }

    function depositBond(bytes32 targetId) external payable {
        BondView storage b = _bonds[targetId][msg.sender];
        b.amount += msg.value;
        activeBond[targetId] += msg.value;
        emit BondDeposited(targetId, msg.sender, msg.value, b.amount);
    }

    function requestBondWithdrawal(bytes32 targetId) external {
        uint64 availableAt = uint64(block.timestamp) + Constants.BOND_UNBONDING;
        _bonds[targetId][msg.sender].withdrawalAvailableAt = availableAt;
        emit BondWithdrawalRequested(targetId, msg.sender, availableAt);
    }

    function finalizeBondWithdrawal(bytes32 targetId) external {
        BondView storage b = _bonds[targetId][msg.sender];
        uint256 amount = b.amount;
        activeBond[targetId] -= amount;
        delete _bonds[targetId][msg.sender];
        balanceOf[msg.sender] += amount;
        emit BondWithdrawn(targetId, msg.sender, amount);
    }

    function createBounty(bytes32 targetId, uint8 slots) external payable returns (uint256 id) {
        id = ++_bountyCount;
        uint32 startIndex = ICore(core).getTarget(targetId).attestationCount;
        _bounties[id] = BountyView(targetId, msg.sender, slots, msg.value, startIndex, uint64(block.timestamp), false);
        emit BountyCreated(id, targetId, msg.sender, slots, msg.value, startIndex);
    }

    function settleBounty(uint256 id) external {
        BountyView storage b = _bounties[id];
        b.settled = true;
        balanceOf[b.requester] += b.amount;
        emit BountySettled(id, 0, 0, 0, b.amount, 0);
    }

    function withdraw() external {
        uint256 amount = balanceOf[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        balanceOf[msg.sender] = 0;
        emit Withdrawn(msg.sender, amount);
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    function depositStake(uint256 challengeId, address account) external payable {
        escrowOf[challengeId] += msg.value;
        emit StakeDeposited(challengeId, account, msg.value);
    }

    function lockBond(uint256 challengeId, bytes32 targetId) external {
        address publisher = ICore(core).getTarget(targetId).publisher;
        BondView storage b = _bonds[targetId][publisher];
        b.lockedByChallengeId = challengeId;
        emit BondLocked(challengeId, targetId, publisher, b.amount);
    }

    function settleBond(uint256 challengeId, uint16 slashBps) external {
        emit BondSettled(challengeId, 0, slashBps);
    }

    function distribute(uint256 challengeId, address[] calldata recipients, uint256[] calldata amounts) external {
        for (uint256 i; i < recipients.length; ++i) {
            if (amounts[i] > escrowOf[challengeId]) revert EscrowExceeded();
            escrowOf[challengeId] -= amounts[i];
            balanceOf[recipients[i]] += amounts[i];
            emit Distributed(challengeId, recipients[i], amounts[i]);
        }
    }

    function bondOf(bytes32 targetId, address depositor) external view returns (BondView memory) {
        return _bonds[targetId][depositor];
    }

    function getBounty(uint256 id) external view returns (BountyView memory) {
        return _bounties[id];
    }
}
