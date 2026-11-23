// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IVault} from "../src/interfaces/IVault.sol";
import {BountyView, Verdict} from "../src/interfaces/Types.sol";
import {Constants} from "../src/lib/Constants.sol";
import {Fixture} from "./helpers/Fixture.sol";

contract VaultBountyTest is Fixture {
    IVault internal v;
    address internal target;
    bytes32 internal id;
    address internal requester;

    function setUp() public override {
        super.setUp();
        v = IVault(vault);
        target = deployTarget();
        id = core.targetIdOfContract(target);
        requester = makeAddr("requester");
        vm.deal(requester, 1 ether);
    }

    function bounty(uint8 slots, uint256 amount) internal returns (uint256 bountyId) {
        vm.prank(requester);
        bountyId = v.createBounty{value: amount}(id, slots);
    }

    function filler(uint256 i) internal returns (address who) {
        who = address(uint160(3000 + i));
        agentId.setBalance(who, 1);
    }

    function voteAs(uint256 i, Verdict verdict) internal returns (address who) {
        who = filler(i);
        attestAs(who, target, verdict, verdict == Verdict.SAFE ? 0 : 0x01);
    }

    function votes(Verdict[] memory verdicts) internal {
        for (uint256 i = 0; i < verdicts.length; ++i) {
            voteAs(i, verdicts[i]);
        }
    }

    function three(Verdict a, Verdict b, Verdict c) internal pure returns (Verdict[] memory out) {
        out = new Verdict[](3);
        (out[0], out[1], out[2]) = (a, b, c);
    }

    function settleAfterDelay(uint256 bountyId) internal {
        vm.warp(block.timestamp + Constants.SETTLE_DELAY);
        v.settleBounty(bountyId);
    }

    // ---- createBounty --------------------------------------------------------------------------

    function test_createBounty_recordsStartIndexFromCore() public {
        voteAs(0, Verdict.SAFE);
        voteAs(1, Verdict.SAFE);
        vm.expectEmit(vault);
        emit IVault.BountyCreated(1, id, requester, 3, 0.1 ether, 2);
        uint256 bountyId = bounty(3, 0.1 ether);
        assertEq(bountyId, 1);
        BountyView memory b = v.getBounty(bountyId);
        assertEq(b.startIndex, 2);
        assertEq(b.requester, requester);
        assertEq(b.amount, 0.1 ether);
        assertEq(b.createdAt, block.timestamp);
        assertFalse(b.settled);
    }

    function test_createBounty_unknownTarget_startsAtZero() public {
        uint256 bountyId = bounty(3, 0.1 ether);
        assertEq(v.getBounty(bountyId).startIndex, 0);
    }

    function test_createBounty_twoOrSixSlots_reverts() public {
        vm.startPrank(requester);
        vm.expectRevert(IVault.InvalidSlots.selector);
        v.createBounty{value: 0.1 ether}(id, 2);
        vm.expectRevert(IVault.InvalidSlots.selector);
        v.createBounty{value: 0.1 ether}(id, 6);
        v.createBounty{value: 0.1 ether}(id, 3);
        v.createBounty{value: 0.1 ether}(id, 5);
        vm.stopPrank();
    }

    function test_createBounty_aboveCapOrZero_reverts() public {
        vm.startPrank(requester);
        vm.expectRevert(IVault.BountyAboveCap.selector);
        v.createBounty{value: Constants.MAX_BOUNTY + 1}(id, 3);
        vm.expectRevert(IVault.BountyAboveCap.selector);
        v.createBounty{value: 0}(id, 3);
        v.createBounty{value: Constants.MAX_BOUNTY}(id, 3);
        vm.stopPrank();
    }

    // ---- settleable or not ---------------------------------------------------------------------

    function test_settle_beforeSlotsFull_reverts() public {
        uint256 bountyId = bounty(3, 0.1 ether);
        voteAs(0, Verdict.SAFE);
        voteAs(1, Verdict.SAFE);
        vm.warp(block.timestamp + Constants.SETTLE_DELAY);
        vm.expectRevert(IVault.BountyNotSettleable.selector);
        v.settleBounty(bountyId);
    }

    function test_settle_fullButBefore48h_reverts() public {
        uint256 bountyId = bounty(3, 0.1 ether);
        votes(three(Verdict.SAFE, Verdict.SAFE, Verdict.SAFE));
        vm.warp(block.timestamp + Constants.SETTLE_DELAY - 1);
        vm.expectRevert(IVault.BountyNotSettleable.selector);
        v.settleBounty(bountyId);
    }

    function test_settle_twice_reverts() public {
        uint256 bountyId = bounty(3, 0.1 ether);
        votes(three(Verdict.SAFE, Verdict.SAFE, Verdict.SAFE));
        settleAfterDelay(bountyId);
        assertTrue(v.getBounty(bountyId).settled);
        vm.expectRevert(IVault.BountyNotSettleable.selector);
        v.settleBounty(bountyId);
    }

    function test_settle_unknownBounty_reverts() public {
        vm.expectRevert(IVault.BountyNotSettleable.selector);
        v.settleBounty(42);
    }

    // ---- payouts -------------------------------------------------------------------------------

    function test_settle_threeAligned_paysEachAfterFivePercentFee() public {
        uint256 bountyId = bounty(3, 0.1 ether);
        votes(three(Verdict.SAFE, Verdict.SAFE, Verdict.SAFE));
        vm.warp(block.timestamp + Constants.SETTLE_DELAY);
        vm.expectEmit(vault);
        emit IVault.BountySettled(bountyId, 1, 3, 0.031666666666666666 ether, 0, 0.005 ether);
        v.settleBounty(bountyId);
        for (uint256 i = 0; i < 3; ++i) {
            assertEq(v.balanceOf(filler(i)), 0.031666666666666666 ether);
        }
        assertEq(v.balanceOf(treasury), 0.005 ether + 2);
        assertEq(v.balanceOf(requester), 0);
    }

    function test_settle_majorityOnly_isPaid() public {
        uint256 bountyId = bounty(3, 0.1 ether);
        votes(three(Verdict.SAFE, Verdict.SAFE, Verdict.DANGER));
        vm.warp(block.timestamp + Constants.SETTLE_DELAY);
        vm.expectEmit(vault);
        emit IVault.BountySettled(bountyId, 1, 3, 0.0475 ether, 0, 0.005 ether);
        v.settleBounty(bountyId);
        assertEq(v.balanceOf(filler(0)), 0.0475 ether);
        assertEq(v.balanceOf(filler(1)), 0.0475 ether);
        assertEq(v.balanceOf(filler(2)), 0);
    }

    function test_settle_tie_paysEveryTopVerdict() public {
        uint256 bountyId = bounty(4, 0.1 ether);
        Verdict[] memory four = new Verdict[](4);
        (four[0], four[1], four[2], four[3]) = (Verdict.SAFE, Verdict.SAFE, Verdict.DANGER, Verdict.DANGER);
        votes(four);
        vm.warp(block.timestamp + Constants.SETTLE_DELAY);
        vm.expectEmit(vault);
        emit IVault.BountySettled(bountyId, 5, 4, 0.02375 ether, 0, 0.005 ether);
        v.settleBounty(bountyId);
        for (uint256 i = 0; i < 4; ++i) {
            assertEq(v.balanceOf(filler(i)), 0.02375 ether);
        }
    }

    function test_settle_threeWayTie_paysAll() public {
        uint256 bountyId = bounty(3, 0.09 ether);
        votes(three(Verdict.SAFE, Verdict.CAUTION, Verdict.DANGER));
        vm.warp(block.timestamp + Constants.SETTLE_DELAY);
        vm.expectEmit(vault);
        emit IVault.BountySettled(bountyId, 7, 3, 0.0285 ether, 0, 0.0045 ether);
        v.settleBounty(bountyId);
    }

    function test_settle_requesterOwnVote_doesNotFillASlot() public {
        uint256 bountyId = bounty(3, 0.09 ether);
        agentId.setBalance(requester, 1);
        attestAs(requester, target, Verdict.DANGER, 0x01);
        votes(three(Verdict.SAFE, Verdict.SAFE, Verdict.SAFE));
        settleAfterDelay(bountyId);
        assertEq(v.balanceOf(requester), 0);
        assertEq(v.balanceOf(filler(2)), 0.0285 ether);
    }

    function test_settle_laterVotesCannotShiftConsensus() public {
        uint256 bountyId = bounty(3, 0.09 ether);
        votes(three(Verdict.SAFE, Verdict.SAFE, Verdict.DANGER));
        for (uint256 i = 3; i < 6; ++i) {
            voteAs(i, Verdict.DANGER);
        }
        settleAfterDelay(bountyId);
        assertEq(v.balanceOf(filler(0)), 0.04275 ether);
        assertEq(v.balanceOf(filler(2)), 0);
        assertEq(v.balanceOf(filler(3)), 0);
    }

    function test_settle_timeoutWithTwoOfThree_refundsUnfilledShare() public {
        uint256 bountyId = bounty(3, 0.09 ether);
        voteAs(0, Verdict.SAFE);
        voteAs(1, Verdict.SAFE);
        vm.warp(block.timestamp + Constants.BOUNTY_TIMEOUT);
        vm.expectEmit(vault);
        emit IVault.BountySettled(bountyId, 1, 2, 0.0285 ether, 0.03 ether, 0.003 ether);
        v.settleBounty(bountyId);
        assertEq(v.balanceOf(requester), 0.03 ether);
        assertEq(v.balanceOf(treasury), 0.003 ether);
        assertEq(v.balanceOf(filler(0)), 0.0285 ether);
    }

    function test_settle_timeoutWithNone_refundsEverything() public {
        uint256 bountyId = bounty(3, 0.09 ether);
        vm.warp(block.timestamp + Constants.BOUNTY_TIMEOUT);
        vm.expectEmit(vault);
        emit IVault.BountySettled(bountyId, 0, 0, 0, 0.09 ether, 0);
        v.settleBounty(bountyId);
        assertEq(v.balanceOf(requester), 0.09 ether);
        assertEq(v.balanceOf(treasury), 0);
    }

    function testFuzz_settle_paysOutExactlyTheAmount(uint96 amount, uint8 slots, uint8 filled, uint8 verdictSeed)
        public
    {
        amount = uint96(bound(amount, 1, Constants.MAX_BOUNTY));
        slots = uint8(bound(slots, Constants.BOUNTY_MIN_SLOTS, Constants.BOUNTY_MAX_SLOTS));
        filled = uint8(bound(filled, 0, slots));
        uint256 bountyId = bounty(slots, amount);
        for (uint256 i = 0; i < filled; ++i) {
            voteAs(i, Verdict((uint256(verdictSeed) >> (2 * i)) % 3));
        }
        vm.warp(block.timestamp + Constants.BOUNTY_TIMEOUT);
        v.settleBounty(bountyId);

        uint256 credited = v.balanceOf(treasury) + v.balanceOf(requester);
        for (uint256 i = 0; i < filled; ++i) {
            credited += v.balanceOf(filler(i));
        }
        assertEq(credited, amount);
    }
}
