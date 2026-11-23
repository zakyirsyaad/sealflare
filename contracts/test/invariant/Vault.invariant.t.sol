// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ICourt} from "../../src/interfaces/ICourt.sol";
import {IVault} from "../../src/interfaces/IVault.sol";
import {BondView, BountyView, ChallengePhase} from "../../src/interfaces/Types.sol";
import {Fixture} from "../helpers/Fixture.sol";
import {Handler} from "./Handler.sol";

contract VaultInvariantTest is Fixture {
    Handler internal handler;
    IVault internal v;
    ICourt internal c;

    function setUp() public override {
        super.setUp();
        wireModules();
        v = IVault(vault);
        c = ICourt(court);
        address[] memory ts = new address[](3);
        for (uint256 i = 0; i < ts.length; ++i) {
            ts[i] = deployTarget();
        }
        handler = new Handler(core, v, c, address(agentId), ts);
        targetContract(address(handler));
    }

    function _sumBalances() internal view returns (uint256 sum) {
        sum = v.balanceOf(treasury);
        for (uint256 i = 0; i < handler.actorCount(); ++i) {
            sum += v.balanceOf(handler.actors(i));
        }
    }

    function _sumBonds() internal view returns (uint256 sum) {
        for (uint256 t = 0; t < handler.TARGETS(); ++t) {
            bytes32 id = core.targetIdOfContract(handler.targets(t));
            for (uint256 i = 0; i < handler.actorCount(); ++i) {
                sum += v.bondOf(id, handler.actors(i)).amount;
            }
        }
    }

    function _sumEscrows() internal view returns (uint256 sum) {
        for (uint256 i = 0; i < handler.challengeCount(); ++i) {
            sum += v.escrowOf(handler.challengeIds(i));
        }
    }

    function _sumOpenBounties() internal view returns (uint256 sum) {
        for (uint256 i = 0; i < handler.bountyCount(); ++i) {
            BountyView memory b = v.getBounty(handler.bountyIds(i));
            if (!b.settled) sum += b.amount;
        }
    }

    function invariant_vaultHoldsWhatItOwes() public view {
        uint256 owed = _sumBalances() + _sumBonds() + _sumEscrows() + _sumOpenBounties();
        assertGe(vault.balance, owed);
        // Every BNB in Vault belongs to exactly one of these buckets, so nothing is left over either.
        assertEq(vault.balance, owed);
    }

    function invariant_moneyIsConserved() public view {
        assertEq(vault.balance, handler.totalIn() - handler.totalOut());
    }

    function invariant_closedChallengesHaveEmptyEscrow() public view {
        for (uint256 i = 0; i < handler.challengeCount(); ++i) {
            uint256 id = handler.challengeIds(i);
            if (c.phaseOf(id) == ChallengePhase.CLOSED) assertEq(v.escrowOf(id), 0);
        }
    }

    function invariant_noBondStaysLockedByAClosedChallenge() public view {
        for (uint256 t = 0; t < handler.TARGETS(); ++t) {
            bytes32 id = core.targetIdOfContract(handler.targets(t));
            for (uint256 i = 0; i < handler.actorCount(); ++i) {
                BondView memory b = v.bondOf(id, handler.actors(i));
                if (b.lockedByChallengeId != 0) {
                    assertTrue(c.phaseOf(b.lockedByChallengeId) != ChallengePhase.CLOSED);
                }
            }
        }
    }

    function invariant_confirmedDangerOnlyAfterUpheldChallenge() public view {
        for (uint256 t = 0; t < handler.TARGETS(); ++t) {
            bytes32 id = core.targetIdOfContract(handler.targets(t));
            if (core.getTarget(id).confirmedDanger) assertTrue(handler.upheld(id));
        }
    }

    function invariant_scoresOnlyMoveThroughCoreRules() public view {
        assertFalse(handler.sawForeignDelta());
        for (uint256 i = 0; i < handler.actorCount(); ++i) {
            address a = handler.actors(i);
            assertEq(int256(core.getGuardian(a).score), handler.ghostScore(a));
        }
    }
}
