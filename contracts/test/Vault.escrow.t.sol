// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {IVault} from "../src/interfaces/IVault.sol";
import {BondView, Verdict} from "../src/interfaces/Types.sol";
import {Constants} from "../src/lib/Constants.sol";
import {Fixture} from "./helpers/Fixture.sol";
import {OwnedTarget} from "./helpers/Mocks.sol";

contract VaultEscrowTest is Fixture {
    IVault internal v;
    bytes32 internal skillId;
    address internal publisher;

    function setUp() public override {
        super.setUp();
        v = IVault(vault);
        publisher = holder("publisher");
        vm.prank(publisher);
        skillId = core.bindSkill(keccak256("bundle"));
    }

    function depositBondAs(address who, bytes32 id, uint256 amount) internal {
        vm.prank(who);
        v.depositBond{value: amount}(id);
    }

    function stake(uint256 challengeId, address account, uint256 amount) internal {
        vm.deal(court, court.balance + amount);
        vm.prank(court);
        v.depositStake{value: amount}(challengeId, account);
    }

    function lock(uint256 challengeId, bytes32 id) internal {
        vm.prank(court);
        v.lockBond(challengeId, id);
    }

    function settleBondAs(uint256 challengeId, uint16 bps) internal returns (uint256 slashed, uint256 released) {
        vm.prank(court);
        return v.settleBond(challengeId, bps);
    }

    function pair(address a, uint256 x, address b, uint256 y)
        internal
        pure
        returns (address[] memory to, uint256[] memory amounts)
    {
        to = new address[](2);
        amounts = new uint256[](2);
        (to[0], to[1], amounts[0], amounts[1]) = (a, b, x, y);
    }

    // ---- access --------------------------------------------------------------------------------

    function expectAllCourtOnly(address sender) internal {
        vm.deal(sender, 1 ether);
        (address[] memory to, uint256[] memory amounts) = pair(sender, 0, sender, 0);
        vm.startPrank(sender);
        vm.expectRevert(IVault.OnlyCourt.selector);
        v.depositStake{value: 0.01 ether}(1, sender);
        vm.expectRevert(IVault.OnlyCourt.selector);
        v.lockBond(1, skillId);
        vm.expectRevert(IVault.OnlyCourt.selector);
        v.settleBond(1, 5000);
        vm.expectRevert(IVault.OnlyCourt.selector);
        v.distribute(1, to, amounts);
        vm.stopPrank();
    }

    function test_courtOnly_fromOthers_revert() public {
        wireModules();
        expectAllCourtOnly(makeAddr("stranger"));
        expectAllCourtOnly(address(core));
    }

    function test_courtOnly_beforeModulesSet_revert() public {
        expectAllCourtOnly(makeAddr("stranger"));
        expectAllCourtOnly(address(0));
    }

    // ---- stakes --------------------------------------------------------------------------------

    function test_depositStake_addsToThatEscrowOnly() public {
        wireModules();
        address challenger = makeAddr("challenger");
        vm.deal(court, 0.01 ether);
        vm.expectEmit(vault);
        emit IVault.StakeDeposited(1, challenger, 0.01 ether);
        vm.prank(court);
        v.depositStake{value: 0.01 ether}(1, challenger);
        assertEq(v.escrowOf(1), 0.01 ether);
        assertEq(v.escrowOf(2), 0);
        assertEq(v.balanceOf(challenger), 0);
    }

    function test_depositStake_zeroValue_reverts() public {
        wireModules();
        vm.prank(court);
        vm.expectRevert(IVault.TransferFailed.selector);
        v.depositStake(1, makeAddr("challenger"));
    }

    // ---- bond locking --------------------------------------------------------------------------

    function test_lockBond_withBond_locksCurrentPublishersBond() public {
        wireModules();
        depositBondAs(publisher, skillId, 0.4 ether);
        vm.expectEmit(vault);
        emit IVault.BondLocked(1, skillId, publisher, 0.4 ether);
        lock(1, skillId);
        assertEq(v.bondOf(skillId, publisher).lockedByChallengeId, 1);
    }

    function test_lockBond_withoutBond_isSilentNoop() public {
        wireModules();
        vm.recordLogs();
        lock(1, skillId);
        lock(2, keccak256("unknown"));
        assertEq(vm.getRecordedLogs().length, 0);
        (uint256 slashed, uint256 released) = settleBondAs(1, 5000);
        assertEq(slashed + released, 0);
    }

    function test_lockBond_ignoresFormerSponsorsBond() public {
        wireModules();
        (address ownerAddr, uint256 ownerPk) = makeAddrAndKey("owner");
        address owned = address(new OwnedTarget(ownerAddr));
        bytes32 id = attestAs(holder("attester"), owned, Verdict.SAFE, 0);
        address s = holder("sponsor");
        vm.prank(s);
        core.sponsor(id);
        depositBondAs(s, id, 0.3 ether);
        bytes memory sig = signBindByOwner(ownerPk, owned, publisher, block.timestamp + 1 hours);
        core.bindByOwner(owned, publisher, block.timestamp + 1 hours, sig);

        vm.recordLogs();
        lock(1, id);
        assertEq(vm.getRecordedLogs().length, 0);
        assertEq(v.bondOf(id, s).lockedByChallengeId, 0);
    }

    function test_finalize_whileLocked_reverts() public {
        wireModules();
        depositBondAs(publisher, skillId, 0.3 ether);
        vm.prank(publisher);
        v.requestBondWithdrawal(skillId);
        lock(1, skillId);
        vm.warp(block.timestamp + Constants.BOND_UNBONDING);
        vm.prank(publisher);
        vm.expectRevert(IVault.BondIsLocked.selector);
        v.finalizeBondWithdrawal(skillId);
    }

    // ---- settleBond ----------------------------------------------------------------------------

    function test_settleBond_halfSlash_movesHalfToEscrowAndUnlocks() public {
        wireModules();
        depositBondAs(publisher, skillId, 0.4 ether);
        stake(1, makeAddr("challenger"), 0.01 ether);
        lock(1, skillId);
        vm.expectEmit(vault);
        emit IVault.BondSettled(1, skillId, publisher, 0.2 ether, 0.2 ether);
        (uint256 slashed, uint256 released) = settleBondAs(1, Constants.BOND_SLASH_BPS);
        assertEq(slashed, 0.2 ether);
        assertEq(released, 0.2 ether);
        assertEq(v.escrowOf(1), 0.21 ether);
        BondView memory b = v.bondOf(skillId, publisher);
        assertEq(b.amount, 0.2 ether);
        assertEq(b.lockedByChallengeId, 0);
        assertEq(v.activeBond(skillId), 0.2 ether);
    }

    function test_settleBond_zeroSlash_onlyUnlocks() public {
        wireModules();
        depositBondAs(publisher, skillId, 0.4 ether);
        lock(1, skillId);
        (uint256 slashed, uint256 released) = settleBondAs(1, 0);
        assertEq(slashed, 0);
        assertEq(released, 0.4 ether);
        assertEq(v.escrowOf(1), 0);
        assertEq(v.bondOf(skillId, publisher).amount, 0.4 ether);
        assertEq(v.bondOf(skillId, publisher).lockedByChallengeId, 0);
    }

    function test_settleBond_nothingLocked_returnsZeros() public {
        wireModules();
        depositBondAs(publisher, skillId, 0.4 ether);
        vm.recordLogs();
        (uint256 slashed, uint256 released) = settleBondAs(7, 5000);
        assertEq(slashed + released, 0);
        assertEq(vm.getRecordedLogs().length, 0);
        assertEq(v.bondOf(skillId, publisher).amount, 0.4 ether);
    }

    function test_settleBond_twice_secondIsNoop() public {
        wireModules();
        depositBondAs(publisher, skillId, 0.4 ether);
        lock(1, skillId);
        settleBondAs(1, 5000);
        (uint256 slashed, uint256 released) = settleBondAs(1, 5000);
        assertEq(slashed + released, 0);
        assertEq(v.escrowOf(1), 0.2 ether);
        assertEq(v.bondOf(skillId, publisher).amount, 0.2 ether);
    }

    function test_settleBond_slashesBondEvenWhileWithdrawalPending() public {
        wireModules();
        depositBondAs(publisher, skillId, 0.4 ether);
        vm.prank(publisher);
        v.requestBondWithdrawal(skillId);
        lock(1, skillId);
        settleBondAs(1, 5000);
        assertEq(v.escrowOf(1), 0.2 ether);

        vm.warp(block.timestamp + Constants.BOND_UNBONDING);
        vm.prank(publisher);
        v.finalizeBondWithdrawal(skillId);
        assertEq(v.balanceOf(publisher), 0.2 ether);
    }

    function test_settleBond_oddWeiBond_roundsSlashDown() public {
        wireModules();
        depositBondAs(publisher, skillId, 3);
        lock(1, skillId);
        (uint256 slashed, uint256 released) = settleBondAs(1, 5000);
        assertEq(slashed, 1);
        assertEq(released, 2);
    }

    // ---- distribute ----------------------------------------------------------------------------

    function test_distribute_creditsRecipientsAndDrainsEscrow() public {
        wireModules();
        address a = makeAddr("a");
        address b = makeAddr("b");
        stake(1, a, 0.03 ether);
        (address[] memory to, uint256[] memory amounts) = pair(a, 0.02 ether, b, 0.01 ether);
        vm.expectEmit(vault);
        emit IVault.Distributed(1, a, 0.02 ether);
        vm.expectEmit(vault);
        emit IVault.BalanceCredited(a, 0.02 ether);
        vm.expectEmit(vault);
        emit IVault.Distributed(1, b, 0.01 ether);
        vm.expectEmit(vault);
        emit IVault.BalanceCredited(b, 0.01 ether);
        vm.prank(court);
        v.distribute(1, to, amounts);
        assertEq(v.escrowOf(1), 0);
        assertEq(v.balanceOf(a), 0.02 ether);
        assertEq(v.balanceOf(b), 0.01 ether);
    }

    function test_distribute_sumAboveEscrow_revertsAndChangesNothing() public {
        wireModules();
        address a = makeAddr("a");
        stake(1, a, 0.03 ether);
        (address[] memory to, uint256[] memory amounts) = pair(a, 0.02 ether, a, 0.01 ether + 1);
        vm.prank(court);
        vm.expectRevert(IVault.EscrowExceeded.selector);
        v.distribute(1, to, amounts);
        assertEq(v.escrowOf(1), 0.03 ether);
        assertEq(v.balanceOf(a), 0);
    }

    function test_distribute_lengthMismatch_reverts() public {
        wireModules();
        stake(1, makeAddr("a"), 0.03 ether);
        address[] memory to = new address[](2);
        uint256[] memory amounts = new uint256[](1);
        vm.prank(court);
        vm.expectRevert(IVault.EscrowExceeded.selector);
        v.distribute(1, to, amounts);
    }

    function test_distribute_cannotTouchAnotherEscrowOrBonds() public {
        wireModules();
        depositBondAs(publisher, skillId, 0.4 ether);
        address a = makeAddr("a");
        stake(1, a, 1);
        stake(2, a, 5);
        (address[] memory to, uint256[] memory amounts) = pair(a, 1, a, 1);
        vm.prank(court);
        vm.expectRevert(IVault.EscrowExceeded.selector);
        v.distribute(1, to, amounts);
        assertEq(v.escrowOf(2), 5);
        assertEq(v.bondOf(skillId, publisher).amount, 0.4 ether);
    }

    function test_distribute_sameRecipientTwice_creditsBoth() public {
        wireModules();
        address a = makeAddr("a");
        stake(1, a, 0.03 ether);
        (address[] memory to, uint256[] memory amounts) = pair(a, 0.02 ether, a, 0.01 ether);
        vm.prank(court);
        v.distribute(1, to, amounts);
        assertEq(v.balanceOf(a), 0.03 ether);
    }

    function testFuzz_distribute_neverCreditsMoreThanEscrow(uint96 stakeAmount, uint96 a, uint96 b) public {
        vm.assume(stakeAmount > 0);
        wireModules();
        address x = makeAddr("x");
        address y = makeAddr("y");
        stake(1, x, stakeAmount);
        (address[] memory to, uint256[] memory amounts) = pair(x, a, y, b);
        vm.prank(court);
        if (uint256(a) + b > stakeAmount) {
            vm.expectRevert(IVault.EscrowExceeded.selector);
            v.distribute(1, to, amounts);
            assertEq(v.escrowOf(1), stakeAmount);
        } else {
            v.distribute(1, to, amounts);
            assertEq(v.escrowOf(1), uint256(stakeAmount) - a - b);
        }
        assertLe(v.balanceOf(x) + v.balanceOf(y), stakeAmount);
    }
}
